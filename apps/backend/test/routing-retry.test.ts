// The retry when another request takes the slot between routing and saving. That race
// can't be timed reliably, so routing is wrapped to propose a slot that is already taken.
import { ErrorResponseSchema, OrderDecisionResultSchema } from '@factorymustgrow/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../src/config/prisma.js';
import type * as Routing from '../src/domain/routing.js';
import { api } from './helpers/api.js';
import { useManualClock } from './helpers/clock.js';
import {
  createJob,
  createMachine,
  createOrder,
  createShippingLeadTime,
  createSite,
} from './helpers/factories.js';

// Slots to force onto the next routing results, one per call. Empty means real routing.
const forced = vi.hoisted(() => ({ slots: [] as { start: Date; end: Date }[], calls: 0 }));

vi.mock('../src/domain/routing.js', async (importOriginal) => {
  const actual = await importOriginal<typeof Routing>();

  return {
    ...actual,
    routeOrder: (input: Routing.RoutingInput): Routing.RoutingResult => {
      forced.calls += 1;
      const result = actual.routeOrder(input);
      const slot = forced.slots.shift();

      if (slot && result.chosen) {
        result.chosen.earliestStart = slot.start;
        result.chosen.finishAt = slot.end;
      }
      return result;
    },
  };
});

const START = Date.parse('2030-01-01T08:00:00Z');
const at = (hours: number) => new Date(START + hours * 60 * 60 * 1000);
const TAKEN = { start: at(10), end: at(11) };

beforeEach(async () => {
  forced.slots = [];
  forced.calls = 0;
  useManualClock(at(0), 60);

  await createSite({ id: 'HAM' });
  await createMachine({ id: 'HAM-1', siteId: 'HAM' });
  await createShippingLeadTime({ siteId: 'HAM', destination: 'DE', days: 1 });
  // Someone else's job already holds 10:00–11:00.
  await createJob({ machineId: 'HAM-1', plannedStart: TAKEN.start, plannedEnd: TAKEN.end });
});

describe('routing retry after a slot collision', () => {
  it('routes again with fresh data and books a free slot', async () => {
    forced.slots = [TAKEN];
    const order = await createOrder();

    const res = await api().post(`/api/orders/${order.id}/route`);

    expect(res.status).toBe(201);
    expect(forced.calls).toBe(2);
    const { decision } = OrderDecisionResultSchema.parse(res.body);
    expect(decision.jobs[0]?.plannedStart).not.toBe(TAKEN.start.toISOString());
    // The failed first attempt left nothing behind.
    expect(await prisma.routingDecision.count({ where: { orderId: order.id } })).toBe(1);
  });

  it('gives up with 409 after five collisions (4 retries) and saves nothing', async () => {
    forced.slots = Array.from({ length: 5 }, () => TAKEN);
    const order = await createOrder();

    const res = await api().post(`/api/orders/${order.id}/route`);

    expect(res.status).toBe(409);
    expect(ErrorResponseSchema.parse(res.body).error.message).toContain('Try again');
    expect(forced.calls).toBe(5);
    expect(await prisma.routingDecision.count({ where: { orderId: order.id } })).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(
      'DRAFT',
    );
  });
});
