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
    // Extract token from Authorization header
    const authHeader = req.headers.authorization;
    console.log(
      "Authorization header:",
      authHeader ? `${authHeader.substring(0, 20)}...` : "undefined"
    );

    const token = authHeader?.split(" ")[1];

    if (!token) {
      console.log("No token found in Authorization header");
      res.status(401).json({ message: "Unauthorized - No token provided" });
      return;
    }

    console.log("Token first 20 chars:", `${token.substring(0, 20)}...`);
    console.log(
      "JWT_SECRET first 10 chars:",
      process.env.JWT_SECRET
        ? `${process.env.JWT_SECRET.substring(0, 10)}...`
        : "undefined"
    );

    // Verify the access token
    jwt.verify(
      token,
      process.env.JWT_SECRET as string,
      async (err: any, decoded: any) => {
        if (err) {
          console.log("JWT verification error type:", err.name);
          console.log("JWT verification error message:", err.message);
          res.status(401).json({ message: "Unauthorized - Invalid token" });
          return;
        }

        console.log("JWT verification successful");
        console.log("Decoded token:", JSON.stringify(decoded, null, 2));

        // Check what user ID field exists in the decoded token
        const userId = decoded.sub || decoded.user_id || decoded.id;
        console.log("Extracted user ID:", userId);

        if (!userId) {
          console.log("No user ID found in decoded token");
          res
            .status(401)
            .json({ message: "Unauthorized - No user ID in token" });
          return;
        }

        // Log a few users from the database for comparison
        try {
          const sampleUsers = await prisma.user.findMany({
            select: { id: true, email: true },
            take: 3,
          });
          console.log("Sample users in database:", sampleUsers);
        } catch (dbError) {
          console.log("Error fetching sample users:", dbError);
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
                    },
                  },
                  teamAccess: true,
                },
              },
            },
          });

          if (!user) {
            console.log(`No user found with ID: ${userId}`);
            res.status(401).json({ message: "Unauthorized - User not found" });
            return;
          }

          console.log(`Found user: ${user.email}`);

          // @ts-ignore
          req.user = user;
          next();
        } catch (userError) {
          console.log("Error fetching user from database:", userError);
          res.status(500).json({ message: "Server error fetching user" });
          return;
        }
      }
    );
  } catch (error) {
    console.log("Error in auth middleware:", error);
    res.status(500).json({ message: "Internal server error" });
    return;
  }
};
