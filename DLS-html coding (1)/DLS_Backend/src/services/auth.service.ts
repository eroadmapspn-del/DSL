import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { ENV } from '../config/env.js';
import { memoryStore, getDatabaseConnector } from '../db/index.js';
import { UserAccount, UserProfile, UserRole } from '../types/index.js';

export class AuthService {
  static async signIn(email: string, password: string) {
    const normalizedEmail = email.trim().toLowerCase();
    
    let userAccount: { id: string; email: string; password_hash: string } | null = null;
    let profile: { id: string; full_name: string; department: string; is_active: boolean } | null = null;
    const roles: string[] = [];
    const permissions = new Set<string>();

    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        const userRes = await db.query('SELECT * FROM app_users WHERE LOWER(email) = $1', [normalizedEmail]);
        if (userRes.rowCount > 0) {
          userAccount = userRes.rows[0];
          const profRes = await db.query('SELECT * FROM user_profiles WHERE user_id = $1', [userAccount!.id]);
          if (profRes.rowCount > 0) profile = profRes.rows[0];

          const rolesRes = await db.query(`
            SELECT r.name, r.permissions
            FROM user_roles ur
            JOIN roles r ON ur.role_id = r.id
            WHERE ur.user_id = $1
          `, [userAccount!.id]);

          rolesRes.rows.forEach((r: any) => {
            roles.push(r.name);
            const perms = Array.isArray(r.permissions) ? r.permissions : (typeof r.permissions === 'string' ? JSON.parse(r.permissions) : []);
            perms.forEach((p: string) => permissions.add(p));
          });
        }
      } catch (err) {
        console.error('PostgreSQL signIn error, trying memory store:', err);
      }
    }

    // Fallback to memory store if not found in database
    if (!userAccount) {
      const user = Array.from(memoryStore.users.values()).find(
        u => u.email.toLowerCase() === normalizedEmail
      );
      if (user) {
        userAccount = user;
        const p = memoryStore.userProfiles.get(user.id);
        if (p) profile = p;

        for (const [_, ur] of memoryStore.userRoles.entries()) {
          if (ur.user_id === user.id) {
            const role = Array.from(memoryStore.roles.values()).find(r => r.id === ur.role_id || r.name === ur.role_name);
            if (role && !roles.includes(role.name)) roles.push(role.name);
          }
        }
        if (user.roles) {
          user.roles.forEach(r => { if (!roles.includes(r)) roles.push(r); });
        }
        for (const r of roles) {
          const roleObj = memoryStore.roles.get(r);
          if (roleObj && roleObj.permissions) {
            roleObj.permissions.forEach(p => permissions.add(p));
          }
        }
      }
    }

    if (!userAccount) {
      throw { status: 400, message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' };
    }

    const isMatch = bcrypt.compareSync(password, userAccount.password_hash);
    if (!isMatch) {
      throw { status: 400, message: 'Invalid email or password', code: 'INVALID_CREDENTIALS' };
    }

    // Check if user is active
    if (profile && !profile.is_active) {
      throw { status: 403, message: 'Account is deactivated. Contact administrator.', code: 'ACCOUNT_DEACTIVATED' };
    }

    const tokenPayload = {
      id: userAccount.id,
      email: userAccount.email,
      full_name: profile?.full_name || '',
      department: profile?.department || '',
      roles,
      isAdmin: roles.includes('admin')
    };

    const token = jwt.sign(tokenPayload, ENV.JWT_SECRET, {
      expiresIn: ENV.JWT_EXPIRES_IN as any
    });

    return {
      session: {
        access_token: token,
        token_type: 'bearer',
        expires_in: 604800,
        refresh_token: token,
        user: {
          id: userAccount.id,
          email: userAccount.email,
          user_metadata: {
            full_name: profile?.full_name || '',
            department: profile?.department || ''
          },
          app_metadata: {
            roles,
            permissions: Array.from(permissions)
          }
        }
      },
      user: {
        id: userAccount.id,
        email: userAccount.email,
        full_name: profile?.full_name || '',
        department: profile?.department || '',
        roles,
        permissions: Array.from(permissions),
        isAdmin: roles.includes('admin')
      }
    };
  }

  static async signUp(data: { email: string; password: string; full_name?: string; department?: string; role?: string }) {
    const normalizedEmail = data.email.trim().toLowerCase();
    const userId = uuidv4();
    const now = new Date().toISOString();
    const assignedRoleName = data.role || 'viewer';
    const pwHash = bcrypt.hashSync(data.password, 10);

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
          VALUES ($1, $1, $2, $3, $4, TRUE)
        `, [userId, normalizedEmail, data.full_name || '', data.department || '']);

        const roleRes = await db.query('SELECT id FROM roles WHERE name = $1', [assignedRoleName]);
        if (roleRes.rowCount > 0) {
          await db.query(`
            INSERT INTO user_roles (id, user_id, role_id)
            VALUES (gen_random_uuid(), $1, $2)
          `, [userId, roleRes.rows[0].id]);
        }
      } catch (err: any) {
        if (err.code === 'USER_EXISTS') throw err;
        console.error('PostgreSQL signUp error:', err);
      }
    }

    // Also update in-memory
    const newUser: UserAccount = {
      id: userId,
      email: normalizedEmail,
      password_hash: pwHash,
      created_at: now,
      roles: [assignedRoleName]
    };
    const newProfile: UserProfile = {
      id: userId,
      user_id: userId,
      email: normalizedEmail,
      full_name: data.full_name || '',
      department: data.department || '',
      is_active: true,
      last_login: null,
      created_at: now,
      updated_at: now
    };
    const roleObj = memoryStore.roles.get(assignedRoleName);
    const roleId = roleObj ? roleObj.id : assignedRoleName;
    const userRoleAssignment: UserRole = {
      id: uuidv4(),
      user_id: userId,
      role_id: roleId,
      role_name: assignedRoleName,
      assigned_at: now
    };

    memoryStore.users.set(userId, newUser);
    memoryStore.userProfiles.set(userId, newProfile);
    memoryStore.userRoles.set(`${userId}_${roleId}`, userRoleAssignment);

    return {
      id: userId,
      email: normalizedEmail,
      profile: newProfile,
      role: assignedRoleName
    };
  }

  static async resetPassword(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const tempPassword = 'Temp' + Math.floor(100000 + Math.random() * 900000);
    const pwHash = bcrypt.hashSync(tempPassword, 10);

    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        await db.query('UPDATE app_users SET password_hash = $1 WHERE LOWER(email) = $2', [pwHash, normalizedEmail]);
      } catch (e) {
        console.error('PostgreSQL resetPassword error:', e);
      }
    }

    const user = Array.from(memoryStore.users.values()).find(
      u => u.email.toLowerCase() === normalizedEmail
    );
    if (user) {
      user.password_hash = pwHash;
    }

    console.log(`🔑 Temporary password generated for ${email}: ${tempPassword}`);
    return {
      success: true,
      message: 'Temporary password generated.',
      tempPassword
    };
  }

  static async changePassword(userId: string, newPassword: string) {
    const pwHash = bcrypt.hashSync(newPassword, 10);

    if (ENV.USE_DATABASE) {
      try {
        const db = getDatabaseConnector();
        await db.query('UPDATE app_users SET password_hash = $1 WHERE id = $2', [pwHash, userId]);
      } catch (e) {
        console.error('PostgreSQL changePassword error:', e);
      }
    }

    const user = memoryStore.users.get(userId);
    if (user) {
      user.password_hash = pwHash;
    }
    return { success: true };
  }
}
