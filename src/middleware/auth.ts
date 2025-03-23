// TODO: a middlware to fetch the user details and store it in the req.user object
// Cookie NAME: sb-olxzxwlzliidocxvlcdq-auth-token.0

import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Middleware to fetch user details and store it in req.user
export const authMiddleware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Fetch both token cookies

    try {
    const tokenCookie0 = req.cookies ? req.cookies['sb-olxzxwlzliidocxvlcdq-auth-token.0'] : null;
    const tokenCookie1 = req.cookies ? req.cookies['sb-olxzxwlzliidocxvlcdq-auth-token.1'] : null;

    if (!tokenCookie0 || !tokenCookie1) {
        console.log('One or both token cookies not found');
        res.status(401).json({ message: 'Unauthorized' });
        return;
    }

    console.log('this is executed');

    // Concatenate the two Base64 tokens
    const combinedBase64Token = tokenCookie0.replace('base64-', '') + tokenCookie1.replace('base64-', '');

    // Decode the combined token
    const decodedToken = Buffer.from(combinedBase64Token, 'base64').toString('utf-8');

        // Check if the decoded token is a valid JSON string
        if (!decodedToken || decodedToken.trim() === '') {
            console.log('Decoded token is empty or invalid');
            res.status(401).json({ message: 'Unauthorized' });
            return;
        }

        // Attempt to parse the token data
        let tokenData = JSON.parse(decodedToken);

        // Check if the tokenData has the expected structure
        if (!tokenData.access_token || !tokenData.user || !tokenData.user.id) {
            console.log('Incomplete token data:', tokenData);
            res.status(400).json({ message: 'Incomplete token data' });
            return;
        }

        console.log('Token data after parsing:', tokenData);
        // Verify the access token
        jwt.verify(tokenData.access_token, process.env.JWT_SECRET as string, async (err: any, decoded: any) => {
            if (err) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            console.log('After verification, decoded token:', decoded);

            // Fetch user from the database using Prisma
            const user = await prisma.user.findUnique({
                where: { id: decoded.sub },
            });

            console.log('User after fetching:', user);

            if (!user) {
                res.status(401).json({ message: 'Unauthorized' });
                return;
            }

            // @ts-ignore
            req.user = user;
            next();
        });
    } catch (error) {
        console.log('Error parsing token:', error);
        res.status(500).json({ message: 'Internal server error' });
        return;
    }
};
