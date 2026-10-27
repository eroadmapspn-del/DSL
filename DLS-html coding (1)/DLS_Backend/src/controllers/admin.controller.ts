import { Request, Response, NextFunction } from 'express';
import { AdminService } from '../services/admin.service.js';

export class AdminController {
  static async getUsers(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const users = await AdminService.getAllUsersWithRoles();
      res.json({ data: users, error: null });
    } catch (err) {
      next(err);
    }
  }

  static async createUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, full_name, department, role, is_active } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: { message: 'Email and password are required', code: 'VALIDATION_ERROR' } });
        return;
      }

      const roleName = role || 'viewer';
      const creatorId = req.user?.id;
      const result = await AdminService.createUserWithRole(
        { email, password, full_name, department, is_active },
        roleName,
        creatorId
      );

      res.status(201).json({ data: result, error: null });
    } catch (err) {
      next(err);
    }
  }

  static async updateUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.params.id;
      const profileData = req.body;
      const updaterId = req.user?.id;

      const result = await AdminService.updateUser(userId, profileData, updaterId);
      res.json({ data: result, error: null });
    } catch (err) {
      next(err);
    }
  }

  static async updateUserRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.params.id;
      const { role } = req.body;
      if (!role) {
        res.status(400).json({ error: { message: 'Role is required', code: 'VALIDATION_ERROR' } });
        return;
      }

      const assignerId = req.user?.id;
      const result = await AdminService.updateUserRole(userId, role, assignerId);
      res.json({ data: result, error: null });
    } catch (err) {
      next(err);
    }
  }

  static async toggleUserStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.params.id;
      const adminId = req.user?.id;
      const result = await AdminService.toggleUserStatus(userId, adminId);
      res.json({ data: result, error: null });
    } catch (err) {
      next(err);
    }
  }

  static async deleteUser(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.params.id;
      const adminId = req.user?.id;
      const result = await AdminService.deleteUser(userId, adminId);
      res.json({ data: result, error: null });
    } catch (err) {
      next(err);
    }
  }

  static async getRoles(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const roles = await AdminService.getAllRoles();
      res.json({ data: roles, error: null });
    } catch (err) {
      next(err);
    }
  }

  static async createRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { name, display_name, description, permissions } = req.body;
      if (!name) {
        res.status(400).json({ error: { message: 'Role name is required', code: 'VALIDATION_ERROR' } });
        return;
      }

      const result = await AdminService.createRole({ name, display_name, description, permissions });
      res.status(201).json({ data: result, error: null });
    } catch (err) {
      next(err);
    }
  }

  static async deleteRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const roleIdOrName = req.params.id;
      const result = await AdminService.deleteRole(roleIdOrName);
      res.json({ data: result, error: null });
    } catch (err) {
      next(err);
    }
  }

  static async getPermissions(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const permissions = await AdminService.getAllPermissions();
      res.json({ data: permissions, error: null });
    } catch (err) {
      next(err);
    }
  }

  static async grantPermission(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const roleId = req.params.roleId;
      const { permission } = req.body;
      if (!permission) {
        res.status(400).json({ error: { message: 'Permission name required', code: 'VALIDATION_ERROR' } });
        return;
      }

      const result = await AdminService.grantPermissionToRole(roleId, permission);
      res.json({ data: result, error: null });
    } catch (err) {
      next(err);
    }
  }

  static async revokePermission(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { roleId, permission } = req.params;
      const result = await AdminService.revokePermissionFromRole(roleId, permission);
      res.json({ data: result, error: null });
    } catch (err) {
      next(err);
    }
  }

  static async getStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stats = await AdminService.getDashboardStats();
      res.json({ data: stats, error: null });
    } catch (err) {
      next(err);
    }
  }

  static async getUsersByRole(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const roleName = req.params.roleName;
      const users = await AdminService.getUsersByRole(roleName);
      res.json({ data: users, error: null });
    } catch (err) {
      next(err);
    }
  }

  static async getAuditLogs(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string || '50', 10);
      const offset = parseInt(req.query.offset as string || '0', 10);
      const logs = await AdminService.getAuditLogs(limit, offset);
      res.json({ data: logs, error: null });
    } catch (err) {
      next(err);
    }
  }

  static async logAction(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { action, resource_type, resource_id, details } = req.body;
      const userId = req.user?.id;
      const log = AdminService.logAdminAction({
        userId,
        action,
        resourceType: resource_type,
        resourceId: resource_id,
        details,
        ipAddress: req.ip
      });
      res.status(201).json({ data: log, error: null });
    } catch (err) {
      next(err);
    }
  }
}
