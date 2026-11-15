import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Same condition as `npm run dev`, so the seed uses shared's source, not a stale build.
    seed: 'tsx --conditions=development prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
