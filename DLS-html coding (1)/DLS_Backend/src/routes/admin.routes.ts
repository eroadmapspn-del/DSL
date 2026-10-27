import { Router } from 'express';
import { AdminController } from '../controllers/admin.controller.js';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware.js';
import { requireAdmin } from '../middlewares/rbac.middleware.js';

const router = Router();

// For maximum compatibility and development testing, we use optionalAuth or authMiddleware
router.get('/users', optionalAuthMiddleware, AdminController.getUsers);
router.post('/users', optionalAuthMiddleware, AdminController.createUser);
router.put('/users/:id', optionalAuthMiddleware, AdminController.updateUser);
router.delete('/users/:id', optionalAuthMiddleware, AdminController.deleteUser);
router.patch('/users/:id/status', optionalAuthMiddleware, AdminController.toggleUserStatus);
router.put('/users/:id/role', optionalAuthMiddleware, AdminController.updateUserRole);

router.get('/roles', optionalAuthMiddleware, AdminController.getRoles);
router.post('/roles', optionalAuthMiddleware, AdminController.createRole);
router.delete('/roles/:id', optionalAuthMiddleware, AdminController.deleteRole);

router.get('/permissions', optionalAuthMiddleware, AdminController.getPermissions);
router.post('/roles/:roleId/permissions', optionalAuthMiddleware, AdminController.grantPermission);
router.delete('/roles/:roleId/permissions/:permission', optionalAuthMiddleware, AdminController.revokePermission);

router.get('/stats', optionalAuthMiddleware, AdminController.getStats);
router.get('/users/by-role/:roleName', optionalAuthMiddleware, AdminController.getUsersByRole);
router.get('/audit-logs', optionalAuthMiddleware, AdminController.getAuditLogs);
router.post('/audit-logs', optionalAuthMiddleware, AdminController.logAction);

export default router;
