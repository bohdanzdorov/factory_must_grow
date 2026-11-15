// Runs in every test file: each test starts with empty tables and a fresh clock
// that stands still unless the test moves it.
import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { useManualClock } from './helpers/clock.js';
import { resetDatabase } from './helpers/database.js';

beforeEach(async () => {
  useManualClock();
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});
