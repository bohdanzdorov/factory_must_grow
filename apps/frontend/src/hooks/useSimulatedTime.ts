// The backend's simulated time, ticking every second in the browser. The clock is polled
// every 2 seconds; between polls, time is estimated from the last reading and the scale.
import { useEffect, useState } from 'react';
import { useClock } from '../api/queries';

export interface SimulatedTime {
  // Simulated milliseconds since the epoch.
  now: number;
  // Simulated milliseconds per real millisecond.
  scale: number;
}

export function useSimulatedTime(): SimulatedTime | null {
  const clock = useClock();
  const [realNow, setRealNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setRealNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(timer);
    };
  }, []);

  if (!clock.data) return null;

  // How far the simulation has moved since the clock was read.
  const elapsedReal = Math.max(0, realNow - clock.dataUpdatedAt);

  return {
    now: Date.parse(clock.data.now) + elapsedReal * clock.data.scale,
    scale: clock.data.scale,
  };
}
