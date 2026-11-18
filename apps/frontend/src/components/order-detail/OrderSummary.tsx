import type { Order } from '@factorymustgrow/shared';
import { useRouteOrder } from '../../api/queries';
import { capabilityLabels, formatDateTime, formatExplanation } from '../../lib/format';
import { ErrorMessage } from '../general/ErrorMessage';
import { OrderStatusBadge } from '../general/OrderStatusBadge';
import { Fact } from './Fact';

// The order's own details, its status, and the button to route it.
export function OrderSummary({ order }: { order: Order }) {
  const route = useRouteOrder(order.id);
  const canRoute = order.status === 'DRAFT' || order.status === 'BLOCKED';

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{order.partName}</h1>
          <OrderStatusBadge status={order.status} />
        </div>
        {canRoute && (
          <button
            type="button"
            disabled={route.isPending}
            onClick={() => {
              route.mutate();
            }}
            className="rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50"
          >
            {route.isPending
              ? 'Routing…'
              : order.status === 'BLOCKED'
                ? 'Try routing again'
                : 'Route order'}
          </button>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
        <Fact label="Quantity" value={String(order.quantity)} />
        <Fact
          label="Capabilities"
          value={order.requiredCapabilities.map((c) => capabilityLabels[c]).join(', ')}
        />
        <Fact label="Deadline" value={formatDateTime(order.deadline)} />
        <Fact label="Destination" value={order.destination} />
      </dl>

      {order.status === 'BLOCKED' && order.blockedReason && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          <span className="font-medium">Blocked:</span> {formatExplanation(order.blockedReason)}
        </p>
      )}

      {route.error && <ErrorMessage error={route.error} />}
    </section>
  );
}
