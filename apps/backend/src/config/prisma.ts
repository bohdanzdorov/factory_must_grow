import { PrismaPg } from '@prisma/adapter-pg';
import { env } from './env.js';
import { PrismaClient, type Prisma } from '../generated/prisma/client.js';

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});

export const prisma = new PrismaClient({ adapter });

// What every model function takes as its first parameter. Both the shared `prisma`
// client and the `tx` client inside `prisma.$transaction(...)` fit this type, so a
// service decides whether several model calls run in one transaction.
export type DbClient = Prisma.TransactionClient;
