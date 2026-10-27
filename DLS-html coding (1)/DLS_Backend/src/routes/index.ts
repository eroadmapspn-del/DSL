import { Router, Request, Response, NextFunction } from 'express';
import authRoutes from './auth.routes.js';
import adminRoutes from './admin.routes.js';
import rpcRoutes from './rpc.routes.js';
import queryRoutes from './query.routes.js';
import { AuthService } from '../services/auth.service.js';
import { RpcService } from '../services/rpc.service.js';
import { QueryService } from '../services/query.service.js';
import { StorageService } from '../services/storage.service.js';
import { optionalAuthMiddleware } from '../middlewares/auth.middleware.js';
import { memoryStore } from '../db/index.js';

const apiRouter = Router();

// Universal handler function for operations from the frontend shim client
async function handleSingleOp(op: any, user: any) {
  switch (op.op) {
    case 'auth.signIn': {
      const res = await AuthService.signIn(op.email, op.password);
      return { data: res, error: null };
    }
    case 'auth.signUp': {
      const res = await AuthService.signUp({
        email: op.email,
        password: op.password,
        full_name: op.options?.data?.full_name,
        department: op.options?.data?.department
      });
      return { data: { user: res }, error: null };
    }
    case 'auth.refresh': {
      if (!user) return { data: { session: null, user: null }, error: null };
      return {
        data: {
          session: {
            user,
            access_token: user.id
          },
          user
        },
        error: null
      };
    }
    case 'auth.getUser': {
      return { data: { user }, error: null };
    }
    case 'auth.reset': {
      const res = await AuthService.resetPassword(op.email);
      return { data: res, error: null };
    }
    case 'auth.update': {
      if (user && op.password) {
        await AuthService.changePassword(user.id, op.password);
      }
      return { data: { user }, error: null };
    }
    case 'auth.signOut': {
      return { data: { ok: true }, error: null };
    }
    case 'rpc': {
      const res = await RpcService.execute(op.fn, op.args, user);
      return { data: res, count: Array.isArray(res) ? res.length : null, error: null };
    }
    case 'query': {
      const action = op.action || 'select';
      if (action === 'select') {
        const filters = (op.filters || []).map((f: any) => ({
          col: f.c,
          op: f.o,
          val: f.v
        }));
        const order = (op.order || []).map((o: any) => ({
          col: o.c,
          ascending: o.asc
        }));
        const res = await QueryService.select(op.table, {
          filters,
          order,
          limit: op.limit,
          offset: op.from
        });
        return { data: res.data, count: res.count, error: null };
      } else if (action === 'insert') {
        const res = await QueryService.insert(op.table, op.values);
        return { data: res.data, count: res.count, error: null };
      } else if (action === 'update') {
        const filters = (op.filters || []).map((f: any) => ({
          col: f.c,
          op: f.o,
          val: f.v
        }));
        const res = await QueryService.update(op.table, op.values, filters);
        return { data: res.data, count: res.count, error: null };
      } else if (action === 'delete') {
        const filters = (op.filters || []).map((f: any) => ({
          col: f.c,
          op: f.o,
          val: f.v
        }));
        const res = await QueryService.delete(op.table, filters);
        return { data: res.data, count: res.count, error: null };
      } else if (action === 'upsert') {
        const res = await QueryService.upsert(op.table, Array.isArray(op.values) ? op.values : [op.values], op.onConflict);
        return { data: res.data, count: res.count, error: null };
      }
      return { data: null, error: null };
    }
    case 'poll': {
      const versions: { [table: string]: number } = {};
      (op.tables || []).forEach((t: string) => {
        versions[t] = Date.now();
      });
      return { data: { versions }, count: null, error: null };
    }
    case 'storage.upload': {
      const res = await StorageService.uploadBase64(op.bucket, op.path, op.base64, op.contentType);
      return { data: res, error: null };
    }
    case 'storage.remove': {
      return { data: { count: op.paths?.length || 0 }, error: null };
    }
    case 'storage.list': {
      const photos = memoryStore.tables['bill_photos'] || [];
      return { data: photos, error: null };
    }
    default:
      return { data: null, error: { message: `Unknown operation: ${op.op}`, code: 'UNKNOWN_OP' } };
  }
}

// Universal POST handler for frontend client requests
apiRouter.post('/', optionalAuthMiddleware, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body;
    if (!body || (!body.op && !body.ops)) {
      return next();
    }

    if (body.op === 'batch' || Array.isArray(body.ops)) {
      const ops = body.ops || [];
      const results: any[] = [];
      for (const single of ops) {
        try {
          const r = await handleSingleOp(single, req.user);
          results.push(r);
        } catch (e: any) {
          results.push({ data: null, error: { message: e.message || String(e), code: e.code || 'ERR' } });
        }
      }
      res.json({ results });
      return;
    }

    // Single operation
    const result = await handleSingleOp(body, req.user);
    res.json(result);
  } catch (err: any) {
    res.json({
      data: null,
      error: {
        message: err.message || String(err),
        code: err.code || 'ERR',
        status: err.status || 500
      }
    });
  }
});

// Mount dedicated sub-routers
apiRouter.use('/auth', authRoutes);
apiRouter.use('/admin', adminRoutes);
apiRouter.use('/rpc', rpcRoutes);
apiRouter.use('/', queryRoutes);

// Health check endpoint
apiRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'DLS BeautyBasket Backend (Node.js + TypeScript)'
  });
});

export default apiRouter;
