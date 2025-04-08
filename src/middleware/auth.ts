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
  // Fetch both token cookies

  try {
    const token = req.headers.authorization?.split(" ")[1];
    console.log("token", token);

    if (!token) {
      console.log("no token");
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
          console.log("invalid token");
          return;
        }

        console.log("decoded", decoded);

        // Fetch user from the database using Prisma
        const user = await prisma.user.findUnique({
          where: { id: decoded.sub },
          include: {
            organizations: {
              include: {
                organization: {
                  include: {
                    callAssets: true,
                  },
                },
                teamAccess: true,
              },
            },
          },
        });

        if (!user) {
          res.status(401).json({ message: "Unauthorized" });
          console.log("no user");
          return;
        }

        console.log("user", user);

        // @ts-ignore
        req.user = user;
        next();
      }
    );
  } catch (error) {
    console.log("Error parsing token:", error);
    res.status(500).json({ message: "Internal server error" });
    return;
  }
};
