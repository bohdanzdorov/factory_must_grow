import { useState } from 'react';
import { useDestinations } from '../api/queries';
import { ErrorMessage } from '../components/general/ErrorMessage';
import { NewOrderForm } from '../components/new-order/NewOrderForm';
import { BackToOrdersLink } from '../components/general/BackToOrdersLink';
import { useSimulatedTime } from '../hooks/useSimulatedTime';
import { toDateTimeInputValue } from '../lib/format';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function NewOrderPage() {
  const destinations = useDestinations();
  const time = useSimulatedTime();

  // Suggested deadline: a week ahead in simulated time, fixed when the clock first arrives.
  const [defaultDeadline, setDefaultDeadline] = useState<string | null>(null);
  if (time && defaultDeadline === null) {
    setDefaultDeadline(toDateTimeInputValue(time.now + WEEK_MS));
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <BackToOrdersLink />
      <h1 className="text-xl font-semibold">New order</h1>

      {destinations.error && <ErrorMessage error={destinations.error} />}
      {(!destinations.data || defaultDeadline === null) && !destinations.error && (
        <p className="text-sm text-slate-500">Loading…</p>
      )}
      {destinations.data && defaultDeadline !== null && (
        <NewOrderForm destinations={destinations.data} defaultDeadline={defaultDeadline} />
      )}
    </div>
  );
}
