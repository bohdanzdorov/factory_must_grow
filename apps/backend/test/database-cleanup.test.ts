// Proves each test starts with empty tables. The tests in a file run in order.
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { createMachine, createOrder } from './helpers/factories.js';

describe('database cleanup between tests', () => {
  it('first test creates rows', async () => {
    await createMachine();
    await createOrder();

    expect(await prisma.machine.count()).toBe(1);
  });

  it('second test sees none of them', async () => {
    expect(await prisma.site.count()).toBe(0);
    expect(await prisma.machine.count()).toBe(0);
    expect(await prisma.order.count()).toBe(0);
  });
});
