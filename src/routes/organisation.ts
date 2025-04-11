import { Router, Request, Response } from 'express';
import { prisma } from "../utils/prisma";

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

organisationRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
    try {
        // @ts-ignore
        const userId = req.user?.id;
        const organizationId = req.params.id;

        if (!userId) {
            res.status(401).json({ message: 'User authentication required' });
            return;
        }

        if (!organizationId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(organizationId)) {
            res.status(400).json({ message: 'Invalid organization ID format' });
            return;
        }

        // Check if user is a part of this organization
        const userOrg = await prisma.userOrganization.findFirst({
            where: {
                userId,
                organizationId
            },
            include: {
                organization: true
            }
        });

        if (!userOrg) {
            res.status(404).json({ message: 'Organization not found or access denied' });
            return;
        }

        res.status(200).json({ organization: userOrg.organization });
    } catch (error) {
        console.error('Error fetching organization:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
});

export default organisationRouter;
