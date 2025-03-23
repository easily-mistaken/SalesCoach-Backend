import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const userRouter = Router();

userRouter.get('/', async (req: Request, res: Response): Promise<void> => {
    // @ts-ignore
    const user = req.user;

    res.json(user);
});

export default userRouter;