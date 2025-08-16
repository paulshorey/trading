// This file will be used by other apps, so DO NOT use absolute paths starting with @/
import { PrismaClient } from "../prisma/..prisma/client";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma = globalForPrisma.prisma || new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
