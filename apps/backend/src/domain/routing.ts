// Routing: decides which machine should make an order.
//
// This is a pure function: everything it needs is passed in as arguments, it reads nothing
// from the database or the clock, and it changes nothing. The same input always gives the
// same result, which makes it easy to test and to explain. The caller (the routing service,
// W2-04) loads the data, calls `routeOrder`, and saves the decision.
//
// The rules are documented in docs/design-decisions.md under "Routing".
import type {
  Capability,
  CandidateRejectionReason,
  MachineStatus,
  SiteStatus,
} from '../generated/prisma/enums.js';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

// The parts of an order that routing needs.
export interface RoutingOrder {
  quantity: number;
  // A machine must have every one of these to be considered.
  requiredCapabilities: Capability[];
  // The parts must *arrive* at the destination by this time, so shipping counts too.
  deadline: Date;
  // Country code, such as "DE". Used to look up shipping times.
  destination: string;
}

export interface RoutingMachine {
  id: string;
  siteId: string;
  status: MachineStatus;
  // What the machine can do, and how many minutes one part takes for each.
  capabilities: { capability: Capability; cycleMinutesPerPart: number }[];
}

export interface RoutingSite {
  id: string;
  status: SiteStatus;
}

// The time an active job (PLANNED or RUNNING) holds on a machine. Routing must not place a
// new job on top of one; the database enforces the same rule with an exclusion constraint.
export interface Reservation {
  machineId: string;
  start: Date;
  end: Date;
}

export interface RoutingInput {
  order: RoutingOrder;
  machines: RoutingMachine[];
  sites: RoutingSite[];
  reservations: Reservation[];
  // Days to ship from each site to *this order's* destination, keyed by site id.
  // A site missing from this object has no shipping route.
  shippingDays: Partial<Record<string, number>>;
  // Machines the operator already rejected for this order. Without this, routing the
  // order again would pick the same machine, because routing is deterministic.
  excludedMachineIds: string[];
  // The current simulated time, from the clock.
  now: Date;
  // Simulated milliseconds a proposal stays open for approval. No job is planned to start
  // sooner, so a proposal cannot expire while the operator is still reading it.
  approvalWindowMs: number;
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

// What routing found out about one machine. Every machine gets a candidate, including
// rejected ones, because every decision records why the other machines lost (rule 4).
export interface RoutingCandidate {
  machineId: string;
  siteId: string;
  // 1 is the best viable machine, 2 the next, and so on. Null when rejected.
  rank: number | null;
  // Why the machine was ruled out. Null for viable machines.
  rejectionReason: CandidateRejectionReason | null;
  // Timing is null when the machine was rejected before its schedule was looked at,
  // for example because it lacks a capability. Machines rejected for missing the deadline
  // keep their timing, so the explanation can say how late they would be.
  earliestStart: Date | null;
  finishAt: Date | null;
  // When the parts reach the customer: finish plus shipping.
  arrivalAt: Date | null;
  // Deadline minus arrival. Positive means time to spare; negative means late.
  slackMinutes: number | null;
}

export interface RoutingResult {
  // The best viable machine, or null if there is none (the order becomes BLOCKED).
  chosen: RoutingCandidate | null;
  // Viable machines by rank, then rejected machines by id.
  candidates: RoutingCandidate[];
  // One human-readable sentence summarising the decision.
  explanation: string;
}

// ---------------------------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------------------------

export function routeOrder(input: RoutingInput): RoutingResult {
  const { order, now } = input;

  // Prepare lookups once, so the loop below doesn't search arrays repeatedly.
  const sitesById = new Map(input.sites.map((site) => [site.id, site]));
  const excluded = new Set(input.excludedMachineIds);
  const reservationsByMachine = groupReservations(input.reservations);
  const siteLoad = siteLoadMinutes(input.machines, reservationsByMachine, now);

  // No job may start before the approval window has passed.
  const earliestAllowed = now.getTime() + input.approvalWindowMs;

  const viable: RoutingCandidate[] = [];
  const rejected: RoutingCandidate[] = [];

  // Machines are processed sorted by id, so the result never depends on the order
  // in which the caller happened to pass them in.
  for (const machine of [...input.machines].sort((a, b) => compareIds(a.id, b.id))) {
    // Step 1: rule out machines that can't do the job at all.
    const unschedulable = rejectionBeforeScheduling(machine, input, sitesById, excluded);

    if (unschedulable) {
      rejected.push(rejectedCandidate(machine, unschedulable));
      continue;
    }

    // Step 2: work out when this machine could make the parts.
    // The `?? 0` never applies: machines without a shipping route were rejected above.
    const shippingDays = input.shippingDays[machine.siteId] ?? 0;
    const durationMs = productionMs(machine, order);
    const start = findEarliestGap(
      reservationsByMachine.get(machine.id) ?? [],
      earliestAllowed,
      durationMs,
    );
    const finish = start + durationMs;
    const arrival = finish + shippingDays * DAY_MS;

    // Step 3: compare the arrival with the deadline.
    const slackMinutes = (order.deadline.getTime() - arrival) / MINUTE_MS;

    const candidate: RoutingCandidate = {
      machineId: machine.id,
      siteId: machine.siteId,
      rank: null,
      rejectionReason: slackMinutes < 0 ? 'MISSES_DEADLINE' : null,
      earliestStart: new Date(start),
      finishAt: new Date(finish),
      arrivalAt: new Date(arrival),
      slackMinutes,
    };

    (slackMinutes < 0 ? rejected : viable).push(candidate);
  }

  // Step 4: rank the viable machines. Each rule only matters when the ones before it tie:
  //   1. Most slack, so the order has the biggest safety margin.
  //   2. Least loaded site, to spread work across the network.
  //   3. Machine id, so identical machines always produce the same answer.
  // In a sort comparator, `||` moves on to the next rule when the previous one returns 0.
  viable.sort(
    (a, b) =>
      (b.slackMinutes ?? 0) - (a.slackMinutes ?? 0) ||
      (siteLoad.get(a.siteId) ?? 0) - (siteLoad.get(b.siteId) ?? 0) ||
      compareIds(a.machineId, b.machineId),
  );
  viable.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });

  // Step 5: the best-ranked machine wins. None means the order becomes BLOCKED.
  const chosen = viable[0] ?? null;

  return {
    chosen,
    candidates: [...viable, ...rejected],
    explanation: explain(chosen, viable.length, rejected),
  };
}

// The first reason that rules a machine out without looking at its schedule.
// The checks run in a fixed order, so a machine with several problems always reports the
// same one. An operator rejection comes first because it is the most specific explanation.
function rejectionBeforeScheduling(
  machine: RoutingMachine,
  input: RoutingInput,
  sitesById: Map<string, RoutingSite>,
  excluded: Set<string>,
): CandidateRejectionReason | null {
  if (excluded.has(machine.id)) return 'REJECTED_BY_OPERATOR';

  // Rule 2: the machine must support every required capability.
  const capabilities = new Set(machine.capabilities.map((c) => c.capability));
  if (!input.order.requiredCapabilities.every((required) => capabilities.has(required))) {
    return 'MISSING_CAPABILITY';
  }

  // Rule 3: sites that are down, and machines in ERROR or OFFLINE, get no new work.
  // A RUNNING machine is still a candidate; its reservations decide when it is free.
  if (sitesById.get(machine.siteId)?.status !== 'UP') return 'SITE_DOWN';
  if (machine.status === 'ERROR' || machine.status === 'OFFLINE') return 'MACHINE_UNAVAILABLE';

  // Without a shipping time, no arrival date can be calculated.
  if (input.shippingDays[machine.siteId] === undefined) return 'NO_SHIPPING_ROUTE';

  return null;
}

// How long the machine needs for the whole order, in milliseconds.
// Operations run one after another, so the cycle times of all required capabilities add up.
// Example: 6 parts needing turning (7 min) and 3-axis milling (11 min) take 6 × 18 = 108 min.
function productionMs(machine: RoutingMachine, order: RoutingOrder): number {
  const minutesPerPart = order.requiredCapabilities.reduce((total, required) => {
    const match = machine.capabilities.find((c) => c.capability === required);
    return total + (match?.cycleMinutesPerPart ?? 0);
  }, 0);

  // Cycle times can have decimals (for example 10.5 minutes); round to whole milliseconds.
  return Math.round(order.quantity * minutesPerPart * MINUTE_MS);
}

// The earliest start, at or after `from`, where a job of `durationMs` fits without
// overlapping any reservation. Reservations must be sorted by start time.
//
// It walks through the reservations, keeping `candidate` as the earliest start so far:
//   - a reservation that ends before `candidate` is in the past for us: skip it;
//   - a reservation that starts after the job would finish leaves a big enough gap: done;
//   - otherwise the job would overlap it, so move `candidate` to that reservation's end.
// `Math.max` matters when reservations overlap each other: a short reservation inside a
// longer one must not move `candidate` backwards.
//
// Ranges are half-open (the end time itself is free), so a job may start exactly when
// another ends, and end exactly when another starts. The database constraint uses the
// same convention.
//
// Example, with a 60-minute job from 10:00 and reservations 10:30–11:00 and 12:00–13:00:
//   10:00 + 60 min overlaps 10:30–11:00, so try 11:00; 11:00–12:00 fits before 12:00.
export function findEarliestGap(
  reservations: Reservation[],
  from: number,
  durationMs: number,
): number {
  let candidate = from;

  for (const reservation of reservations) {
    const start = reservation.start.getTime();
    const end = reservation.end.getTime();

    if (end <= candidate) continue;
    if (start >= candidate + durationMs) break;

    candidate = end;
  }

  return candidate;
}

// Splits the flat list of reservations by machine, each sorted by start time,
// which is the order `findEarliestGap` needs.
function groupReservations(reservations: Reservation[]): Map<string, Reservation[]> {
  const byMachine = new Map<string, Reservation[]>();

  for (const reservation of reservations) {
    const list = byMachine.get(reservation.machineId) ?? [];
    list.push(reservation);
    byMachine.set(reservation.machineId, list);
  }
  for (const list of byMachine.values()) {
    list.sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  return byMachine;
}

// How busy each site is: booked minutes still ahead of `now`, across all its machines.
// Only the part of a reservation after `now` counts, and finished reservations count as 0.
// Minutes are used instead of job counts, so a 10-hour job weighs more than a 10-minute one.
function siteLoadMinutes(
  machines: RoutingMachine[],
  reservationsByMachine: Map<string, Reservation[]>,
  now: Date,
): Map<string, number> {
  const load = new Map<string, number>();

  for (const machine of machines) {
    const minutes = (reservationsByMachine.get(machine.id) ?? []).reduce((total, reservation) => {
      const from = Math.max(reservation.start.getTime(), now.getTime());
      return total + Math.max(0, reservation.end.getTime() - from) / MINUTE_MS;
    }, 0);
    load.set(machine.siteId, (load.get(machine.siteId) ?? 0) + minutes);
  }

  return load;
}

// A candidate for a machine ruled out before its schedule was looked at, so it has no timing.
function rejectedCandidate(
  machine: RoutingMachine,
  reason: CandidateRejectionReason,
): RoutingCandidate {
  return {
    machineId: machine.id,
    siteId: machine.siteId,
    rank: null,
    rejectionReason: reason,
    earliestStart: null,
    finishAt: null,
    arrivalAt: null,
    slackMinutes: null,
  };
}

// Plain string comparison. `localeCompare` is avoided on purpose: its result can depend on
// the machine's language settings, and routing must give the same answer everywhere.
function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

// ---------------------------------------------------------------------------------------------
// Explanation
// ---------------------------------------------------------------------------------------------

// Wording for each rejection reason. Their order here is also the order they appear in
// the explanation. `Record<CandidateRejectionReason, string>` makes TypeScript require an
// entry for every reason, so a new reason can't be forgotten here.
const reasonLabels: Record<CandidateRejectionReason, string> = {
  REJECTED_BY_OPERATOR: 'rejected by the operator',
  MISSING_CAPABILITY: 'missing a capability',
  SITE_DOWN: 'site down',
  MACHINE_UNAVAILABLE: 'machine unavailable',
  NO_SHIPPING_ROUTE: 'no shipping route',
  MISSES_DEADLINE: 'would miss the deadline',
};

// Builds a one-sentence summary, for example:
//   "Chose HAM-1 at HAM: starts …, finishes …, arrives … with 8.9 days to spare.
//    1 viable machine; rejected: 1 missing a capability."
//   "No eligible machine. Rejected: 7 missing a capability, 3 would miss the deadline."
// The full detail per machine is in `candidates`; this is the short version for people.
function explain(
  chosen: RoutingCandidate | null,
  viableCount: number,
  rejected: RoutingCandidate[],
): string {
  // Count rejected machines per reason.
  const counts = new Map<CandidateRejectionReason, number>();
  for (const candidate of rejected) {
    if (candidate.rejectionReason) {
      counts.set(candidate.rejectionReason, (counts.get(candidate.rejectionReason) ?? 0) + 1);
    }
  }

  // "2 missing a capability, 1 site down", skipping reasons with no machines.
  const reasons = Object.entries(reasonLabels)
    .flatMap(([reason, label]) => {
      const count = counts.get(reason as CandidateRejectionReason);
      return count ? [`${String(count)} ${label}`] : [];
    })
    .join(', ');

  if (!chosen) {
    return `No eligible machine. Rejected: ${reasons || 'no machines to consider'}.`;
  }

  const summary =
    `Chose ${chosen.machineId} at ${chosen.siteId}: starts ${iso(chosen.earliestStart)}, ` +
    `finishes ${iso(chosen.finishAt)}, arrives ${iso(chosen.arrivalAt)} with ` +
    `${formatMinutes(chosen.slackMinutes ?? 0)} to spare. ` +
    `${String(viableCount)} viable ${viableCount === 1 ? 'machine' : 'machines'}`;

  return reasons ? `${summary}; rejected: ${reasons}.` : `${summary}.`;
}

function iso(date: Date | null): string {
  return date ? date.toISOString() : 'unknown';
}

// Picks a readable unit: days from 24 hours up, hours from 60 minutes up, otherwise minutes.
function formatMinutes(minutes: number): string {
  if (minutes >= 24 * 60) return `${(minutes / (24 * 60)).toFixed(1)} days`;
  if (minutes >= 60) return `${(minutes / 60).toFixed(1)} hours`;
  return `${String(Math.round(minutes))} minutes`;
}
