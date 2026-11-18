import type { OrderStatus } from '@factorymustgrow/shared';
import { BADGE_CLASS_NAME } from '../../lib/badge';
import { orderStatusLabels } from '../../lib/format';

const colors: Record<OrderStatus, string> = {
  DRAFT: 'bg-slate-100 text-slate-700',
  ROUTED: 'bg-blue-100 text-blue-800',
  APPROVED: 'bg-green-100 text-green-800',
  IN_PRODUCTION: 'bg-indigo-100 text-indigo-800',
  COMPLETE: 'bg-emerald-100 text-emerald-800',
  BLOCKED: 'bg-red-100 text-red-800',
  REROUTE_PENDING: 'bg-amber-100 text-amber-800',
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`${BADGE_CLASS_NAME} ${colors[status]}`}>{orderStatusLabels[status]}</span>
  );
}
