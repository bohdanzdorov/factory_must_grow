import { useSimulatedTime } from '../../hooks/useSimulatedTime';
import { formatDateTime } from '../../lib/format';

export function SimulatedClock() {
  const time = useSimulatedTime();

  if (!time) return <span className="text-sm text-slate-400">Connecting…</span>;

  return (
    <span className="text-sm text-slate-500" title="All times in the app are simulated">
      Simulated time{' '}
      <span className="font-medium text-slate-900 tabular-nums">
        {formatDateTime(new Date(time.now).toISOString())}
      </span>{' '}
      <span className="text-slate-400">({String(time.scale)}× speed)</span>
    </span>
  );
}
