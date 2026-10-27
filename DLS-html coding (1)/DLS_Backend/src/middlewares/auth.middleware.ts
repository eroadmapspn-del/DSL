import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/env.js';
import { AuthenticatedUser } from '../types/index.js';
import { memoryStore } from '../db/index.js';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.body && req.body.token) {
      token = req.body.token;
    } else if (req.query && req.query.token) {
      token = req.query.token as string;
    }

    if (!token) {
      res.status(401).json({
        error: {
          message: 'Authentication token required in Authorization header (Bearer <token>)',
          code: 'UNAUTHORIZED',
          status: 401
        }
      });
      return;
    }

    const decoded = jwt.verify(token, ENV.JWT_SECRET) as any;
    const userId = decoded.id || decoded.sub;

    const userRoles: string[] = Array.isArray(decoded.roles) ? decoded.roles : [];
    const permissions: string[] = Array.isArray(decoded.permissions) ? decoded.permissions : [];

    const authUser: AuthenticatedUser = {
      id: userId,
      email: decoded.email || '',
      full_name: decoded.full_name || 'User',
      department: decoded.department || '',
      roles: userRoles,
      permissions,
      isAdmin: decoded.isAdmin !== undefined ? decoded.isAdmin : userRoles.includes('admin')
    };

    req.user = authUser;
    next();
  } catch (err: any) {
    res.status(401).json({
      error: {
        message: 'Invalid or expired JWT token',
        code: 'TOKEN_INVALID',
        details: err.message,
        status: 401
      }
    });
  }
}

export function optionalAuthMiddleware(req: Request, _res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.body && req.body.token) {
      token = req.body.token;
    } else if (req.query && req.query.token) {
      token = req.query.token as string;
    }

    if (token) {
      const decoded = jwt.verify(token, ENV.JWT_SECRET) as any;
      const userId = decoded.id || decoded.sub;
      const userRoles: string[] = Array.isArray(decoded.roles) ? decoded.roles : [];
      const permissions: string[] = Array.isArray(decoded.permissions) ? decoded.permissions : [];

      req.user = {
        id: userId,
        email: decoded.email || '',
        full_name: decoded.full_name || 'User',
        department: decoded.department || '',
        roles: userRoles,
        permissions,
        isAdmin: decoded.isAdmin !== undefined ? decoded.isAdmin : userRoles.includes('admin')
      };
    }
  } catch (e) {
    // Ignore invalid optional auth
  }
  next();
}
