import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const teamRouter = Router();

// create team route
teamRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  // @ts-ignore
  const user = req.user;
  
  // user belongs to the organization
  const { name, description, organizationId } = req.body;

  // TODO: check if the user has perm to create the team in the org
  const team = await prisma.team.create({
    data: {
      name,
      description,
      organizationId,
      members: {
        create: {
          userId: user?.id,
          organizationId,
        }
      } 
    },
  });

  res.status(201).json({ message: "Team created", team });
});

// get all teams
// TODO: different auth for this route as this returns roles based output
teamRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const { organizationId } = req.query;

  if (!organizationId) {
    res.status(400).json({ message: "Organization ID is required" });
  }

  const teams = await prisma.team.findMany({
    where: {
      organizationId: Array.isArray(organizationId)
        ? organizationId[0]
        : organizationId,
    },
    include: {
      members: {
        include: {
          userOrg: {
            include: {
              user: true,
            }   
          }
        }
      },
    }
  });

  res.json(teams);
});

// get a team by id route
teamRouter.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  const team = await prisma.team.findUnique({
    where: { id: id },
    include: {
      members: {
        include: {
          userOrg: {
            include: {
              user: true,
            }   
          }
        }
      },

    }
  });

  res.json(team);
});

// delete a team by id route
teamRouter.delete(
  "/:id",
  async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;

    await prisma.team.delete({ where: { id: id } });

    res.json({ message: "Team deleted" });
  }
);

export default teamRouter;
