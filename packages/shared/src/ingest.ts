import { z } from 'zod';
import { MachineEventTypeSchema } from './enums.js';

// The protocol between a machine (or its simulator) and the backend. See "Commands" and
// "Events" in docs/design-decisions.md.

// What the machine itself knows. OFFLINE is only ever decided by the backend.
export const ReportedMachineStateSchema = z.enum(['IDLE', 'RUNNING', 'ERROR']);
export type ReportedMachineState = z.infer<typeof ReportedMachineStateSchema>;

// POST /api/machines/:id/heartbeat, sent every real second. No seq: only events have one.
export const HeartbeatRequestSchema = z.object({
  state: ReportedMachineStateSchema,
  // The job the machine is running, so the backend can spot one it has already released.
  jobId: z.string().nullable(),
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

const commandBase = { id: z.string().min(1) };

export const StartJobCommandSchema = z.object({
  ...commandBase,
  type: z.literal('START_JOB'),
  payload: z.object({
    jobId: z.string().min(1),
    // Simulated times. The machine runs for plannedEnd − plannedStart of simulated time.
    plannedStart: z.iso.datetime(),
    plannedEnd: z.iso.datetime(),
  }),
});

export const FailCommandSchema = z.object({
  ...commandBase,
  type: z.literal('FAIL'),
  payload: z.object({}),
});

export const ResetCommandSchema = z.object({
  ...commandBase,
  type: z.literal('RESET'),
  payload: z.object({}),
});

export const CancelJobCommandSchema = z.object({
  ...commandBase,
  type: z.literal('CANCEL_JOB'),
  payload: z.object({ jobId: z.string().min(1) }),
});

export const MachineCommandSchema = z.discriminatedUnion('type', [
  StartJobCommandSchema,
  FailCommandSchema,
  ResetCommandSchema,
  CancelJobCommandSchema,
]);
export type MachineCommand = z.infer<typeof MachineCommandSchema>;

// Commands not yet acknowledged, resent on every heartbeat until their event arrives.
export const HeartbeatResponseSchema = z.object({
  commands: z.array(MachineCommandSchema),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

// POST /api/machines/:id/events. Delivered at least once and in order; the backend stores
// (machineId, eventId) once and ignores an event whose seq is lower than one it processed.
export const MachineEventRequestSchema = z.object({
  eventId: z.uuid(),
  seq: z.number().int().nonnegative(),
  type: MachineEventTypeSchema,
  payload: z.object({
    // Set for job events and for a failure during a job.
    jobId: z.string().min(1).optional(),
  }),
});
export type MachineEventRequest = z.infer<typeof MachineEventRequestSchema>;

// Response of POST /api/machines/:id/events. DUPLICATE: the backend already had this event
// (the first attempt got through, only its response was lost), so the machine can move on.
export const MachineEventResponseSchema = z.object({
  result: z.enum(['STORED', 'DUPLICATE']),
});
export type MachineEventResponse = z.infer<typeof MachineEventResponseSchema>;
