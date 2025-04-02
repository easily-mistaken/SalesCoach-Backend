import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const assetsRouter = Router();

// upload asset
assetsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
    const { content, type, status, transcript, userId } = req.body;

    const asset = await prisma.callAsset.create({
        data: { 
            content,
            type,
            status,
            transcript,
            userId,
        },
    });

    res.status(201).json({ message: 'Asset created', asset });
});

// get assets of a user
assetsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
    const { userId } = req.body;

    const assets = await prisma.callAsset.findMany({
        where: { userId },
    });

    res.status(200).json({ assets });
});


export default assetsRouter;
