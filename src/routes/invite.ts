import { PrismaClient } from "@prisma/client";
import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { connect } from "http2";
// import { sendInviteEmail } from "../services/emailService"; // We'll ignore email service for now

const prisma = new PrismaClient();
const inviteRouter = Router();

// Get invitation details
inviteRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const { inviteId } = req.query;

    if (!inviteId || typeof inviteId !== "string") {
      res.status(400).json({ error: "Invalid invite ID" });
      return;
    }

    const invite = await prisma.invite.findUnique({
      where: { id: inviteId },
      include: {
        organization: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!invite) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }

    res.json(invite);
  } catch (error) {
    console.error("Error fetching invite:", error);
    res.status(500).json({ error: "Failed to fetch invite details" });
  }
});

// Create a new invitation
// TODO: strict validation of role and organisation and team access
inviteRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, teamIds, role, organizationId } = req.body; // Changed 'teams' to 'teamIds' to match the schema
    // @ts-ignore
    const user = req.user;

    // Check if the user is part of the organization
    const userOrg = await prisma.userOrganization.findUnique({
      where: {
        userId_organizationId: {
          userId: user.id,
          organizationId: organizationId,
        },
      },
    });

    if (!userOrg) {
      res.status(403).json({ error: "User does not belong to the organization" });
    }

    // Check if the user's role is either ADMIN or MANAGER
    if (userOrg?.role !== "ADMIN" && userOrg?.role !== "MANAGER") {
      res.status(403).json({ error: "Not enough permissions" });
    }

    const invite = await prisma.invite.create({
      data: {
        email,
        role,
        invitedBy: user.id,
        organizationId: organizationId,
        teams: {
          // @ts-ignore
          create: teamIds.map(teamId => ({
            team: {
              connect: {id: teamId}
            }
          }))
        }, // Added teamIds to the invite creation
      },
    });

    console.log("Invite created:", invite);
    // TODO: send email to the invited user

    res.status(201).json({ message: "Invite sent" });
  } catch (error) {
    console.error("Error creating invite:", error);
    res.status(500).json({ error: "Failed to create invite" });
  }
});

inviteRouter.post("/accept", authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { inviteId } = req.body; // Get the invite ID from the request body
  // @ts-ignore
  const userId = req.user?.id;

  if (!inviteId || !userId) {
    res.status(400).json({ error: "Invite ID and user ID are required" });
    return;
  }

  try {
    // Fetch the invite to check its validity
    const invite = await prisma.invite.findUnique({
      where: { id: inviteId },
      include: {
        organization: true,
      },
    });

    if (!invite) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }

    // Add the user to the organization
    await prisma.userOrganization.create({
      data: {
        userId: userId,
        organizationId: invite.organizationId,
        role: invite.role,
      },
    });

    // Optionally, update the invite status to SUCCESS
    await prisma.invite.update({
      where: { id: inviteId },
      data: { status: "SUCCESS" },
    });

    res.status(200).json({ message: "Invite accepted and user added to organization" });
  } catch (error) {
    console.error("Error accepting invite:", error);
    res.status(500).json({ error: "Failed to accept invite" });
  }
});

export default inviteRouter;
