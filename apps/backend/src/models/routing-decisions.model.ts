import type { DbClient } from '../config/prisma.js';
import type {
  CandidateRejectionReason,
  Prisma,
  RoutingDecisionKind,
  RoutingDecisionStatus,
} from '../generated/prisma/client.js';

export interface NewRoutingCandidate {
  machineId: string;
  rank: number | null;
  rejectionReason: CandidateRejectionReason | null;
  earliestStart: Date | null;
  finishAt: Date | null;
  arrivalAt: Date | null;
  slackMinutes: number | null;
}

export interface NewRoutingDecision {
  orderId: string;
  kind: RoutingDecisionKind;
  status: RoutingDecisionStatus;
  chosenMachineId: string | null;
  explanation: string;
  supersedesId: string | null;
  createdAt: Date;
  candidates: NewRoutingCandidate[];
}

// A decision with everything shown alongside it: its candidates (with each machine's site)
// in rank order, then rejected ones by machine id, and the jobs it booked.
const decisionInclude = {
  candidates: {
    include: { machine: { select: { siteId: true } } },
    orderBy: [{ rank: { sort: 'asc', nulls: 'last' } }, { machineId: 'asc' }],
  },
  jobs: { orderBy: { plannedStart: 'asc' } },
} satisfies Prisma.RoutingDecisionInclude;

export type RoutingDecisionRecord = Prisma.RoutingDecisionGetPayload<{
  include: typeof decisionInclude;
}>;

export function routingDecisionsModel(db: DbClient) {
  return {
    // Saves the decision and all its candidates together.
    async insert(data: NewRoutingDecision): Promise<RoutingDecisionRecord> {
      const { candidates, ...decision } = data;

      return db.routingDecision.create({
        data: { ...decision, candidates: { createMany: { data: candidates } } },
        include: decisionInclude,
      });
    },

    findById(id: string): Promise<RoutingDecisionRecord | null> {
      return db.routingDecision.findUnique({ where: { id }, include: decisionInclude });
    },

    // Newest first.
    findByOrderId(orderId: string): Promise<RoutingDecisionRecord[]> {
      return db.routingDecision.findMany({
        where: { orderId },
        include: decisionInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
    },

    // Changes the status only if it is still `from`, and reports whether it did. Checking and
    // changing happen in one statement, so two requests can't both change the same decision.
    async changeStatus(
      id: string,
      from: RoutingDecisionStatus,
      to: RoutingDecisionStatus,
      rejectionNote: string | null = null,
    ): Promise<boolean> {
      const { count } = await db.routingDecision.updateMany({
        where: { id, status: from },
        data: { status: to, rejectionNote },
      });
      return count === 1;
    },

    // Machines the operator rejected for this order, so routing doesn't propose them again.
    async findRejectedMachineIds(orderId: string): Promise<string[]> {
      const rows = await db.routingDecision.findMany({
        where: { orderId, status: 'REJECTED', chosenMachineId: { not: null } },
        select: { chosenMachineId: true },
        distinct: ['chosenMachineId'],
      });

      return rows.flatMap((row) => (row.chosenMachineId ? [row.chosenMachineId] : []));
    },
  };
}
