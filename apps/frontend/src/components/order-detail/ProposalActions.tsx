// Approve or reject a proposal, with a countdown to its expiry.
import type { RoutingDecision } from '@factorymustgrow/shared';
import { useState, type SyntheticEvent } from 'react';
import { ApiError } from '../../api/client';
import { useApproveDecision, useRejectDecision } from '../../api/queries';
import { ErrorMessage } from '../general/ErrorMessage';
import { ExpiryCountdown } from './ExpiryCountdown';

export function ProposalActions({ decision }: { decision: RoutingDecision }) {
  const approve = useApproveDecision(decision.orderId);
  const reject = useRejectDecision(decision.orderId);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const busy = approve.isPending || reject.isPending;

  const submitReject = (event: SyntheticEvent) => {
    event.preventDefault();
    reject.mutate({ decisionId: decision.id, reason });
  };

  const reasonError =
    reject.error instanceof ApiError
      ? reject.error.issues.find((issue) => issue.path === 'reason')?.message
      : undefined;

  return (
    <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ExpiryCountdown decision={decision} />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              approve.mutate(decision.id);
            }}
            className="rounded-md bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-50"
          >
            {approve.isPending ? 'Approving…' : 'Approve'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setRejecting((open) => !open);
            }}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
          >
            Reject…
          </button>
        </div>
      </div>

      {approve.error && <ErrorMessage error={approve.error} />}

      {rejecting && (
        <form onSubmit={submitReject} className="space-y-2">
          <label className="block text-sm font-medium" htmlFor="reject-reason">
            Why are you rejecting this proposal?
          </label>
          <textarea
            id="reject-reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
            maxLength={500}
            rows={2}
            required
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            placeholder="For example: the customer prefers the London site"
          />
          {reasonError && <p className="text-sm text-red-700">{reasonError}</p>}
          {reject.error && !reasonError && <ErrorMessage error={reject.error} />}
          <button
            type="submit"
            disabled={busy || reason.trim() === ''}
            className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
          >
            {reject.isPending ? 'Rejecting…' : 'Reject proposal'}
          </button>
        </form>
      )}
    </div>
  );
}
