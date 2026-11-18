// Every machine routing considered: why the winner won and why the others lost (rule 4).
import type { RoutingCandidate } from '@factorymustgrow/shared';
import { formatDateTime, formatMinutes, rejectionReasonLabels } from '../../lib/format';

export function CandidatesTable({
  candidates,
  chosenMachineId,
}: {
  candidates: RoutingCandidate[];
  chosenMachineId: string | null;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
          <tr>
            <th className="px-3 py-2 font-medium">Machine</th>
            <th className="px-3 py-2 font-medium">Result</th>
            <th className="px-3 py-2 font-medium">Starts</th>
            <th className="px-3 py-2 font-medium">Arrives</th>
            <th className="px-3 py-2 text-right font-medium">Time to spare</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {candidates.map((candidate) => {
            const chosen = candidate.machineId === chosenMachineId;
            return (
              <tr key={candidate.machineId} className={chosen ? 'bg-green-50' : undefined}>
                <td className="px-3 py-2 whitespace-nowrap">
                  <span className="font-medium">{candidate.machineId}</span>
                  <span className="ml-2 text-slate-400">{candidate.siteId}</span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {candidate.rank !== null ? (
                    <span className={chosen ? 'font-medium text-green-800' : undefined}>
                      {chosen ? 'Chosen' : `Rank ${String(candidate.rank)}`}
                    </span>
                  ) : (
                    <span className="text-slate-500">
                      {candidate.rejectionReason
                        ? rejectionReasonLabels[candidate.rejectionReason]
                        : 'Rejected'}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {formatDateTime(candidate.earliestStart)}
                </td>
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {formatDateTime(candidate.arrivalAt)}
                </td>
                <td
                  className={`px-3 py-2 text-right whitespace-nowrap tabular-nums ${
                    candidate.slackMinutes !== null && candidate.slackMinutes < 0
                      ? 'text-red-700'
                      : ''
                  }`}
                >
                  {candidate.slackMinutes === null ? '—' : formatMinutes(candidate.slackMinutes)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
