import { Router } from 'express';
import organisationRouter from './organisation';

const router = Router();

router.use('/organisation', organisationRouter);

export default router;
