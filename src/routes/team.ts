import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { adminOrManagerOfOrg } from '../middleware/adminOrManagerOfOrg';

const prisma = new PrismaClient();

const teamRouter = Router();

// create team route
teamRouter.post('/', adminOrManagerOfOrg, async (req: Request, res: Response): Promise<void> => {
    // @ts-ignore
    const user = req.user;
    const { name, description, organizationId } = req.body;

    const team = await prisma.team.create({
                    data: {
                        name,
                        description,
                        organizationId,
                    },
                });

    res.status(201).json({ message: 'Team created', team });
});

// invite user to team route
// TODO: new table of invites with email, timestamp, invitedBy, teamId
// TODO: send email to user with link to signup

// get all teams
teamRouter.get('/', adminOrManagerOfOrg, async (req: Request, res: Response): Promise<void> => {
    const { organizationId } = req.params;

    const teams = await prisma.team.findMany({
        where: {
            organizationId: organizationId,
        },
    });

    res.json(teams);
});

// get a team by id route
teamRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    const team = await prisma.team.findUnique({
        where: { id: id },
    });

    res.json(team);
});

// delete a team by id route
teamRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    await prisma.team.delete({ where: { id: id } });

    res.json({ message: 'Team deleted' });
});

// add user to team route
// remove user from team route
// get all users in a team route

export default teamRouter;