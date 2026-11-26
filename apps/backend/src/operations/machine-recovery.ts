// A failed machine coming back. See "Recovery" in docs/design-decisions.md.
import type { ReportedMachineState } from '@factorymustgrow/shared';
import type { Models } from '../config/database.js';
import { logger } from '../config/logger.js';

export type RecoveryReason =
  // A new MACHINE_RESET event: the operator reset it, so it works again.
  | { type: 'RESET' }
  // A heartbeat, reporting the machine's own state.
  | { type: 'HEARTBEAT'; reported: ReportedMachineState };

// Brings the machine back if this reason allows it. Returns true if it became IDLE (available
// for routing again), so the caller can ask for blocked orders to be retried.
//
// | Reason                | Machine was      | Becomes                                     |
// | --------------------- | ---------------- | ------------------------------------------- |
// | RESET                 | ERROR or OFFLINE | IDLE, or OFFLINE if its site is DOWN        |
// | HEARTBEAT saying IDLE | OFFLINE          | IDLE, if its site is UP                     |
// | HEARTBEAT saying ERROR| OFFLINE          | ERROR (its work was moved when it went off) |
// | anything else         | -                | unchanged                                   |
//
// A heartbeat saying RUNNING leaves an OFFLINE machine OFFLINE: it is still running a job
// that was moved elsewhere. Its queued CANCEL_JOB stops it, and the next heartbeat says IDLE.
export async function handleMachineRecovery(
  tx: Models,
  machineId: string,
  reason: RecoveryReason,
): Promise<boolean> {
  if (reason.type === 'RESET') {
    const back = await tx.machines.changeStatus(machineId, {
      from: ['ERROR', 'OFFLINE'],
      to: 'IDLE',
      siteUp: true,
    });
    if (back) {
      logger.info({ machineId }, 'Machine was reset; now IDLE');
      return true;
    }
    // Reset, but its site is down: it works, yet can't take work until the site is back.
    // OFFLINE (not ERROR), so its first heartbeat after the site comes back brings it back.
    await tx.machines.changeStatus(machineId, { from: ['ERROR'], to: 'OFFLINE', siteUp: false });
    return false;
  }

  if (reason.reported === 'IDLE') {
    const back = await tx.machines.changeStatus(machineId, {
      from: ['OFFLINE'],
      to: 'IDLE',
      siteUp: true,
    });
    if (back) logger.info({ machineId }, 'Machine is sending heartbeats again; now IDLE');
    return back;
  }

  if (reason.reported === 'ERROR') {
    await tx.machines.changeStatus(machineId, { from: ['OFFLINE'], to: 'ERROR' });
  }
  return false;
}
