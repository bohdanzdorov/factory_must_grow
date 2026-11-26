// Finds machines that stopped sending heartbeats and marks them OFFLINE.
// Runs every few real seconds in the background (see index.ts); tests call it directly.
import { getClock } from '../config/clock.js';
import { db, inBookingTransaction } from '../config/database.js';
import { env } from '../config/env.js';
import { requestBlockedOrderRetry } from '../operations/blocked-orders.js';
import { handleMachineFailure } from '../operations/machine-failure.js';

// How often the check runs, in real milliseconds.
export const HEARTBEAT_CHECK_INTERVAL_MS = 2_000;

// How long a working machine may stay silent, in simulated milliseconds: the timeout is set
// in real seconds and converted with the clock scale (10 s at 60x is 10 simulated minutes),
// because lastHeartbeatAt is simulated time.
function heartbeatTimeoutMs(): number {
  return env.HEARTBEAT_TIMEOUT_SECONDS * 1000 * getClock().scale;
}

// Marks every working machine that has been silent longer than the timeout as OFFLINE.
// Returns the ids of the machines it marked.
export async function markSilentMachinesOffline(): Promise<string[]> {
  const cutoff = new Date(getClock().now().getTime() - heartbeatTimeoutMs());
  const marked: string[] = [];

  // One transaction per machine: one machine's failure handling can't hold up or undo
  // another's.
  for (const machineId of await db.machines.findSilentSince(cutoff)) {
    const changed = await inBookingTransaction(
      (tx) => handleMachineFailure(tx, machineId, { type: 'SILENT', lastHeartbeatBefore: cutoff }),
      { machineId },
    );
    if (changed) marked.push(machineId);
  }

  // Their orders wait for a new machine; they are rerouted in the background.
  if (marked.length > 0) requestBlockedOrderRetry();

  return marked;
}
