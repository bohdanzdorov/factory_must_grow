import { MachineCommandSchema, type MachineCommand } from '@factorymustgrow/shared';
import type { Command } from '../generated/prisma/client.js';

// Database record → command in a heartbeat response. The payload is JSON in the database,
// so it is checked against the shared schema; returns null if the stored command is invalid.
export function toMachineCommand(record: Command): MachineCommand | null {
  const parsed = MachineCommandSchema.safeParse({
    id: record.id,
    type: record.type,
    payload: record.payload,
  });

  return parsed.success ? parsed.data : null;
}
