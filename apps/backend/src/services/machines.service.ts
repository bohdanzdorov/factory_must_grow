import type { ListMachinesQuery, Machine } from '@factorymustgrow/shared';
import { db } from '../config/database.js';
import { HttpError } from '../errors/http-error.js';
import { toMachine } from '../mappers/machine.mapper.js';

export async function listMachines(query: ListMachinesQuery): Promise<Machine[]> {
  const records = await db.machines.findMany({ siteId: query.siteId });

  return records.map(toMachine);
}

export async function getMachine(id: string): Promise<Machine> {
  const record = await db.machines.findById(id);

  if (!record) {
    throw new HttpError(404, `Machine not found: ${id}`);
  }

  return toMachine(record);
}
