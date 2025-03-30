import { Router, Request, Response } from "express";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const teamRouter = Router();

// create team route
teamRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  // @ts-ignore
  const user = req.user;
  if (user.role !== "ADMIN" || user.role !== "MANAGER") {
    res
      .status(401)
      .json({ message: "You are not authorized to perform this action" });
    return;
  }

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

//     const invite = await prisma.invite.create({
//       data: {
//         email,
//         teamId,
//         role,
//         invitedBy: user.id,
//         organizationId: user.organizationId,
//       },
//     });

//     // send email to the invited user

//     res.status(201).json({ message: "Invite sent" });
//   }
// );

// get all teams
// TODO: different auth for this route as this returns roles based output
teamRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const { organizationId } = req.query;

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

// remove user from team route

export default teamRouter;
