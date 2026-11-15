import { defineConfig } from 'vitest/config';
import { assertTestDatabase, testDatabaseUrl } from './test/test-database.js';

assertTestDatabase(testDatabaseUrl);

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Set before any app code loads, so src/config/env.ts sees these instead of .env.
    env: {
      DATABASE_URL: testDatabaseUrl,
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
    },
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    // All files share one database, so they run one at a time.
    fileParallelism: false,
  },
});
