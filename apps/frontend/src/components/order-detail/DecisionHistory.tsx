import type { RoutingDecision } from '@factorymustgrow/shared';
import { formatDateTime } from '../../lib/format';
import { DecisionCard } from './DecisionCard';
import { DecisionStatusBadge } from './DecisionStatusBadge';

// An order's earlier decisions, newest first, each collapsed to one line until opened.
export function DecisionHistory({ decisions }: { decisions: RoutingDecision[] }) {
  if (decisions.length === 0) return null;

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-500 uppercase">
        Earlier decisions ({decisions.length})
      </h2>
      {decisions.map((decision) => (
        <details key={decision.id} className="group">
          <summary className="cursor-pointer text-sm text-slate-600 hover:text-slate-900">
            <span className="inline-flex flex-wrap items-center gap-2">
              {formatDateTime(decision.createdAt)}
              <DecisionStatusBadge status={decision.status} />
              {decision.chosenMachineId ?? 'No machine'}
            </span>
          </summary>
          <div className="mt-2">
            <DecisionCard decision={decision} />
          </div>
        </details>
      ))}
    </div>
  );
}
