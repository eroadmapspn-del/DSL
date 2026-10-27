import { Router } from 'express';
import { RpcController } from '../controllers/rpc.controller.js';
import { optionalAuthMiddleware } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/:functionName', optionalAuthMiddleware, RpcController.handleRpc);
router.post('/', optionalAuthMiddleware, RpcController.handleRpc);

export default router;
