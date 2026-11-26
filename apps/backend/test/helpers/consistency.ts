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

  // A broken machine holds no work: failure handling frees all of it.
  const onBroken = await prisma.job.findMany({
    where: {
      status: { in: ['PLANNED', 'RUNNING'] },
      machine: { status: { in: ['ERROR', 'OFFLINE'] } },
    },
    select: { id: true, machineId: true },
  });
  for (const job of onBroken) {
    problems.push(`Job ${job.id} is still active on failed machine ${job.machineId}`);
  }

  // A broken machine is never told to start work: failure handling cancels its open
  // START_JOBs, and the dispatcher doesn't queue one for a machine that isn't IDLE.
  const startsOnBroken = await prisma.command.findMany({
    where: {
      type: 'START_JOB',
      status: { in: ['PENDING', 'DELIVERED'] },
      machine: { status: { in: ['ERROR', 'OFFLINE'] } },
    },
    select: { id: true, machineId: true },
  });
  for (const command of startsOnBroken) {
    problems.push(`START_JOB ${command.id} is still open for failed machine ${command.machineId}`);
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

    // A reroute always replaces an earlier decision of the same order.
    const ids = new Set(decisions.map((decision) => decision.id));
    for (const decision of decisions) {
      if (
        decision.kind === 'REROUTE' &&
        (!decision.supersedesId || !ids.has(decision.supersedesId))
      ) {
        problems.push(`Reroute ${decision.id} doesn't replace a decision of order ${order.id}`);
      }
    }

    // Decisions nothing has replaced yet ("open"). Used instead of the newest by createdAt,
    // which can tie when two decisions are made in the same simulated millisecond.
    const replacedIds = new Set(decisions.map((decision) => decision.supersedesId));
    const open = decisions.filter((decision) => !replacedIds.has(decision.id));

    // A blocked order either has a decision saying no machine fits, or is waiting to be
    // rerouted after its machine failed: its open decision is APPROVED or SUPERSEDED, with
    // its job freed.
    if (order.status === 'BLOCKED') {
      const explained = open.some((decision) => decision.status === 'NO_ELIGIBLE_MACHINE');
      const waitingForReroute = open.some(
        (decision) =>
          (decision.status === 'APPROVED' || decision.status === 'SUPERSEDED') &&
          !decision.jobs.some((job) => job.status === 'PLANNED' || job.status === 'RUNNING'),
      );
      if (!explained && !waitingForReroute) {
        problems.push(`Order ${order.id} is BLOCKED with no reason in its decisions`);
      }
    }

    // An approved order has an open approved decision that still holds its slot.
    if (order.status === 'APPROVED') {
      const booked = open.some(
        (decision) =>
          decision.status === 'APPROVED' && decision.jobs.some((job) => job.status === 'PLANNED'),
      );
      if (!booked) {
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
