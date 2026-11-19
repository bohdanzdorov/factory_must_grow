// One machine: the state machine plus its link to the backend. tick() runs once per real
// second; the run loop lives in index.ts.
import type { MachineCommand } from '@factorymustgrow/shared';
import type { Logger } from 'pino';
import type { BackendApi } from './transport/api-client.js';
import type { BackendClock } from './domain/clock.js';
import { initialState, step, type MachineInput, type MachineState } from './domain/machine.js';
import type { Outbox } from './transport/outbox.js';

export const TICK_MS = 1_000;
// How often the clock is read again; between readings it is estimated from the scale.
export const CLOCK_REFRESH_MS = 30_000;

export interface SimulatorOptions {
  machineId: string;
  api: BackendApi;
  clock: BackendClock;
  outbox: Outbox;
  logger: Logger;
  // Real time, used only to decide when to read the clock again.
  realNow?: () => number;
}

export class Simulator {
  private machineState: MachineState = initialState;
  // Commands already carried out. The backend resends a command until its event arrives.
  private readonly seenCommandIds = new Set<string>();
  private clockReadAt: number;
  private backendReachable = true;

  private readonly machineId: string;
  private readonly api: BackendApi;
  private readonly clock: BackendClock;
  private readonly outbox: Outbox;
  private readonly logger: Logger;
  private readonly realNow: () => number;

  constructor(options: SimulatorOptions) {
    this.machineId = options.machineId;
    this.api = options.api;
    this.clock = options.clock;
    this.outbox = options.outbox;
    this.logger = options.logger;
    this.realNow = options.realNow ?? Date.now;
    this.clockReadAt = this.realNow();
  }

  get state(): MachineState {
    return this.machineState;
  }

  async tick(): Promise<void> {
    this.apply({ kind: 'tick', now: this.simulatedNow() });
    await this.refreshClock();
    // Events first, so the backend hears about a finished job before the heartbeat that
    // reports the machine IDLE.
    await this.outbox.flush();

    const commands = await this.heartbeat();
    for (const command of commands) this.handle(command);

    await this.outbox.flush();
  }

  private async heartbeat(): Promise<MachineCommand[]> {
    const state = this.machineState;
    try {
      const { commands } = await this.api.heartbeat(this.machineId, {
        state: state.status,
        jobId: state.status === 'RUNNING' ? state.jobId : null,
      });
      if (!this.backendReachable) this.logger.info('Heartbeat delivered again');
      this.backendReachable = true;
      return commands;
    } catch (err) {
      // Logged once per outage, not every second.
      if (this.backendReachable) {
        this.logger.warn({ err: describe(err) }, 'Heartbeat failed, will keep trying');
      }
      this.backendReachable = false;
      return [];
    }
  }

  private handle(command: MachineCommand): void {
    if (this.seenCommandIds.has(command.id)) return;

    const applied = this.apply({ kind: 'command', command, now: this.simulatedNow() });
    if (applied) {
      this.seenCommandIds.add(command.id);
      this.logger.info({ command }, 'Command carried out');
    }
  }

  private apply(input: MachineInput): boolean {
    const before = this.machineState;
    const { state, events, applied } = step(before, input);

    this.machineState = state;
    for (const event of events) this.outbox.add(event);

    if (state.status !== before.status) {
      this.logger.info(
        {
          from: before.status,
          to: state.status,
          simulatedNow: new Date(input.now).toISOString(),
          ...(state.status === 'RUNNING' ? { endsAt: new Date(state.endsAt).toISOString() } : {}),
        },
        'State changed',
      );
    }
    return applied;
  }

  // The backend's simulated time, in ms since the epoch.
  private simulatedNow(): number {
    return this.clock.now().getTime();
  }

  private async refreshClock(): Promise<void> {
    if (this.realNow() - this.clockReadAt < CLOCK_REFRESH_MS) return;
    this.clockReadAt = this.realNow();
    try {
      this.clock.update(await this.api.getClock());
    } catch (err) {
      // Keep estimating from the last reading.
      this.logger.debug({ err: describe(err) }, 'Clock refresh failed');
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
