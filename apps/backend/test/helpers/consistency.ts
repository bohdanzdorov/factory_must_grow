// Checks that the whole database agrees with itself. Returns a description of every problem
// found; an empty list means consistent. Used after concurrency tests, where responses alone
// can look fine while the data underneath is wrong.
import { prisma } from '../../src/config/prisma.js';

export async function findInconsistencies(): Promise<string[]> {
  const problems: string[] = [];

  // Rule 1: no two active jobs on one machine overlap.
  const overlaps = await prisma.$queryRaw<{ a: string; b: string; machine_id: string }[]>`
    SELECT a.id AS a, b.id AS b, a.machine_id
    FROM job a
    JOIN job b ON a.machine_id = b.machine_id AND a.id < b.id
      AND tstzrange(a.planned_start, a.planned_end) && tstzrange(b.planned_start, b.planned_end)
    WHERE a.status IN ('PLANNED', 'RUNNING') AND b.status IN ('PLANNED', 'RUNNING')
  `;
  for (const overlap of overlaps) {
    problems.push(`Jobs ${overlap.a} and ${overlap.b} overlap on ${overlap.machine_id}`);
  }

  const orders = await prisma.order.findMany({
    include: {
      routingDecisions: {
        include: { jobs: true },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      },
    },
  });

  for (const order of orders) {
    const decisions = order.routingDecisions;
    const proposed = decisions.filter((decision) => decision.status === 'PROPOSED');

    // Every proposal holds exactly one booked slot.
    for (const decision of proposed) {
      const planned = decision.jobs.filter((job) => job.status === 'PLANNED');
      if (planned.length !== 1) {
        problems.push(`Proposal ${decision.id} has ${String(planned.length)} PLANNED jobs`);
      }
    }

    // A proposal waiting for approval means exactly one PROPOSED decision; otherwise none.
    const waitingForApproval = order.status === 'ROUTED' || order.status === 'REROUTE_PENDING';
    if (waitingForApproval && proposed.length !== 1) {
      problems.push(
        `Order ${order.id} is ${order.status} with ${String(proposed.length)} proposals`,
      );
    }
    if (!waitingForApproval && proposed.length > 0) {
      problems.push(`Order ${order.id} is ${order.status} but has an open proposal`);
    }

    // A blocked order's newest decision explains why.
    if (order.status === 'BLOCKED' && decisions[0]?.status !== 'NO_ELIGIBLE_MACHINE') {
      problems.push(`Order ${order.id} is BLOCKED without a NO_ELIGIBLE_MACHINE decision`);
    }

    // An approved order's newest decision is approved and still holds its slot.
    if (order.status === 'APPROVED') {
      const newest = decisions[0];
      const holdsSlot = newest?.jobs.some((job) => job.status === 'PLANNED') ?? false;
      if (newest?.status !== 'APPROVED' || !holdsSlot) {
        problems.push(`Order ${order.id} is APPROVED without an approved, booked decision`);
      }
    }

    // A draft has never been routed, or its last proposal was rejected or expired.
    if (
      order.status === 'DRAFT' &&
      decisions[0] &&
      !['REJECTED', 'EXPIRED'].includes(decisions[0].status)
    ) {
      problems.push(`Order ${order.id} is DRAFT but its newest decision is ${decisions[0].status}`);
    }
  }

  return problems;
}
