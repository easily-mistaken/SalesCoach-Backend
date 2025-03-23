import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const organisationRouter = Router();

// TODO: Implement the route for creating a new organisation
organisationRouter.post('/', async (req: Request, res: Response): Promise<void> => {
    const { name, phone, address, city, state, zip, country } = req.body;

    // @ts-ignore
    const userId = req.user?.id;
    // Validate the input
    if (!name || !userId) {
        res.status(400).json({ message: 'Organisation name and user ID are required' });
        return;
    }

    try {
        // Create a new organisation and associate it with the user in the database
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

// Export the organisation router
export default organisationRouter;
