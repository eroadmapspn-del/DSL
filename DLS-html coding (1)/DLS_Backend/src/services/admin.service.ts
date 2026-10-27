import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { memoryStore, getDatabaseConnector } from '../db/index.js';
import { UserAccount, UserProfile, Role, UserRole, AuditLog } from '../types/index.js';
import { ENV } from '../config/env.js';

export class AdminService {
  static async getAllUsersWithRoles() {
    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        const res = await db.query('SELECT * FROM get_all_users_with_roles()');
        if (res.rows && res.rows.length > 0) {
          return res.rows.map((row: any) => ({
            id: row.id || row.user_id,
            user_id: row.user_id || row.id,
            email: row.email,
            full_name: row.full_name,
            department: row.department,
            is_active: row.is_active,
            last_login: row.last_login,
            created_at: row.created_at,
            role_name: row.role_name || (row.roles && row.roles[0]) || 'viewer',
            roles: row.roles || [row.role_name || 'viewer']
          }));
        }
      } catch (err) {
        console.error('PostgreSQL getAllUsersWithRoles error, falling back:', err);
      }
    }

    const results: any[] = [];
    for (const [userId, profile] of memoryStore.userProfiles.entries()) {
      const userRoles: string[] = [];
      for (const [_, ur] of memoryStore.userRoles.entries()) {
        if (ur.user_id === userId) {
          const role = Array.from(memoryStore.roles.values()).find(r => r.id === ur.role_id || r.name === ur.role_name);
          if (role && !userRoles.includes(role.name)) {
            userRoles.push(role.name);
          }
        }
      }

      const user = memoryStore.users.get(userId);
      if (user?.roles) {
        user.roles.forEach(r => {
          if (!userRoles.includes(r)) userRoles.push(r);
        });
      }

      results.push({
        id: userId,
        user_id: userId,
        email: profile.email,
        full_name: profile.full_name,
        department: profile.department,
        is_active: profile.is_active,
        last_login: profile.last_login,
        created_at: profile.created_at,
        role_name: userRoles[0] || 'viewer',
        roles: userRoles
      });
    }

    return results;
  }

  static async createUserWithRole(
    userData: { email: string; password: string; full_name?: string; department?: string; is_active?: boolean },
    roleName: string,
    creatorId?: string
  ) {
    const normalizedEmail = userData.email.trim().toLowerCase();
    const userId = uuidv4();
    const now = new Date().toISOString();
    const pwHash = bcrypt.hashSync(userData.password, 10);
    const isActive = userData.is_active !== undefined ? userData.is_active : true;

    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        const existing = await db.query('SELECT 1 FROM app_users WHERE LOWER(email) = $1', [normalizedEmail]);
        if (existing.rowCount > 0) {
          throw { status: 400, message: 'User with this email already exists', code: 'USER_EXISTS' };
        }

        await db.query(`
          INSERT INTO app_users (id, email, password_hash)
          VALUES ($1, $2, $3)
        `, [userId, normalizedEmail, pwHash]);

        await db.query(`
          INSERT INTO user_profiles (id, user_id, email, full_name, department, is_active)
          VALUES ($1, $1, $2, $3, $4, $5)
        `, [userId, normalizedEmail, userData.full_name || '', userData.department || '', isActive]);

        const roleRes = await db.query('SELECT id FROM roles WHERE name = $1', [roleName]);
        if (roleRes.rowCount > 0) {
          await db.query(`
            INSERT INTO user_roles (id, user_id, role_id, assigned_by)
            VALUES (gen_random_uuid(), $1, $2, $3)
          `, [userId, roleRes.rows[0].id, creatorId || null]);
        }
      } catch (err: any) {
        if (err.code === 'USER_EXISTS') throw err;
        console.error('PostgreSQL createUserWithRole error:', err);
      }
    }

    // Also record in memory store
    const newUser: UserAccount = {
      id: userId,
      email: normalizedEmail,
      password_hash: pwHash,
      created_at: now,
      roles: [roleName]
    };

    const newProfile: UserProfile = {
      id: userId,
      user_id: userId,
      email: normalizedEmail,
      full_name: userData.full_name || '',
      department: userData.department || '',
      is_active: isActive,
      last_login: null,
      created_at: now,
      updated_at: now
    };

    const roleObj = memoryStore.roles.get(roleName);
    const roleId = roleObj ? roleObj.id : roleName;

    const userRoleAssignment: UserRole = {
      id: uuidv4(),
      user_id: userId,
      role_id: roleId,
      role_name: roleName,
      assigned_by: creatorId || null,
      assigned_at: now
    };

    memoryStore.users.set(userId, newUser);
    memoryStore.userProfiles.set(userId, newProfile);
    memoryStore.userRoles.set(`${userId}_${roleId}`, userRoleAssignment);

    this.logAdminAction({
      userId: creatorId || null,
      action: 'CREATE_USER',
      resourceType: 'users',
      resourceId: userId,
      details: { email: normalizedEmail, role: roleName }
    });

    return {
      success: true,
      user: {
        id: userId,
        email: normalizedEmail,
        full_name: newProfile.full_name,
        department: newProfile.department,
        role: roleName,
        is_active: newProfile.is_active
      }
    };
  }

  static async updateUser(userId: string, profileData: Partial<UserProfile>, updaterId?: string) {
    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        await db.query(`
          UPDATE user_profiles
          SET full_name = COALESCE($1, full_name),
              department = COALESCE($2, department),
              is_active = COALESCE($3, is_active),
              updated_at = NOW()
          WHERE user_id = $4 OR id = $4
        `, [profileData.full_name, profileData.department, profileData.is_active, userId]);
      } catch (err) {
        console.error('PostgreSQL updateUser error:', err);
      }
    }

    const profile = memoryStore.userProfiles.get(userId);
    if (profile) {
      const oldValues = { ...profile };
      if (profileData.full_name !== undefined) profile.full_name = profileData.full_name;
      if (profileData.department !== undefined) profile.department = profileData.department;
      if (profileData.is_active !== undefined) profile.is_active = profileData.is_active;
      profile.updated_at = new Date().toISOString();

      this.logAdminAction({
        userId: updaterId || null,
        action: 'UPDATE_USER',
        resourceType: 'user_profiles',
        resourceId: userId,
        oldValues,
        newValues: profile
      });
      return { success: true, data: profile };
    }

    return { success: true, data: profileData };
  }

  static async updateUserRole(userId: string, roleName: string, assignerId?: string) {
    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        const roleRes = await db.query('SELECT id FROM roles WHERE name = $1', [roleName]);
        if (roleRes.rowCount > 0) {
          const roleId = roleRes.rows[0].id;
          await db.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
          await db.query(`
            INSERT INTO user_roles (id, user_id, role_id, assigned_by)
            VALUES (gen_random_uuid(), $1, $2, $3)
          `, [userId, roleId, assignerId || null]);
        }
      } catch (err) {
        console.error('PostgreSQL updateUserRole error:', err);
      }
    }

    const roleObj = memoryStore.roles.get(roleName);
    if (roleObj) {
      for (const [key, ur] of Array.from(memoryStore.userRoles.entries())) {
        if (ur.user_id === userId) {
          memoryStore.userRoles.delete(key);
        }
      }
      const now = new Date().toISOString();
      const newAssignment: UserRole = {
        id: uuidv4(),
        user_id: userId,
        role_id: roleObj.id,
        role_name: roleObj.name,
        assigned_by: assignerId || null,
        assigned_at: now
      };
      memoryStore.userRoles.set(`${userId}_${roleObj.id}`, newAssignment);
      const user = memoryStore.users.get(userId);
      if (user) user.roles = [roleObj.name];
    }

    this.logAdminAction({
      userId: assignerId || null,
      action: 'UPDATE_USER_ROLE',
      resourceType: 'user_roles',
      resourceId: userId,
      details: { newRole: roleName }
    });

    return { success: true };
  }

  static async toggleUserStatus(userId: string, adminId?: string) {
    let currentStatus = true;
    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        const res = await db.query('UPDATE user_profiles SET is_active = NOT is_active, updated_at = NOW() WHERE user_id = $1 OR id = $1 RETURNING is_active', [userId]);
        if (res.rowCount > 0) {
          currentStatus = res.rows[0].is_active;
        }
      } catch (err) {
        console.error('PostgreSQL toggleUserStatus error:', err);
      }
    }

    const profile = memoryStore.userProfiles.get(userId);
    if (profile) {
      profile.is_active = !profile.is_active;
      profile.updated_at = new Date().toISOString();
      currentStatus = profile.is_active;
    }

    this.logAdminAction({
      userId: adminId || null,
      action: 'TOGGLE_USER_STATUS',
      resourceType: 'user_profiles',
      resourceId: userId,
      details: { is_active: currentStatus }
    });

    return { success: true, is_active: currentStatus };
  }

  static async deleteUser(userId: string, adminId?: string) {
    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        await db.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
        await db.query('DELETE FROM user_profiles WHERE user_id = $1 OR id = $1', [userId]);
        await db.query('DELETE FROM app_users WHERE id = $1', [userId]);
      } catch (err) {
        console.error('PostgreSQL deleteUser error:', err);
      }
    }

    memoryStore.users.delete(userId);
    memoryStore.userProfiles.delete(userId);
    for (const [key, ur] of Array.from(memoryStore.userRoles.entries())) {
      if (ur.user_id === userId) {
        memoryStore.userRoles.delete(key);
      }
    }

    this.logAdminAction({
      userId: adminId || null,
      action: 'DELETE_USER',
      resourceType: 'users',
      resourceId: userId
    });

    return { success: true };
  }

  static async getAllRoles() {
    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        const res = await db.query(`
          SELECT r.*, COUNT(ur.user_id)::int AS user_count
          FROM roles r
          LEFT JOIN user_roles ur ON r.id = ur.role_id
          GROUP BY r.id
          ORDER BY r.name
        `);
        if (res.rows && res.rows.length > 0) {
          return res.rows.map((r: any) => ({
            id: r.id,
            name: r.name,
            display_name: r.display_name || r.name,
            description: r.description || '',
            permissions: Array.isArray(r.permissions) ? r.permissions : (typeof r.permissions === 'string' ? JSON.parse(r.permissions) : []),
            is_system_role: !!r.is_system_role,
            user_count: r.user_count || 0
          }));
        }
      } catch (err) {
        console.error('PostgreSQL getAllRoles error:', err);
      }
    }

    const rolesList: any[] = [];
    for (const role of memoryStore.roles.values()) {
      let userCount = 0;
      for (const ur of memoryStore.userRoles.values()) {
        if (ur.role_id === role.id || ur.role_name === role.name) userCount++;
      }
      rolesList.push({
        id: role.id,
        name: role.name,
        display_name: role.display_name || role.name,
        description: role.description || '',
        permissions: role.permissions || [],
        is_system_role: !!role.is_system_role,
        user_count: userCount
      });
    }

    return rolesList.sort((a, b) => a.name.localeCompare(b.name));
  }

  static async createRole(roleData: { name: string; display_name?: string; description?: string; permissions?: string[] }) {
    const name = roleData.name.trim().toLowerCase();
    const id = uuidv4();
    const perms = roleData.permissions || [];

    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        await db.query(`
          INSERT INTO roles (id, name, display_name, description, permissions, is_system_role)
          VALUES ($1, $2, $3, $4, $5, FALSE)
        `, [id, name, roleData.display_name || name, roleData.description || '', JSON.stringify(perms)]);
      } catch (err) {
        console.error('PostgreSQL createRole error:', err);
      }
    }

    const newRole: Role = {
      id,
      name,
      display_name: roleData.display_name || roleData.name,
      description: roleData.description || '',
      permissions: perms,
      is_system_role: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    memoryStore.roles.set(name, newRole);

    return { success: true, role: newRole };
  }

  static async deleteRole(roleIdOrName: string) {
    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        await db.query('DELETE FROM roles WHERE (id = $1 OR name = $1) AND is_system_role = FALSE', [roleIdOrName]);
      } catch (err) {
        console.error('PostgreSQL deleteRole error:', err);
      }
    }

    const role = Array.from(memoryStore.roles.values()).find(
      r => r.id === roleIdOrName || r.name === roleIdOrName
    );
    if (role && !role.is_system_role) {
      memoryStore.roles.delete(role.name);
    }
    return { success: true };
  }

  static async getAllPermissions() {
    return Array.from(memoryStore.permissions.values());
  }

  static async grantPermissionToRole(roleIdOrName: string, permissionName: string) {
    const roles = await this.getAllRoles();
    const role = roles.find((r: any) => r.id === roleIdOrName || r.name === roleIdOrName);
    if (role) {
      if (!role.permissions.includes(permissionName)) {
        role.permissions.push(permissionName);
        if (ENV.USE_DATABASE) {
          try {
            const db = getDatabaseConnector();
            await db.query('UPDATE roles SET permissions = $1 WHERE id = $2 OR name = $2', [JSON.stringify(role.permissions), roleIdOrName]);
          } catch (e) {
            console.error('PostgreSQL grantPermission error:', e);
          }
        }
      }
    }
    return { success: true, permissions: role?.permissions || [] };
  }

  static async revokePermissionFromRole(roleIdOrName: string, permissionName: string) {
    const roles = await this.getAllRoles();
    const role = roles.find((r: any) => r.id === roleIdOrName || r.name === roleIdOrName);
    if (role) {
      role.permissions = role.permissions.filter((p: string) => p !== permissionName);
      if (ENV.USE_DATABASE) {
        try {
          const db = getDatabaseConnector();
          await db.query('UPDATE roles SET permissions = $1 WHERE id = $2 OR name = $2', [JSON.stringify(role.permissions), roleIdOrName]);
        } catch (e) {
          console.error('PostgreSQL revokePermission error:', e);
        }
      }
    }
    return { success: true, permissions: role?.permissions || [] };
  }

  static async getDashboardStats() {
    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        const res = await db.query('SELECT get_dashboard_stats() as stats');
        if (res.rows && res.rows.length > 0 && res.rows[0].stats) {
          return res.rows[0].stats;
        }
      } catch (err) {
        console.error('PostgreSQL getDashboardStats error:', err);
      }
    }

    const totalUsers = memoryStore.userProfiles.size;
    let activeUsers = 0;
    for (const p of memoryStore.userProfiles.values()) {
      if (p.is_active) activeUsers++;
    }

    const totalRoles = memoryStore.roles.size;
    let adminUsers = 0;
    for (const ur of memoryStore.userRoles.values()) {
      if (ur.role_name === 'admin' || ur.role_id === 'role-admin') adminUsers++;
    }

    return {
      total_users: totalUsers,
      active_users: activeUsers,
      total_roles: totalRoles,
      admin_users: adminUsers,
      active_supplies: 0,
      pending_ugrai: 0,
      pending_cash_receipts: 0
    };
  }

  static async getUsersByRole(roleName: string) {
    const usersWithRoles = await this.getAllUsersWithRoles();
    return usersWithRoles.filter(u => u.roles && u.roles.includes(roleName));
  }

  static logAdminAction(data: {
    userId?: string | null;
    action: string;
    resourceType?: string;
    resourceId?: string;
    details?: any;
    oldValues?: any;
    newValues?: any;
    ipAddress?: string;
  }) {
    const logEntry: AuditLog = {
      id: uuidv4(),
      user_id: data.userId || null,
      action: data.action,
      resource_type: data.resourceType || null,
      resource_id: data.resourceId || null,
      details: data.details || null,
      old_values: data.oldValues || null,
      new_values: data.newValues || null,
      ip_address: data.ipAddress || null,
      created_at: new Date().toISOString()
    };

    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        db.query(`
          INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details, old_values, new_values, ip_address)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          logEntry.id,
          logEntry.user_id,
          logEntry.action,
          logEntry.resource_type,
          logEntry.resource_id,
          JSON.stringify(logEntry.details),
          JSON.stringify(logEntry.old_values),
          JSON.stringify(logEntry.new_values),
          logEntry.ip_address
        ]).catch(e => console.error('PostgreSQL audit log insert error:', e));
      } catch (err) {
        console.error('PostgreSQL logAdminAction error:', err);
      }
    }

    memoryStore.auditLogs.unshift(logEntry);
    if (memoryStore.auditLogs.length > 500) {
      memoryStore.auditLogs.pop();
    }
    return logEntry;
  }

  static async getAuditLogs(limit: number = 50, offset: number = 0) {
    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        const res = await db.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
        if (res.rows && res.rows.length > 0) return res.rows;
      } catch (e) {
        console.error('PostgreSQL getAuditLogs error:', e);
      }
    }
    return memoryStore.auditLogs.slice(offset, offset + limit);
  }
}
