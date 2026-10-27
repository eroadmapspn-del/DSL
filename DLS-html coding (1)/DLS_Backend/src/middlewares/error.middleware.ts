import { Request, Response, NextFunction } from 'express';

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction): void {
  console.error('🔥 Server Error:', err);

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  const code = err.code || 'SERVER_ERROR';
  const details = err.details || null;
  const hint = err.hint || null;

  res.status(status).json({
    error: {
      message,
      code,
      details,
      hint,
      status
    }
  });
}
