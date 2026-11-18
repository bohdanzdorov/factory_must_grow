import { OrderStatusSchema, type OrderStatus } from '@factorymustgrow/shared';
import { useSearchParams } from 'react-router';
import { useOrders } from '../api/queries';
import { ErrorMessage } from '../components/general/ErrorMessage';
import { OrdersTable } from '../components/orders/OrdersTable';
import { orderStatusLabels } from '../lib/format';

export function OrdersPage() {
  // The filter lives in the URL (?status=BLOCKED), so it survives a refresh.
  const [params, setParams] = useSearchParams();
  const parsedStatus = OrderStatusSchema.safeParse(params.get('status'));
  const status: OrderStatus | undefined = parsedStatus.success ? parsedStatus.data : undefined;
  const orders = useOrders(status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-xl font-semibold">Orders</h1>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Status</span>
          <select
            value={status ?? ''}
            onChange={(event) => {
              setParams(event.target.value ? { status: event.target.value } : {});
            }}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5"
          >
            <option value="">All</option>
            {OrderStatusSchema.options.map((option) => (
              <option key={option} value={option}>
                {orderStatusLabels[option]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {orders.error && <ErrorMessage error={orders.error} />}
      {orders.isPending && <p className="text-sm text-slate-500">Loading orders…</p>}
      {orders.data && <OrdersTable orders={orders.data} status={status} />}
    </div>
  );
}
