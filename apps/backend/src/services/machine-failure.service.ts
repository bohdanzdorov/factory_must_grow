// What happens when a machine fails. Both ways of finding out end up here, so they behave the
// same: the machine says so (a MACHINE_FAILURE event), or it goes silent (missed heartbeats).
// See "Failure detection" in docs/design-decisions.md.
import type { Models } from '../config/database.js';
import { logger } from '../config/logger.js';
import { WORKING_STATUSES } from '../models/machines.model.js';

export type FailureReason =
  // The machine reported MACHINE_FAILURE: it becomes ERROR.
  | { type: 'REPORTED' }
  // No heartbeat since `lastHeartbeatBefore`: it becomes OFFLINE.
  | { type: 'SILENT'; lastHeartbeatBefore: Date };

// Marks the machine as failed. Returns true if its status changed, false if there was nothing
// to do (it was already failed, or a heartbeat arrived just in time). Safe to call twice.
//
// For now only the status changes, which is enough for routing to stop giving it work.
// Releasing and rerouting its jobs will be added here too.
export async function handleMachineFailure(
  tx: Models,
  machineId: string,
  reason: FailureReason,
): Promise<boolean> {
  if (reason.type === 'REPORTED') {
    // From IDLE, RUNNING or OFFLINE. OFFLINE is included because we can hear the machine
    // again, and it says it is broken.
    const changed = await tx.machines.changeStatus(machineId, {
      from: [...WORKING_STATUSES, 'OFFLINE'],
      to: 'ERROR',
    });
    if (changed) logger.warn({ machineId }, 'Machine reported a failure; now ERROR');
    return changed;
  }

  // From IDLE or RUNNING only, and only if it is still silent. A machine in ERROR that goes
  // quiet stays ERROR: it is already unavailable, and ERROR ends with MACHINE_RESET.
  const changed = await tx.machines.changeStatus(machineId, {
    from: WORKING_STATUSES,
    to: 'OFFLINE',
    lastHeartbeatBefore: reason.lastHeartbeatBefore,
  });
  if (changed) logger.warn({ machineId }, 'Machine went silent; now OFFLINE');
  return changed;
}
