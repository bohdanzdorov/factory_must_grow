import type { MachineCommand } from '@factorymustgrow/shared';
import { pino } from 'pino';

export const silentLogger = pino({ level: 'silent' });

export const MINUTE = 60_000;
export const T0 = Date.parse('2026-11-19T08:00:00.000Z');

// A START_JOB for a job lasting `minutes` of simulated time.
export function startJob(id: string, jobId: string, minutes: number): MachineCommand {
  return {
    id,
    type: 'START_JOB',
    payload: {
      jobId,
      plannedStart: new Date(T0).toISOString(),
      plannedEnd: new Date(T0 + minutes * MINUTE).toISOString(),
    },
  };
}

export function fail(id: string): MachineCommand {
  return { id, type: 'FAIL', payload: {} };
}

export function reset(id: string): MachineCommand {
  return { id, type: 'RESET', payload: {} };
}

export function cancelJob(id: string, jobId: string): MachineCommand {
  return { id, type: 'CANCEL_JOB', payload: { jobId } };
}

// Real time that only moves when the test moves it.
export function fakeRealTime(start = T0): { now: () => number; advance: (ms: number) => void } {
  let now = start;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
    },
  };
}
