import { useParams } from 'react-router';
import { ApiError } from '../api/client';
import { useDecisions, useOrder } from '../api/queries';
import { ErrorMessage } from '../components/general/ErrorMessage';
import { BackToOrdersLink } from '../components/order-detail/BackToOrdersLink';
import { DecisionCard } from '../components/order-detail/DecisionCard';
import { DecisionHistory } from '../components/order-detail/DecisionHistory';
import { OrderSummary } from '../components/order-detail/OrderSummary';

export function OrderDetailPage() {
  const { orderId = '' } = useParams();
  const order = useOrder(orderId);
  const decisions = useDecisions(orderId);

  if (order.error instanceof ApiError && order.error.status === 404) {
    return (
      <div className="space-y-3">
        <BackToOrdersLink />
        <p className="text-slate-600">This order doesn't exist.</p>
      </div>
    );
  }
  if (order.error) return <ErrorMessage error={order.error} />;
  if (!order.data) return <p className="text-sm text-slate-500">Loading order…</p>;

  // The newest decision is the current one; older ones are history.
  const [current, ...history] = decisions.data ?? [];

  return (
    <div className="space-y-6">
      <BackToOrdersLink />
      <OrderSummary order={order.data} />

      {decisions.error && <ErrorMessage error={decisions.error} />}

      {current ? (
        <div className="space-y-2">
          <h2 className="text-sm font-semibold text-slate-500 uppercase">Current decision</h2>
          <DecisionCard decision={current} />
        </div>
      ) : (
        decisions.data && (
          <p className="text-sm text-slate-500">This order hasn't been routed yet.</p>
        )
      )}

      <DecisionHistory decisions={history} />
    </div>
  );
}
