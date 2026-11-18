// Turning API values into text for people.
import type {
  Capability,
  CandidateRejectionReason,
  OrderStatus,
  RoutingDecisionStatus,
} from '@factorymustgrow/shared';

const dateTime = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

// All times shown are simulated time, from the backend's clock.
export function formatDateTime(iso: string | null): string {
  return iso ? dateTime.format(new Date(iso)) : '—';
}

// ISO timestamps as the backend writes them, such as 2026-11-18T14:15:05.908Z.
const ISO_TIMESTAMP = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g;

// The backend's explanation sentences contain raw timestamps; show them like every other
// time in the UI. The stored explanation itself is unchanged.
export function formatExplanation(text: string): string {
  return text.replace(ISO_TIMESTAMP, (iso) => formatDateTime(iso));
}

// Days from a day up, hours from an hour up, otherwise minutes. Negative means late.
export function formatMinutes(minutes: number): string {
  const sign = minutes < 0 ? '−' : '';
  const size = Math.abs(minutes);

  if (size >= 24 * 60) return `${sign}${(size / (24 * 60)).toFixed(1)} days`;
  if (size >= 60) return `${sign}${(size / 60).toFixed(1)} h`;
  return `${sign}${String(Math.round(size))} min`;
}

// m:ss, for countdowns in real time.
export function formatCountdown(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

export const capabilityLabels: Record<Capability, string> = {
  MILLING_3_AXIS: '3-axis milling',
  MILLING_5_AXIS: '5-axis milling',
  TURNING: 'Turning',
  INSPECTION: 'Inspection',
};

export const rejectionReasonLabels: Record<CandidateRejectionReason, string> = {
  MISSING_CAPABILITY: 'Missing a capability',
  MACHINE_UNAVAILABLE: 'Machine unavailable',
  SITE_DOWN: 'Site down',
  MISSES_DEADLINE: 'Would miss the deadline',
  REJECTED_BY_OPERATOR: 'Rejected by operator',
  NO_SHIPPING_ROUTE: 'No shipping route',
};

export const orderStatusLabels: Record<OrderStatus, string> = {
  DRAFT: 'Draft',
  ROUTED: 'Awaiting approval',
  APPROVED: 'Approved',
  IN_PRODUCTION: 'In production',
  COMPLETE: 'Complete',
  BLOCKED: 'Blocked',
  REROUTE_PENDING: 'Reroute pending',
};

export const decisionStatusLabels: Record<RoutingDecisionStatus, string> = {
  PROPOSED: 'Proposed',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  SUPERSEDED: 'Superseded',
  NO_ELIGIBLE_MACHINE: 'No eligible machine',
};
