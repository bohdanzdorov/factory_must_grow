import type { RoutingDecision } from '@factorymustgrow/shared';
import { formatDateTime, formatExplanation } from '../../lib/format';
import { CandidatesTable } from './CandidatesTable';
import { DecisionStatusBadge } from './DecisionStatusBadge';
import { Fact } from './Fact';
import { ProposalActions } from './ProposalActions';

// One routing decision: what was chosen, why, and every machine considered.
export function DecisionCard({ decision }: { decision: RoutingDecision }) {
  const job = decision.jobs[0];

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <DecisionStatusBadge status={decision.status} />
        <span className="text-sm text-slate-500">
          {decision.kind === 'REROUTE' ? 'Reroute' : 'Routing'} decision ·{' '}
          {formatDateTime(decision.createdAt)}
        </span>
      </div>

      <p className="text-sm leading-relaxed">{formatExplanation(decision.explanation)}</p>

      {decision.chosenMachineId && job && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <Fact label="Machine" value={decision.chosenMachineId} />
          <Fact label="Starts" value={formatDateTime(job.plannedStart)} />
          <Fact label="Finishes" value={formatDateTime(job.plannedEnd)} />
          <Fact label="Booking" value={job.status.toLowerCase()} />
        </dl>
      )}

      {decision.rejectionNote && (
        <p className="rounded-md bg-slate-100 px-3 py-2 text-sm">
          <span className="font-medium">Rejected because:</span> {decision.rejectionNote}
        </p>
      )}

      {decision.status === 'PROPOSED' && <ProposalActions decision={decision} />}

      <CandidatesTable
        candidates={decision.candidates}
        chosenMachineId={decision.chosenMachineId}
      />
    </section>
  );
}
