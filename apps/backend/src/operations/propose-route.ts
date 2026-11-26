// Proposing a machine for an order: loads the data, runs the pure routing function, and saves
// the decision, its candidates and the job holding the slot. Shared by routing an order
// (services/routing.service.ts) and rerouting after a failure (operations/machine-failure.ts).
import { getClock } from '../config/clock.js';
import type { Models } from '../config/database.js';
import { env } from '../config/env.js';
import { routeOrder as decideRoute } from '../domain/routing.js';
import { ChosenMachineFailedError } from '../errors/routing-errors.js';
import type { Order, RoutingDecisionKind } from '../generated/prisma/client.js';
import { toNewCandidates } from '../mappers/routing-decision.mapper.js';

export interface ProposedRoute {
  // Null only when no machine fits and saveWhenNoMachine was false: nothing was saved.
  decisionId: string | null;
  // True if a machine was chosen and its slot booked; false if no machine fits.
  booked: boolean;
  explanation: string;
}

// Routes the order and saves the result: a PROPOSED decision with its job booked, or a
// NO_ELIGIBLE_MACHINE decision with no job. Doesn't change the order's status; the caller
// does that (ROUTED for a first routing, REROUTE_PENDING for a reroute, or BLOCKED).
//
// `kind` and `supersedesId` say whether this is a first routing or a reroute, and which
// decision it replaces. `reason`, if given, starts the explanation (why it was rerouted).
// `saveWhenNoMachine: false` saves nothing when no machine fits (an automatic retry that
// would otherwise add the same 'no eligible machine' decision again and again).
//
// Throws a booking conflict or ChosenMachineFailedError when something changed at the same
// moment; run it inside inBookingTransaction, which routes again.
export async function proposeRoute(
  tx: Models,
  order: Order,
  options: {
    kind: RoutingDecisionKind;
    supersedesId: string | null;
    reason?: string;
    saveWhenNoMachine?: boolean;
  },
): Promise<ProposedRoute> {
  const clock = getClock();
  const now = clock.now();

  const machines = await tx.machines.findMany({});
  const sites = await tx.sites.findAll();
  const reservations = await tx.jobs.findActiveReservations(now);
  const shippingDays = await tx.shippingLeadTimes.daysToDestination(order.destination);
  const excludedMachineIds = await tx.routingDecisions.findRejectedMachineIds(order.id);

  const result = decideRoute({
    order,
    machines: machines.map((machine) => ({
      id: machine.id,
      siteId: machine.siteId,
      status: machine.status,
      capabilities: machine.capabilities.map((capability) => ({
        capability: capability.capability,
        cycleMinutesPerPart: capability.cycleMinutesPerPart.toNumber(),
      })),
    })),
    sites,
    reservations,
    shippingDays,
    excludedMachineIds,
    now,
    // The window is set in real seconds; the clock scale turns it into simulated time.
    approvalWindowMs: env.APPROVAL_WINDOW_SECONDS * 1000 * clock.scale,
  });

  const chosen = result.chosen;

  if (chosen) {
    // The machines were read without a lock, so the chosen one may have failed since. Lock
    // it and look again: if it failed, nothing is saved and routing runs again. This also
    // makes a failure in progress on it finish first, so we never book on a machine whose
    // jobs the failure has already collected.
    const status = await tx.machines.lockAndReadStatus(chosen.machineId);
    if (status === 'ERROR' || status === 'OFFLINE') {
      throw new ChosenMachineFailedError(chosen.machineId);
    }
  }

  const explanation = options.reason
    ? `${options.reason} ${result.explanation}`
    : result.explanation;

  if (!chosen && options.saveWhenNoMachine === false) {
    return { decisionId: null, booked: false, explanation };
  }

  const decision = await tx.routingDecisions.insert({
    orderId: order.id,
    kind: options.kind,
    status: chosen ? 'PROPOSED' : 'NO_ELIGIBLE_MACHINE',
    chosenMachineId: chosen?.machineId ?? null,
    explanation,
    supersedesId: options.supersedesId,
    createdAt: now,
    candidates: toNewCandidates(result),
  });

  if (chosen) {
    // A chosen machine always has a slot. If not, routing has a bug: fail loudly rather than
    // save a proposal that books nothing.
    if (!chosen.earliestStart || !chosen.finishAt) {
      throw new Error(`Routing chose ${chosen.machineId} without a time slot`);
    }

    // Fails with a job_no_overlap error if another request took this slot meanwhile.
    await tx.jobs.insert({
      routingDecisionId: decision.id,
      machineId: chosen.machineId,
      plannedStart: chosen.earliestStart,
      plannedEnd: chosen.finishAt,
    });
  }

  return { decisionId: decision.id, booked: chosen !== null, explanation };
}
