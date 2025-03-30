import { PrismaClient } from "@prisma/client";
import { Router, Request, Response } from "express";
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

    const invite = await prisma.invite.create({
      data: {
        email,
        role,
        invitedBy: user.id,
        organizationId: organizationId,
        teamIds, // Added teamIds to the invite creation
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

export default inviteRouter;
