import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const userRouter = Router();

userRouter.get('/', async (req: Request, res: Response): Promise<void> => {
    // @ts-ignore
    const { id } = req.user;

    const user = await prisma.user.findUnique({
        where: {
            id: id,
        },
        include: {
            organizations: {
                include: {
                    organization: {
                        include: {
                            teams: true,
                        },
                    },
                },
            },
        },
    });

    res.json(user);
});

export default userRouter;