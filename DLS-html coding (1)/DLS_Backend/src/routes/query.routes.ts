import { Router } from 'express';
import { QueryController } from '../controllers/query.controller.js';
import { optionalAuthMiddleware } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/data/:table', optionalAuthMiddleware, QueryController.handleTableSelect);
router.post('/data/:table', optionalAuthMiddleware, QueryController.handleTableInsert);
router.patch('/data/:table', optionalAuthMiddleware, QueryController.handleTableUpdate);
router.delete('/data/:table', optionalAuthMiddleware, QueryController.handleTableDelete);

router.post('/batch', optionalAuthMiddleware, QueryController.handleBatch);

export default router;
