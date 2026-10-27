import { Router } from 'express';
import { AuthController } from '../controllers/auth.controller.js';
import { authMiddleware, optionalAuthMiddleware } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/login', AuthController.login);
router.post('/register', AuthController.register);
router.get('/session', optionalAuthMiddleware, AuthController.getSession);
router.post('/logout', AuthController.logout);
router.post('/reset-password', AuthController.resetPassword);
router.post('/change-password', authMiddleware, AuthController.changePassword);

export default router;
