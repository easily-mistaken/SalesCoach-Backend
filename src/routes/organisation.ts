import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const organisationRouter = Router();

organisationRouter.get('/', async (req: Request, res: Response): Promise<void> =>{
    try {
        // @ts-ignore
        const userId = req.user?.id;
        const organisations = await prisma.userOrganization.findMany({
            where: {
                userId: userId
            },
            include: {
                organization: true,
            }
        })

        res.json(organisations)
    } catch {
        res.status(500).json({ message: 'Internal server error' });
    }
});

organisationRouter.post('/', async (req: Request, res: Response): Promise<void> => {
    const { name, phone, address, city, state, zip, country } = req.body;

    // @ts-ignore
    const userId = req.user?.id;

    if (!name || !userId) {
        res.status(400).json({ message: 'Organisation name and user ID are required' });
        return;
    }

    try {
        const newOrganisation = await prisma.organization.create({
            data: {
                name,
                phone,
                address,
                city,
                state,
                zip,
                country,
                users: {
                    create: {
                        userId: userId,
                        role: "ADMIN"
                    },
                },
            },
        });

        res.status(201).json({ message: 'Organisation created', organisation: newOrganisation });
    } catch (error) {
        console.error('Error creating organisation:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default organisationRouter;
