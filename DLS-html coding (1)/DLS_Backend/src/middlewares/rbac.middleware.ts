import { Request, Response, NextFunction } from 'express';

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({
      error: {
        message: 'Authentication required',
        code: 'UNAUTHORIZED',
        status: 401
      }
    });
    return;
  }

  if (!req.user.isAdmin) {
    res.status(403).json({
      error: {
        message: 'Admin privileges required',
        code: 'FORBIDDEN',
        status: 403
      }
    });
    return;
  }

  next();
}

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: {
          message: 'Authentication required',
          code: 'UNAUTHORIZED',
          status: 401
        }
      });
      return;
    }

    if (req.user.isAdmin) {
      // Admins bypass all role checks
      return next();
    }

    const hasRole = req.user.roles.some(r => allowedRoles.includes(r));
    if (!hasRole) {
      res.status(403).json({
        error: {
          message: `Access denied. Requires one of roles: ${allowedRoles.join(', ')}`,
          code: 'FORBIDDEN',
          status: 403
        }
      });
      return;
    }

    next();
  };
}

export function requirePermission(...requiredPermissions: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: {
          message: 'Authentication required',
          code: 'UNAUTHORIZED',
          status: 401
        }
      });
      return;
    }

    if (req.user.isAdmin) {
      // Admins bypass permission checks
      return next();
    }

    const hasAll = requiredPermissions.every(p => req.user?.permissions.includes(p));
    if (!hasAll) {
      res.status(403).json({
        error: {
          message: `Insufficient permissions. Requires: ${requiredPermissions.join(', ')}`,
          code: 'FORBIDDEN',
          status: 403
        }
      });
      return;
    }

    next();
  };
}
