import { env } from '../../src/config/env.js';
import { prisma } from '../../src/config/prisma.js';
import { assertTestDatabase } from '../test-database.js';

let tableNames: string[] | undefined;

// Empties every table except Prisma's migration history.
export async function resetDatabase(): Promise<void> {
  assertTestDatabase(env.DATABASE_URL);

  tableNames ??= (
    await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `
  ).map((row) => `"${row.tablename}"`);

  await prisma.$executeRawUnsafe(`TRUNCATE ${tableNames.join(', ')} RESTART IDENTITY CASCADE`);
}
