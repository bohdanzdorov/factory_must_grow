// How long the operator has left to approve a proposal, in real time. A proposal expires when
// its job's planned start arrives; at 60× speed that is only about 2 real minutes after routing.
import type { RoutingDecision } from '@factorymustgrow/shared';
import { useSimulatedTime } from '../../hooks/useSimulatedTime';
import { formatCountdown } from '../../lib/format';

export function ExpiryCountdown({ decision }: { decision: RoutingDecision }) {
  const time = useSimulatedTime();
  const job = decision.jobs.find((candidate) => candidate.status === 'PLANNED');

  if (!time || !job) return <span />;

  // Simulated time left, converted to the real time the operator actually has.
  const realRemaining = (Date.parse(job.plannedStart) - time.now) / time.scale;

  if (realRemaining <= 0) {
    return (
      <span className="text-sm font-medium text-red-700">
        Expired: approving will fail. Route the order again.
      </span>
    );
  }

  return (
    <span
      className={`text-sm ${realRemaining < 30_000 ? 'font-medium text-amber-800' : 'text-slate-700'}`}
    >
      Approve within{' '}
      <span className="font-semibold tabular-nums">{formatCountdown(realRemaining)}</span> (real
      time)
    </span>
  );
}
