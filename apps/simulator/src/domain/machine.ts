// The machine's state machine. Pure: no I/O, no timers, and the current simulated time is
// passed in, so every transition can be tested directly. See "Simulator" in
// docs/design-decisions.md.
import type { MachineCommand, MachineEventRequest } from '@factorymustgrow/shared';

export type MachineState =
  | { status: 'IDLE' }
  // endsAt: the simulated time (ms since the epoch) when the job finishes.
  | { status: 'RUNNING'; jobId: string; endsAt: number }
  | { status: 'ERROR' };

// An event before the outbox gives it an eventId and a seq.
export type MachineEvent = Pick<MachineEventRequest, 'type' | 'payload'>;

// `now` is the backend's simulated time, in ms since the epoch.
export type MachineInput =
  | { kind: 'command'; command: MachineCommand; now: number }
  // Time has passed: a running job may have finished.
  | { kind: 'tick'; now: number };

export interface StepResult {
  state: MachineState;
  events: MachineEvent[];
  // False when a command was left for later: START_JOB while the machine is busy. The backend
  // resends it until it is confirmed, so it must not be marked as seen.
  applied: boolean;
}

export const initialState: MachineState = { status: 'IDLE' };

// How long a job runs, in simulated ms. An end before the start counts as no time at all.
export function jobDurationMs(plannedStart: string, plannedEnd: string): number {
  return Math.max(0, Date.parse(plannedEnd) - Date.parse(plannedStart));
}

// Every command is confirmed by its event (START_JOB → JOB_STARTED, FAIL → MACHINE_FAILURE,
// CANCEL_JOB → JOB_CANCELLED, RESET → MACHINE_RESET), including when the machine is already
// in the state the command asks for, so the backend can always mark it acknowledged.
// The one exception is START_JOB on a busy machine, which waits until the machine is IDLE.
export function step(state: MachineState, input: MachineInput): StepResult {
  if (input.kind === 'tick') {
    if (state.status === 'RUNNING' && input.now >= state.endsAt) {
      return done(initialState, [{ type: 'JOB_COMPLETED', payload: { jobId: state.jobId } }]);
    }
    return done(state, []);
  }

  const { command } = input;

  switch (command.type) {
    case 'START_JOB': {
      if (state.status !== 'IDLE') {
        return { state, events: [], applied: false };
      }
      const { jobId, plannedStart, plannedEnd } = command.payload;
      // The job runs for its planned duration from when the command arrives, which may be a
      // little after plannedStart.
      const endsAt = input.now + jobDurationMs(plannedStart, plannedEnd);
      return done({ status: 'RUNNING', jobId, endsAt }, [
        { type: 'JOB_STARTED', payload: { jobId } },
      ]);
    }

    case 'FAIL': {
      // The job is lost with the machine; the backend releases it and reroutes the order.
      const payload = state.status === 'RUNNING' ? { jobId: state.jobId } : {};
      return done({ status: 'ERROR' }, [{ type: 'MACHINE_FAILURE', payload }]);
    }

    case 'CANCEL_JOB': {
      const { jobId } = command.payload;
      // A job that isn't running here (it finished, or never started) is already where the
      // backend wants it, so it is confirmed all the same.
      const next = state.status === 'RUNNING' && state.jobId === jobId ? initialState : state;
      return done(next, [{ type: 'JOB_CANCELLED', payload: { jobId } }]);
    }

    case 'RESET': {
      // A reset stops whatever the controller was doing, including a running job.
      const events: MachineEvent[] = [];
      if (state.status === 'RUNNING') {
        events.push({ type: 'JOB_CANCELLED', payload: { jobId: state.jobId } });
      }
      events.push({ type: 'MACHINE_RESET', payload: {} });
      return done(initialState, events);
    }
  }
}

function done(state: MachineState, events: MachineEvent[]): StepResult {
  return { state, events, applied: true };
}
