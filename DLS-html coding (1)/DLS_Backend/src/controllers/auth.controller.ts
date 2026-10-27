import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service.js';

export class AuthController {
  static async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: { message: 'Email and password are required', code: 'VALIDATION_ERROR' } });
        return;
      }

      const result = await AuthService.signIn(email, password);
      res.json({
        data: result,
        error: null
      });
    } catch (err) {
      next(err);
    }
  }

  static async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password, full_name, department, role } = req.body;
      if (!email || !password) {
        res.status(400).json({ error: { message: 'Email and password are required', code: 'VALIDATION_ERROR' } });
        return;
      }

      const result = await AuthService.signUp({ email, password, full_name, department, role });
      res.status(201).json({
        data: result,
        error: null
      });
    } catch (err) {
      next(err);
    }
  }

  static async getSession(req: Request, res: Response, _next: NextFunction): Promise<void> {
    if (!req.user) {
      res.json({ data: { session: null, user: null }, error: null });
      return;
    }

    res.json({
      data: {
        session: {
          user: req.user,
          access_token: req.headers.authorization?.split(' ')[1] || null
        },
        user: req.user
      },
      error: null
    });
  }

  static async logout(_req: Request, res: Response, _next: NextFunction): Promise<void> {
    res.json({
      data: { message: 'Successfully logged out' },
      error: null
    });
  }

  static async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = req.body;
      if (!email) {
        res.status(400).json({ error: { message: 'Email is required', code: 'VALIDATION_ERROR' } });
        return;
      }

      const result = await AuthService.resetPassword(email);
      res.json({
        data: result,
        error: null
      });
    } catch (err) {
      next(err);
    }
  }

  static async changePassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user?.id;
      const { newPassword } = req.body;
      if (!userId || !newPassword) {
        res.status(400).json({ error: { message: 'New password required', code: 'VALIDATION_ERROR' } });
        return;
      }

      const result = await AuthService.changePassword(userId, newPassword);
      res.json({ data: result, error: null });
    } catch (err) {
      next(err);
    }
  }
}
