import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient({
    // Configure Prisma client with longer default transaction timeout
    transactionOptions: {
      maxWait: 10000, // 10s max wait time for a transaction slot
      timeout: 15000   // 15s timeout (default is 5s)
    }
});  