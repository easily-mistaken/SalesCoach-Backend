import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const teamRouter = Router();

// create team route
teamRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  // @ts-ignore
  const user = req.user;
  // if (user.role !== "ADMIN" || user.role !== "MANAGER") {
  //   res
  //     .status(401)
  //     .json({ message: "You are not authorized to perform this action" });
  //   return;
  // }

  // TODO: role shifted to the organization level so do the check in different way

  // user belongs to the organization
  const { name, description, organizationId } = req.body;

  const team = await prisma.team.create({
    data: {
      name,
      description,
      organizationId,
    },
  });

  res.status(201).json({ message: "Team created", team });
});

// invite user to team route
// TODO: send email to user with link to signup
// teamRouter.post(
//   "/invite",
//   async (req: Request, res: Response): Promise<void> => {
//     const { email, teamId, role } = req.body;
//     // @ts-ignore
//     const user = req.user;

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
  });

  res.json(teams);
});

// get a team by id route
teamRouter.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  const team = await prisma.team.findUnique({
    where: { id: id },
    include: {
      userOrganizations: {
        include: {
          userOrganization: {
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
