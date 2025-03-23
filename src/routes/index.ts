import { Router } from 'express';
import organisationRouter from './organisation';
import { authMiddleware } from '../middleware/auth';

const router = Router();

router.use('/organisation', authMiddleware, organisationRouter);

export default router;