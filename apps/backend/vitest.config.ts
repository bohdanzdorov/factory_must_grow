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
      // Only unhandled server errors are logged, so a test that gets an unexpected 500 shows
      // its real cause. The error-handler test triggers one on purpose and logs it.
      LOG_LEVEL: 'error',
      // Fixed, so tests don't depend on a value in .env.
      APPROVAL_WINDOW_SECONDS: '120',
    },
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    // All files share one database, so they run one at a time.
    fileParallelism: false,
  },
});
