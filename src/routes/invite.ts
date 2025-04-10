import { Router, Request, Response } from "express";
import { authMiddleware } from "../middleware/auth";
import { sendInviteEmail } from "../services/emailService";
import { prisma } from "../utils/prisma";
import { z } from "zod";

// Define validation schemas
const acceptInviteSchema = z.object({
  inviteId: z.string().uuid(),
});

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
        invitedByUser: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
        teams: {
          include: {
            team: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!invite) {
      res.status(404).json({ error: "Invite not found" });
      return;
    }

    // Check if invite has expired (older than 7 days)
    const expirationDate = new Date(invite.timestamp);
    expirationDate.setDate(expirationDate.getDate() + 7); // Add 7 days
    if (expirationDate < new Date()) {
      res.status(410).json({ error: "Invite has expired" });
      return;
    }

    // Format the response with inviter details
    const response = {
      ...invite,
      inviterName: invite.invitedByUser
        ? `${invite.invitedByUser.firstName} ${invite.invitedByUser.lastName}`
        : null,
      organizationName: invite.organization.name,
      teams: invite.teams.map(team => ({
        id: team.team.id,
        name: team.team.name,
      })),
    };

    res.json(response);
  } catch (error) {
    console.error("Error fetching invite:", error);
    res.status(500).json({ error: "Failed to fetch invite details" });
  }
});

// Create a new invitation
inviteRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, teamIds, role, organizationId } = req.body;
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
      include: {
        organization: {
          select: {
            name: true,
          },
        },
        user: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!userOrg) {
      res
        .status(403)
        .json({ error: "User does not belong to the organization" });
      return;
    }

    // Check if the user's role is either ADMIN or MANAGER
    if (userOrg?.role !== "ADMIN" && userOrg?.role !== "MANAGER") {
      res.status(403).json({ error: "Not enough permissions" });
      return;
    }

    const invite = await prisma.invite.create({
      data: {
        email,
        role,
        invitedBy: user.id,
        organizationId: organizationId,
        teams: {
          create: teamIds.map((teamId: string) => ({
            team: {
              connect: { id: teamId },
            },
          })),
        },
      },
    });

    // Send the invitation email
    try {
      const inviterName = `${userOrg.user.firstName} ${userOrg.user.lastName}`;
      await sendInviteEmail({
        email,
        inviteId: invite.id,
        organizationName: userOrg.organization.name,
        inviterName,
        inviterRole: userOrg.role,
      });

      res
        .status(201)
        .json({ message: "Invite sent successfully", inviteId: invite.id });
    } catch (emailError) {
      console.error("Failed to send invitation email:", emailError);
      // Even if email fails, the invite is created in the DB
      res.status(201).json({
        message: "Invite created but email delivery failed",
        inviteId: invite.id,
        emailError: true,
      });
    }
  } catch (error) {
    console.error("Error creating invite:", error);
    res.status(500).json({ error: "Failed to create invite" });
  }
});

inviteRouter.post(
  "/accept",
  async (req: Request, res: Response): Promise<void> => {
    try {
      // Validate request data
      const validationResult = acceptInviteSchema.safeParse(req.body);
      if (!validationResult.success) {
        res.status(400).json({ 
          error: "Invalid request data", 
          details: validationResult.error.errors 
        });
        return;
      }

      const { inviteId } = validationResult.data;
      // @ts-ignore
      const userId = req.user?.id;

      if (!userId) {
        res.status(401).json({ error: "User not authenticated" });
        return;
      }

      // Fetch the invite with its team relationships
      const invite = await prisma.invite.findUnique({
        where: { id: inviteId },
        include: {
          teams: true,
        },
      });

      if (!invite) {
        res.status(404).json({ error: "Invite not found" });
        return;
      }

      // Check if invite has already been accepted
      if (invite.status === "SUCCESS") {
        res.status(400).json({ error: "Invite has already been accepted" });
        return;
      }

      // // Check if invite has expired (older than 7 days)
      // const expirationDate = new Date(invite.timestamp);
      // expirationDate.setDate(expirationDate.getDate() + 7); // Add 7 days
      // if (expirationDate < new Date()) {
      //   res.status(410).json({ error: "Invite has expired" });
      //   return;
      // }

      // Start a transaction to ensure data consistency
      await prisma.$transaction(async (tx) => {
        // Add the user to the organization
        const userOrg = await tx.userOrganization.create({
          data: {
            userId,
            organizationId: invite.organizationId,
            role: invite.role,
          },
        });

        // Add the user to the teams they were invited to
        if (invite.teams.length > 0) {
          const teamConnections = invite.teams.map(team => ({
            userId,
            organizationId: invite.organizationId,
            teamId: team.teamId,
          }));

          await tx.userOrganizationTeam.createMany({
            data: teamConnections,
          });
        }

        // Update the invite status to SUCCESS
        await tx.invite.update({
          where: { id: inviteId },
          data: { status: "SUCCESS" },
        });
      });

      res.status(200).json({ 
        message: "Invite accepted successfully", 
        organizationId: invite.organizationId 
      });
    } catch (error) {
      console.error("Error accepting invite:", error);
      res.status(500).json({ error: "Failed to accept invite" });
    }
  }
);

export default inviteRouter;