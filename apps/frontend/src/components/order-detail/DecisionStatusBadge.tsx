import type { RoutingDecisionStatus } from '@factorymustgrow/shared';
import { BADGE_CLASS_NAME } from '../../lib/badge';
import { decisionStatusLabels } from '../../lib/format';

const colors: Record<RoutingDecisionStatus, string> = {
  PROPOSED: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-slate-200 text-slate-700',
  EXPIRED: 'bg-slate-200 text-slate-700',
  SUPERSEDED: 'bg-slate-200 text-slate-700',
  NO_ELIGIBLE_MACHINE: 'bg-red-100 text-red-800',
};

export function DecisionStatusBadge({ status }: { status: RoutingDecisionStatus }) {
  return (
    <span className={`${BADGE_CLASS_NAME} ${colors[status]}`}>{decisionStatusLabels[status]}</span>
  );
}
