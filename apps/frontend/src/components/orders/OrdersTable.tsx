import type { Order, OrderStatus } from '@factorymustgrow/shared';
import { Link } from 'react-router';
import { capabilityLabels, formatDateTime, orderStatusLabels } from '../../lib/format';
import { OrderStatusBadge } from '../general/OrderStatusBadge';

// `status` is the active filter, used only to word the empty-list message.
export function OrdersTable({ orders, status }: { orders: Order[]; status?: OrderStatus }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
          <tr>
            <th className="px-4 py-2 font-medium">Part</th>
            <th className="px-4 py-2 text-right font-medium">Qty</th>
            <th className="px-4 py-2 font-medium">Capabilities</th>
            <th className="px-4 py-2 font-medium">Deadline</th>
            <th className="px-4 py-2 font-medium">To</th>
            <th className="px-4 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {orders.map((order) => (
            <tr key={order.id} className="hover:bg-slate-50">
              <td className="px-4 py-2 whitespace-nowrap">
                <Link
                  to={`/orders/${order.id}`}
                  className="font-medium text-blue-700 hover:underline"
                >
                  {order.partName}
                </Link>
              </td>
              <td className="px-4 py-2 text-right tabular-nums">{order.quantity}</td>
              <td className="px-4 py-2 text-slate-600">
                {order.requiredCapabilities.map((c) => capabilityLabels[c]).join(', ')}
              </td>
              <td className="px-4 py-2 whitespace-nowrap tabular-nums">
                {formatDateTime(order.deadline)}
              </td>
              <td className="px-4 py-2">{order.destination}</td>
              <td className="px-4 py-2">
                <OrderStatusBadge status={order.status} />
              </td>
            </tr>
          ))}
          {orders.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                No orders{status ? ` with status "${orderStatusLabels[status]}"` : ''}.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
