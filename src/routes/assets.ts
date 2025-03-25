import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const assetsRouter = Router();

// upload asset
assetsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
    const { content, type, date, time, status, transcript, teamId, userId } = req.body;

    const asset = await prisma.callAsset.create({
        data: { 
            content,
            type,
            date,
            time,
            status,
            transcript,
            teamId,
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

// get assets of a team by id
assetsRouter.get('/team/:id', async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const assets = await prisma.callAsset.findMany({
        where: { teamId: id },
    });

    res.status(200).json({ assets });
});

// get assets of a team by name
assetsRouter.get('/team/name/:name', async (req: Request, res: Response): Promise<void> => {
    const { name } = req.params;

    const assets = await prisma.callAsset.findMany({
        where: { team: { name } },
    });

    res.status(200).json({ assets });
});

// get assets of a team by organization id
assetsRouter.get('/team/organization/:id', async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const assets = await prisma.callAsset.findMany({
        where: { team: { organizationId: id } },
    });

    res.status(200).json({ assets });
});

export default assetsRouter;
