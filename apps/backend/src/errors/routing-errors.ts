// The machine routing chose failed while routing was running (see operations/propose-route.ts).
// Nothing was saved; routing again sees the machine as failed and picks another.
// inBookingTransaction (config/database.ts) retries on it.
export class ChosenMachineFailedError extends Error {
  constructor(readonly machineId: string) {
    super(`Machine ${machineId} failed while routing chose it`);
    this.name = 'ChosenMachineFailedError';
  }
}
