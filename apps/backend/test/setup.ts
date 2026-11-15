// Runs in every test file: each test starts with empty tables.
import { afterAll, beforeEach } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { resetDatabase } from './helpers/database.js';

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});
