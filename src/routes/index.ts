import { Router } from 'express';
import organisationRouter from './organisation';
import { authMiddleware } from '../middleware/auth';
import userRouter from './user';

const router = Router();

router.use('/organisation', authMiddleware, organisationRouter);
router.use('/user', authMiddleware, userRouter);

export default router;