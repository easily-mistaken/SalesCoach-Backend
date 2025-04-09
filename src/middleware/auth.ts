import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Middleware to fetch user details and store it in req.user
export const authMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    // Verify the access token
    jwt.verify(
      token,
      process.env.JWT_SECRET as string,
      async (err: any, decoded: any) => {
        if (err) {
          res.status(401).json({ message: "Unauthorized" });
          return;
        }

        // Extract user ID from token
        const userId = decoded.sub || decoded.user_id || decoded.id;

        if (!userId) {
          res.status(401).json({ message: "Unauthorized" });
          return;
        }

        // Fetch user from the database using Prisma
        try {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            include: {
              organizations: {
                include: {
                  organization: {
                    include: {
                      callAssets: true,
                    }
                  },
                  teamAccess: {
                    include: {
                      team: true
                    }
                  },
                },
              },
            },
          });

          if (!user) {
            res.status(401).json({ message: "Unauthorized" });
            return;
          }

          // @ts-ignore
          req.user = user;
          next();
        } catch (userError) {
          console.log(userError)
          res.status(500).json({ message: "Internal server error" });
          return;
        }
      }
    );
  } catch (error) {
    console.log(error)
    res.status(500).json({ message: "Internal server error" });
    return;
  }
};
