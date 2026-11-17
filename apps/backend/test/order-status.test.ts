import { OrderStatusSchema, RoutingDecisionStatusSchema } from '@factorymustgrow/shared';
import { describe, expect, it } from 'vitest';
import { canChangeDecisionStatus, canChangeOrderStatus } from '../src/domain/order-status.js';

describe('canChangeOrderStatus', () => {
  it.each([
    ['DRAFT', 'ROUTED'],
    ['DRAFT', 'BLOCKED'],
    ['BLOCKED', 'ROUTED'],
    ['BLOCKED', 'BLOCKED'],
    ['ROUTED', 'APPROVED'],
    ['ROUTED', 'DRAFT'],
    ['ROUTED', 'REROUTE_PENDING'],
    ['ROUTED', 'BLOCKED'],
    ['APPROVED', 'IN_PRODUCTION'],
    ['APPROVED', 'REROUTE_PENDING'],
    ['APPROVED', 'BLOCKED'],
    ['IN_PRODUCTION', 'COMPLETE'],
    ['IN_PRODUCTION', 'REROUTE_PENDING'],
    ['IN_PRODUCTION', 'BLOCKED'],
    ['REROUTE_PENDING', 'APPROVED'],
    ['REROUTE_PENDING', 'DRAFT'],
    ['REROUTE_PENDING', 'REROUTE_PENDING'],
    ['REROUTE_PENDING', 'BLOCKED'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(canChangeOrderStatus(from, to)).toBe(true);
  });

  it.each([
    // Approval needs a proposal first.
    ['DRAFT', 'APPROVED'],
    ['BLOCKED', 'APPROVED'],
    // An approved order can't go back to being unrouted.
    ['APPROVED', 'DRAFT'],
    ['APPROVED', 'ROUTED'],
    // Production can't be undone or skipped.
    ['IN_PRODUCTION', 'ROUTED'],
    ['IN_PRODUCTION', 'APPROVED'],
    ['DRAFT', 'COMPLETE'],
    ['APPROVED', 'COMPLETE'],
    // A proposal can't be proposed again; a reroute isn't a first routing.
    ['ROUTED', 'ROUTED'],
    ['REROUTE_PENDING', 'ROUTED'],
  ] as const)('refuses %s → %s', (from, to) => {
    expect(canChangeOrderStatus(from, to)).toBe(false);
  });

  it('treats COMPLETE as final', () => {
    for (const to of OrderStatusSchema.options) {
      expect(canChangeOrderStatus('COMPLETE', to)).toBe(false);
    }
  });
});

describe('canChangeDecisionStatus', () => {
  it.each(['APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED'] as const)(
    'lets a PROPOSED decision become %s',
    (to) => {
      expect(canChangeDecisionStatus('PROPOSED', to)).toBe(true);
    },
  );

  it.each(['APPROVED', 'REJECTED', 'EXPIRED', 'SUPERSEDED', 'NO_ELIGIBLE_MACHINE'] as const)(
    'treats %s as final',
    (from) => {
      for (const to of RoutingDecisionStatusSchema.options) {
        expect(canChangeDecisionStatus(from, to)).toBe(false);
      }
    },
  );
});
