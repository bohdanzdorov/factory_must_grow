import type { MachineCommand } from '@factorymustgrow/shared';
import { describe, expect, it } from 'vitest';
import {
  initialState,
  jobDurationMs,
  step,
  type MachineInput,
  type MachineState,
} from '../../src/domain/machine.js';
import { cancelJob, fail, MINUTE, reset, startJob, T0 } from '../helpers.js';

// Simulated time when the command arrives: 5 minutes after the job's plannedStart (T0).
const NOW = T0 + 5 * MINUTE;

function cmd(command: MachineCommand): MachineInput {
  return { kind: 'command', command, now: NOW };
}

const idle: MachineState = initialState;
const error: MachineState = { status: 'ERROR' };
const running: MachineState = { status: 'RUNNING', jobId: 'job-1', endsAt: NOW + 30 * MINUTE };

describe('jobDurationMs', () => {
  it('is the time between plannedStart and plannedEnd', () => {
    const start = new Date(T0).toISOString();
    const end = new Date(T0 + 30 * MINUTE).toISOString();
    expect(jobDurationMs(start, end)).toBe(30 * MINUTE);
  });

  it('treats an end before the start as no time at all', () => {
    const start = new Date(T0).toISOString();
    const end = new Date(T0 - 1).toISOString();
    expect(jobDurationMs(start, end)).toBe(0);
  });
});

describe('step', () => {
  it('START_JOB on an IDLE machine runs the job for its duration from when it arrives', () => {
    expect(step(idle, cmd(startJob('c1', 'job-1', 30)))).toEqual({
      state: { status: 'RUNNING', jobId: 'job-1', endsAt: NOW + 30 * MINUTE },
      events: [{ type: 'JOB_STARTED', payload: { jobId: 'job-1' } }],
      applied: true,
    });
  });

  it.each([
    ['RUNNING', running],
    ['ERROR', error],
  ])('START_JOB on a %s machine waits and is not marked applied', (_name, state) => {
    expect(step(state, cmd(startJob('c2', 'job-2', 30)))).toEqual({
      state,
      events: [],
      applied: false,
    });
  });

  it('a tick before the job ends changes nothing', () => {
    expect(step(running, { kind: 'tick', now: NOW + 30 * MINUTE - 1 })).toEqual({
      state: running,
      events: [],
      applied: true,
    });
  });

  it('a tick once the job ends makes the machine IDLE and reports JOB_COMPLETED', () => {
    expect(step(running, { kind: 'tick', now: NOW + 30 * MINUTE })).toEqual({
      state: idle,
      events: [{ type: 'JOB_COMPLETED', payload: { jobId: 'job-1' } }],
      applied: true,
    });
  });

  it('FAIL on a RUNNING machine reports the failure with the lost job', () => {
    expect(step(running, cmd(fail('c3')))).toEqual({
      state: error,
      events: [{ type: 'MACHINE_FAILURE', payload: { jobId: 'job-1' } }],
      applied: true,
    });
  });

  it.each([
    ['IDLE', idle],
    ['ERROR', error],
  ])('FAIL on a %s machine still confirms with MACHINE_FAILURE', (_name, state) => {
    expect(step(state, cmd(fail('c4')))).toEqual({
      state: error,
      events: [{ type: 'MACHINE_FAILURE', payload: {} }],
      applied: true,
    });
  });

  it('CANCEL_JOB for the running job stops it and reports JOB_CANCELLED', () => {
    expect(step(running, cmd(cancelJob('c5', 'job-1')))).toEqual({
      state: idle,
      events: [{ type: 'JOB_CANCELLED', payload: { jobId: 'job-1' } }],
      applied: true,
    });
  });

  it.each([
    ['running another job', running],
    ['IDLE', idle],
    ['in ERROR', error],
  ])('CANCEL_JOB for a job not running here (%s) changes nothing but is confirmed', (_n, state) => {
    expect(step(state, cmd(cancelJob('c6', 'job-other')))).toEqual({
      state,
      events: [{ type: 'JOB_CANCELLED', payload: { jobId: 'job-other' } }],
      applied: true,
    });
  });

  it.each([
    ['ERROR', error],
    ['IDLE', idle],
  ])('RESET on an %s machine makes it IDLE and reports MACHINE_RESET', (_name, state) => {
    expect(step(state, cmd(reset('c7')))).toEqual({
      state: idle,
      events: [{ type: 'MACHINE_RESET', payload: {} }],
      applied: true,
    });
  });

  it('RESET on a RUNNING machine stops the job: JOB_CANCELLED, then MACHINE_RESET', () => {
    expect(step(running, cmd(reset('c8')))).toEqual({
      state: idle,
      events: [
        { type: 'JOB_CANCELLED', payload: { jobId: 'job-1' } },
        { type: 'MACHINE_RESET', payload: {} },
      ],
      applied: true,
    });
  });
});
