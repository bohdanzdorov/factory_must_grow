import type { Job, RoutingCandidate, RoutingDecision } from '@factorymustgrow/shared';
import type { RoutingResult } from '../domain/routing.js';
import type { Job as JobRecord } from '../generated/prisma/client.js';
import type { NewRoutingCandidate } from '../models/routing-decisions.model.js';
import type { RoutingDecisionRecord } from '../models/routing-decisions.model.js';

// Routing result → candidate rows to store. Slack is stored with 2 decimals.
export function toNewCandidates(result: RoutingResult): NewRoutingCandidate[] {
  return result.candidates.map((candidate) => ({
    machineId: candidate.machineId,
    rank: candidate.rank,
    rejectionReason: candidate.rejectionReason,
    earliestStart: candidate.earliestStart,
    finishAt: candidate.finishAt,
    arrivalAt: candidate.arrivalAt,
    slackMinutes:
      candidate.slackMinutes === null ? null : Math.round(candidate.slackMinutes * 100) / 100,
  }));
}

// Database record → API response.
export function toRoutingDecision(record: RoutingDecisionRecord): RoutingDecision {
  return {
    id: record.id,
    orderId: record.orderId,
    kind: record.kind,
    status: record.status,
    chosenMachineId: record.chosenMachineId,
    explanation: record.explanation,
    rejectionNote: record.rejectionNote,
    supersedesId: record.supersedesId,
    createdAt: record.createdAt.toISOString(),
    candidates: record.candidates.map((candidate): RoutingCandidate => ({
      machineId: candidate.machineId,
      siteId: candidate.machine.siteId,
      rank: candidate.rank,
      rejectionReason: candidate.rejectionReason,
      earliestStart: candidate.earliestStart?.toISOString() ?? null,
      finishAt: candidate.finishAt?.toISOString() ?? null,
      arrivalAt: candidate.arrivalAt?.toISOString() ?? null,
      slackMinutes: candidate.slackMinutes?.toNumber() ?? null,
    })),
    jobs: record.jobs.map(toJob),
  };
}

export function toJob(record: JobRecord): Job {
  return {
    id: record.id,
    machineId: record.machineId,
    status: record.status,
    plannedStart: record.plannedStart.toISOString(),
    plannedEnd: record.plannedEnd.toISOString(),
  };
}
