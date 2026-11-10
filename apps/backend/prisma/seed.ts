// Replaces all data with the seed in prisma/seed-data.ts. Run with `npm run db:seed`.
import { env } from '../src/config/env.js';
import { prisma } from '../src/config/prisma.js';
import { machines, orders, shippingDays, sites } from './seed-data.js';

const DAY_MS = 24 * 60 * 60 * 1000;

if (env.NODE_ENV === 'production') {
  console.error('Refusing to seed: NODE_ENV is production, and seeding deletes all data.');
  process.exit(1);
}

const now = Date.now();

try {
  await prisma.$transaction(async (tx) => {
    // Children before parents, so foreign keys never block a delete.
    await tx.command.deleteMany();
    await tx.machineEvent.deleteMany();
    await tx.routingCandidate.deleteMany();
    await tx.job.deleteMany();
    await tx.routingDecision.deleteMany();
    await tx.order.deleteMany();
    await tx.shippingLeadTime.deleteMany();
    await tx.machineCapability.deleteMany();
    await tx.machine.deleteMany();
    await tx.site.deleteMany();

    await tx.site.createMany({ data: sites });
    await tx.machine.createMany({
      data: machines.map(({ id, siteId, name }) => ({ id, siteId, name })),
    });
    await tx.machineCapability.createMany({
      data: machines.flatMap((machine) =>
        machine.capabilities.map((capability) => ({ machineId: machine.id, ...capability })),
      ),
    });
    await tx.shippingLeadTime.createMany({
      data: Object.entries(shippingDays).flatMap(([siteId, byDestination]) =>
        Object.entries(byDestination).map(([destination, days]) => ({ siteId, destination, days })),
      ),
    });
    await tx.order.createMany({
      data: orders.map(({ daysUntilDeadline, ...order }) => ({
        ...order,
        deadline: new Date(now + daysUntilDeadline * DAY_MS),
      })),
    });
  });

  console.log(
    `Seeded ${String(sites.length)} sites, ${String(machines.length)} machines and ${String(orders.length)} orders.`,
  );
} finally {
  await prisma.$disconnect();
}
