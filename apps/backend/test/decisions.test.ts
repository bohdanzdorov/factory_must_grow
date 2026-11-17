import { ErrorResponseSchema, OrderDecisionResultSchema } from '@factorymustgrow/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import { api } from './helpers/api.js';
import { useManualClock } from './helpers/clock.js';
import {
  createJob,
  createMachine,
  createOrder,
  createRoutingDecision,
  createShippingLeadTime,
  createSite,
} from './helpers/factories.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const START = Date.parse('2030-01-01T08:00:00Z');
const at = (offsetMs: number) => new Date(START + offsetMs);

// At scale 60, the 120-second approval window is 2 simulated hours.
const WINDOW = 2 * HOUR;

let clock: ReturnType<typeof useManualClock>;

beforeEach(async () => {
  clock = useManualClock(at(0), 60);

  await createSite({ id: 'HAM' });
  await createMachine({ id: 'HAM-1', siteId: 'HAM' });
  await createShippingLeadTime({ siteId: 'HAM', destination: 'DE', days: 1 });
});

// Creates a draft order and routes it through the API. Returns the proposal.
async function proposeNewOrder() {
  const order = await createOrder();
  const res = await api().post(`/api/orders/${order.id}/route`);
  return OrderDecisionResultSchema.parse(res.body);
}

// An order whose machine failed, with a reroute proposal holding a slot on HAM-1.
async function createReroute() {
  const order = await createOrder({ status: 'REROUTE_PENDING' });
  const decision = await createRoutingDecision({
    orderId: order.id,
    kind: 'REROUTE',
    status: 'PROPOSED',
    chosenMachineId: 'HAM-1',
  });
  await createJob({
    machineId: 'HAM-1',
    routingDecisionId: decision.id,
    plannedStart: at(WINDOW),
    plannedEnd: at(WINDOW + HOUR),
  });
  return { order, decision };
}

const approve = (id: string) => api().post(`/api/decisions/${id}/approve`);
const reject = (id: string, reason?: string) =>
  api()
    .post(`/api/decisions/${id}/reject`)
    .send(reason === undefined ? {} : { reason });

async function stateOf(decisionId: string) {
  const decision = await prisma.routingDecision.findUniqueOrThrow({
    where: { id: decisionId },
    include: { jobs: true, order: true },
  });
  return {
    decision: decision.status,
    order: decision.order.status,
    jobs: decision.jobs.map((job) => job.status),
  };
}

describe('POST /api/decisions/:id/approve', () => {
  it('approves a first proposal and keeps its booked slot', async () => {
    const { decision } = await proposeNewOrder();

    const res = await approve(decision.id);

    expect(res.status).toBe(200);
    const result = OrderDecisionResultSchema.parse(res.body);
    expect(result.order.status).toBe('APPROVED');
    expect(result.decision).toMatchObject({ status: 'APPROVED', rejectionNote: null });
    expect(result.decision.jobs).toEqual(decision.jobs);
  });

  it('approves a reroute', async () => {
    const { decision } = await createReroute();

    const res = await approve(decision.id);

    expect(res.status).toBe(200);
    expect(await stateOf(decision.id)).toEqual({
      decision: 'APPROVED',
      order: 'APPROVED',
      jobs: ['PLANNED'],
    });
  });

  it('treats approving again as harmless', async () => {
    const { decision } = await proposeNewOrder();

    const responses = await Promise.all([approve(decision.id), approve(decision.id)]);
    const again = await approve(decision.id);

    expect([...responses, again].map((res) => res.status)).toEqual([200, 200, 200]);
    expect((await stateOf(decision.id)).decision).toBe('APPROVED');
  });

  it('expires the proposal instead when its planned start has passed', async () => {
    const { order, decision } = await proposeNewOrder();
    // The job was planned to start after the 2-hour window; now it's 3 hours later.
    clock.advance(3 * HOUR);

    const res = await approve(decision.id);

    expect(res.status).toBe(409);
    expect(ErrorResponseSchema.parse(res.body).error.message).toContain('expired');
    // The expiry was saved, even though the request failed.
    expect(await stateOf(decision.id)).toEqual({
      decision: 'EXPIRED',
      order: 'DRAFT',
      jobs: ['CANCELLED'],
    });
    // The order can be routed again.
    expect((await api().post(`/api/orders/${order.id}/route`)).status).toBe(201);
  });

  it('refuses a rejected proposal', async () => {
    const { decision } = await proposeNewOrder();
    await reject(decision.id, 'Not this machine');

    const res = await approve(decision.id);

    expect(res.status).toBe(409);
    expect(ErrorResponseSchema.parse(res.body).error.message).toContain('REJECTED');
  });

  it('refuses a decision that found no machine', async () => {
    const order = await createOrder({ requiredCapabilities: ['INSPECTION'] });
    const routed = OrderDecisionResultSchema.parse(
      (await api().post(`/api/orders/${order.id}/route`)).body,
    );

    const res = await approve(routed.decision.id);

    expect(res.status).toBe(409);
    expect(ErrorResponseSchema.parse(res.body).error.message).toContain('NO_ELIGIBLE_MACHINE');
  });

  it('returns 404 for an unknown decision', async () => {
    expect((await approve('not-a-uuid')).status).toBe(404);
  });
});

describe('POST /api/decisions/:id/reject', () => {
  it('rejects a proposal, saves the reason and frees the slot', async () => {
    const { decision } = await proposeNewOrder();

    const res = await reject(decision.id, '  Customer prefers London  ');

    expect(res.status).toBe(200);
    const result = OrderDecisionResultSchema.parse(res.body);
    expect(result.order).toMatchObject({ status: 'DRAFT', blockedReason: null });
    expect(result.decision).toMatchObject({
      status: 'REJECTED',
      rejectionNote: 'Customer prefers London',
    });
    expect(result.decision.jobs.map((job) => job.status)).toEqual(['CANCELLED']);
  });

  it('lets another order take the freed slot', async () => {
    const first = await proposeNewOrder();
    await reject(first.decision.id, 'Not now');

    const second = await proposeNewOrder();

    expect(second.decision.jobs[0]?.plannedStart).toBe(first.decision.jobs[0]?.plannedStart);
  });

  it('proposes a different machine when the order is routed again', async () => {
    await createMachine({ id: 'HAM-2', siteId: 'HAM' });
    const { order, decision } = await proposeNewOrder();
    expect(decision.chosenMachineId).toBe('HAM-1');
    await reject(decision.id, 'HAM-1 is reserved for a key customer');

    const rerouted = OrderDecisionResultSchema.parse(
      (await api().post(`/api/orders/${order.id}/route`)).body,
    );

    expect(rerouted.decision.chosenMachineId).toBe('HAM-2');
  });

  it('rejects a reroute, sending the order back to DRAFT', async () => {
    const { decision } = await createReroute();

    const res = await reject(decision.id, 'Wait for HAM-1 to be repaired');

    expect(res.status).toBe(200);
    expect(await stateOf(decision.id)).toEqual({
      decision: 'REJECTED',
      order: 'DRAFT',
      jobs: ['CANCELLED'],
    });
  });

  it.each([
    ['missing', undefined],
    ['blank', '   '],
    ['too long', 'x'.repeat(501)],
  ])('requires a reason (%s) and changes nothing without one', async (_label, reason) => {
    const { decision } = await proposeNewOrder();

    const res = await reject(decision.id, reason);

    expect(res.status).toBe(400);
    expect(ErrorResponseSchema.parse(res.body).error.issues?.[0]?.path).toBe('reason');
    expect((await stateOf(decision.id)).decision).toBe('PROPOSED');
  });

  it('keeps the first reason when rejected twice', async () => {
    const { decision } = await proposeNewOrder();
    await reject(decision.id, 'First reason');

    const res = await reject(decision.id, 'Second reason');

    expect(res.status).toBe(200);
    expect(OrderDecisionResultSchema.parse(res.body).decision.rejectionNote).toBe('First reason');
  });

  it('refuses an approved proposal', async () => {
    const { decision } = await proposeNewOrder();
    await approve(decision.id);

    const res = await reject(decision.id, 'Too late');

    expect(res.status).toBe(409);
  });
});

describe('approve and reject arriving together', () => {
  // Whether two requests actually overlap depends on timing, so several races run at once:
  // without protection, at least one of them is very likely to let both requests through.
  it('lets exactly one of them win, and leaves a consistent state', async () => {
    const proposals = [];
    for (let i = 0; i < 6; i++) proposals.push(await proposeNewOrder());

    const races = await Promise.all(
      proposals.map(({ decision }) =>
        Promise.all([approve(decision.id), reject(decision.id, 'Changed my mind')]),
      ),
    );

    for (const [index, [approved, rejected]] of races.entries()) {
      const decisionId = proposals[index]?.decision.id ?? '';
      expect([approved.status, rejected.status].sort()).toEqual([200, 409]);
      expect(await stateOf(decisionId)).toEqual(
        approved.status === 200
          ? { decision: 'APPROVED', order: 'APPROVED', jobs: ['PLANNED'] }
          : { decision: 'REJECTED', order: 'DRAFT', jobs: ['CANCELLED'] },
      );
    }
  });
});
