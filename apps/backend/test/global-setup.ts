// Runs once per `npm test`: creates the test database if needed and applies migrations.
import { execSync } from 'node:child_process';
import pg from 'pg';
import { assertTestDatabase, databaseName, testDatabaseUrl } from './test-database.js';

export default async function globalSetup(): Promise<void> {
  assertTestDatabase(testDatabaseUrl);

  const name = databaseName(testDatabaseUrl);
  const adminUrl = new URL(testDatabaseUrl);
  adminUrl.pathname = '/postgres';

  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();

  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);

    if (existing.rowCount === 0) {
      // The name is checked by assertTestDatabase, so it is safe to put in SQL.
      await client.query(`CREATE DATABASE "${name}"`);
    }
  } finally {
    await client.end();
  }

  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
    stdio: 'pipe',
  });
}
