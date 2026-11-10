import type { Machine } from '@factorymustgrow/shared';
import type { MachineRecord } from '../models/machines.model.js';

// Database record → API response.
// lastSeq is left out: it is internal, and JSON cannot encode a BigInt.
export function toMachine(record: MachineRecord): Machine {
  return {
    id: record.id,
    siteId: record.siteId,
    name: record.name,
    status: record.status,
    lastHeartbeatAt: record.lastHeartbeatAt?.toISOString() ?? null,
    capabilities: record.capabilities.map((capability) => ({
      capability: capability.capability,
      cycleMinutesPerPart: capability.cycleMinutesPerPart.toNumber(),
    })),
  };
}
