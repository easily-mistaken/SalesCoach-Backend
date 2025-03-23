import { Router } from 'express';
import organisationRouter from './organisation';
import { authMiddleware } from '../middleware/auth';
import userRouter from './user';
import teamRouter from './team';

const router = Router();

router.use('/organisation', authMiddleware, organisationRouter);
router.use('/user', authMiddleware, userRouter);
router.use('/team', authMiddleware, teamRouter);

export default router;