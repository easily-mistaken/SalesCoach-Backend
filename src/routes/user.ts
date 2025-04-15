import { Router, Request, Response } from "express";
import { prisma } from "../utils/prisma";

const userRouter = Router();

userRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  // @ts-ignore
  const user = req.user;

  res.json(user);
});

// Update current user
userRouter.put("/", async (req: Request, res: Response): Promise<void> => {
  // @ts-ignore
  const user = req.user;

  if (!user || !user.id) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  const { firstName, lastName } = req.body;

  try {
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName,
        lastName,
      },
    });

    res.json(updatedUser);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ message: "Failed to update user" });
  }
});

export default userRouter;
