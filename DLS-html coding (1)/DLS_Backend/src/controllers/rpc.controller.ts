import { Request, Response, NextFunction } from 'express';
import { RpcService } from '../services/rpc.service.js';

export class RpcController {
  static async handleRpc(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const functionName = req.params.functionName || req.body.fn || req.query.fn;
      if (!functionName) {
        res.status(400).json({
          error: { message: 'Function name is required', code: 'VALIDATION_ERROR', status: 400 }
        });
        return;
      }

      const args = req.body.args || req.body || {};
      const result = await RpcService.execute(functionName, args, req.user);

      res.json({
        data: result,
        count: Array.isArray(result) ? result.length : null,
        error: null
      });
    } catch (err: any) {
      next(err);
    }
  }
}
