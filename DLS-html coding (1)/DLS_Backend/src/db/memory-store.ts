import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { UserAccount, UserProfile, Role, UserRole, Permission, AuditLog } from '../types/index.js';

export class MemoryStore {
  public users: Map<string, UserAccount> = new Map();
  public userProfiles: Map<string, UserProfile> = new Map();
  public roles: Map<string, Role> = new Map();
  public userRoles: Map<string, UserRole> = new Map();
  public permissions: Map<string, Permission> = new Map();
  public auditLogs: AuditLog[] = [];

  // Data tables
  public tables: { [tableName: string]: any[] } = {
    retailers: [],
    bills: [],
    active_supplies: [],
    approved_bills: [],
    edited_bills: [],
    ugrai_data: [],
    ugrai_entries: [],
    ugrai_assignments: [],
    ugrai_in_progress: [],
    ugrai_completed: [],
    completed_ugrai: [],
    approved_ugrai: [],
    ugrai_payment_history: [],
    cash_receipts: [],
    bill_photos: [],
    purchase_retailers: [],
    purchase_entries: []
  };

  constructor() {
    this.seedDefaultData();
  }

  private seedDefaultData() {
    console.log('🌱 Seeding initial in-memory dataset...');

    // 1. Seed Permissions
    const initialPermissions: Array<{ id: string; name: string; description: string; section_id: string; section_name: string }> = [
      { id: 'perm-1', name: 'admin.dashboard.view', description: 'Access to admin dashboard', section_id: 'admin', section_name: 'Admin' },
      { id: 'perm-2', name: 'admin.users.create', description: 'Create new users', section_id: 'admin', section_name: 'Admin' },
      { id: 'perm-3', name: 'admin.users.read', description: 'View user information', section_id: 'admin', section_name: 'Admin' },
      { id: 'perm-4', name: 'admin.users.update', description: 'Edit user information', section_id: 'admin', section_name: 'Admin' },
      { id: 'perm-5', name: 'admin.users.delete', description: 'Delete users', section_id: 'admin', section_name: 'Admin' },
      { id: 'perm-6', name: 'supply.in_progress.view', description: 'View supplies in progress', section_id: 'supply', section_name: 'Supply' },
      { id: 'perm-7', name: 'supply.management.view', description: 'View supply management', section_id: 'supply', section_name: 'Supply' },
      { id: 'perm-8', name: 'ugrai.base_file.view', description: 'View UGRAI base file', section_id: 'ugrai', section_name: 'Ugrai' },
      { id: 'perm-9', name: 'ugrai.total.view', description: 'View total UGRAI combined data', section_id: 'ugrai', section_name: 'Ugrai' },
      { id: 'perm-10', name: 'ugrai.issue.view', description: 'View UGRAI issue', section_id: 'ugrai', section_name: 'Ugrai' },
      { id: 'perm-11', name: 'ugrai.in_progress.view', description: 'View ugrai in progress', section_id: 'ugrai', section_name: 'Ugrai' },
      { id: 'perm-12', name: 'ugrai.management.view', description: 'View ugrai management', section_id: 'ugrai', section_name: 'Ugrai' },
      { id: 'perm-13', name: 'purchase.accounting.view', description: 'View purchase accounting', section_id: 'purchase', section_name: 'Purchase' },
      { id: 'perm-14', name: 'analysis.supply.view', description: 'View supply analysis and reports', section_id: 'analysis', section_name: 'Analysis' },
      { id: 'perm-15', name: 'analysis.ugrai.view', description: 'View ugrai analysis and reports', section_id: 'analysis', section_name: 'Analysis' },
      { id: 'perm-16', name: 'analysis.purchase.view', description: 'View purchase analysis and reports', section_id: 'analysis', section_name: 'Analysis' },
      { id: 'perm-17', name: 'analysis.pending_bills.view', description: 'View pending bills analysis and reports', section_id: 'analysis', section_name: 'Analysis' },
      { id: 'perm-18', name: 'cash_receipts.view', description: 'View Tally cash receipts', section_id: 'cash_receipts', section_name: 'Cash Receipts' },
      { id: 'perm-19', name: 'cash_receipts.manage', description: 'Process Tally cash receipts', section_id: 'cash_receipts', section_name: 'Cash Receipts' },
    ];

    for (const p of initialPermissions) {
      this.permissions.set(p.name, p);
    }

    const allPermNames = initialPermissions.map(p => p.name);

    // 2. Seed Roles
    const initialRoles: Role[] = [
      {
        id: 'role-admin',
        name: 'admin',
        display_name: 'Administrator',
        description: 'Full system access with user management capabilities',
        permissions: allPermNames,
        is_system_role: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 'role-supply-manager',
        name: 'supply_manager',
        display_name: 'Supply Manager',
        description: 'Access to supply-related sections only',
        permissions: [
          'supply.in_progress.view',
          'supply.management.view',
          'analysis.supply.view'
        ],
        is_system_role: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 'role-ugrai-manager',
        name: 'ugrai_manager',
        display_name: 'UGRAI Manager',
        description: 'Access to UGRAI-related sections only',
        permissions: [
          'ugrai.base_file.view',
          'ugrai.total.view',
          'ugrai.issue.view',
          'ugrai.in_progress.view',
          'ugrai.management.view',
          'analysis.ugrai.view'
        ],
        is_system_role: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 'role-accountant',
        name: 'accountant',
        display_name: 'Accountant',
        description: 'Financial, reporting and cash receipt management',
        permissions: [
          'analysis.supply.view',
          'analysis.ugrai.view',
          'analysis.purchase.view',
          'analysis.pending_bills.view',
          'cash_receipts.view',
          'cash_receipts.manage'
        ],
        is_system_role: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        id: 'role-viewer',
        name: 'viewer',
        display_name: 'Viewer',
        description: 'Read-only access to basic sections',
        permissions: [
          'supply.in_progress.view',
          'ugrai.in_progress.view'
        ],
        is_system_role: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ];

    for (const r of initialRoles) {
      this.roles.set(r.name, r);
    }

    // 3. Seed Default Admin User
    const adminId = '00000000-0000-0000-0000-000000000001';
    const adminEmail = 'admin@beautybasket.com';
    const passwordHash = bcrypt.hashSync('admin123', 10);
    const now = new Date().toISOString();

    const adminUser: UserAccount = {
      id: adminId,
      email: adminEmail,
      password_hash: passwordHash,
      created_at: now,
      roles: ['admin']
    };

    const adminProfile: UserProfile = {
      id: adminId,
      user_id: adminId,
      email: adminEmail,
      full_name: 'System Admin',
      department: 'Management',
      is_active: true,
      last_login: null,
      created_at: now,
      updated_at: now
    };

    const adminRoleAssignment: UserRole = {
      id: 'ur-admin-1',
      user_id: adminId,
      role_id: 'role-admin',
      role_name: 'admin',
      assigned_by: adminId,
      assigned_at: now
    };

    this.users.set(adminId, adminUser);
    this.userProfiles.set(adminId, adminProfile);
    this.userRoles.set(`${adminId}_role-admin`, adminRoleAssignment);

    // 4. Seed a few sample users for supply and ugrai assignees
    const sampleUsers = [
      { id: '00000000-0000-0000-0000-000000000002', email: 'supply@beautybasket.com', name: 'Rajesh Supply', dept: 'Supply', role: 'supply_manager' },
      { id: '00000000-0000-0000-0000-000000000003', email: 'ugrai@beautybasket.com', name: 'Vikram Ugrai', dept: 'Recovery', role: 'ugrai_manager' },
      { id: '00000000-0000-0000-0000-000000000004', email: 'accounts@beautybasket.com', name: 'Priya Accounts', dept: 'Finance', role: 'accountant' },
    ];

    for (const s of sampleUsers) {
      const u: UserAccount = {
        id: s.id,
        email: s.email,
        password_hash: bcrypt.hashSync('password123', 10),
        created_at: now,
        roles: [s.role]
      };
      const p: UserProfile = {
        id: s.id,
        user_id: s.id,
        email: s.email,
        full_name: s.name,
        department: s.dept,
        is_active: true,
        last_login: null,
        created_at: now,
        updated_at: now
      };
      const targetRole = this.roles.get(s.role);
      const roleId = targetRole ? targetRole.id : s.role;
      const ur: UserRole = {
        id: `ur-${s.id}`,
        user_id: s.id,
        role_id: roleId,
        role_name: s.role,
        assigned_by: adminId,
        assigned_at: now
      };
      this.users.set(s.id, u);
      this.userProfiles.set(s.id, p);
      this.userRoles.set(`${s.id}_${roleId}`, ur);
    }

    console.log('✅ Initial in-memory data seeded successfully!');
    console.log('   Admin credentials: admin@beautybasket.com / admin123');
  }
}

export const memoryStore = new MemoryStore();
