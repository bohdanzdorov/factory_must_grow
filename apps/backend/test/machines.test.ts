import { ErrorResponseSchema, MachineSchema } from '@factorymustgrow/shared';
import { describe, expect, it } from 'vitest';
import { api } from './helpers/api.js';
import { createMachine, createSite } from './helpers/factories.js';

describe('GET /api/machines', () => {
  it('lists all machines', async () => {
    await createMachine({ id: 'M-2' });
    await createMachine({ id: 'M-1' });

    const res = await api().get('/api/machines');

    expect(res.status).toBe(200);
    expect(
      MachineSchema.array()
        .parse(res.body)
        .map((machine) => machine.id),
    ).toEqual(['M-1', 'M-2']);
  });

  it('filters by site', async () => {
    await createSite({ id: 'HAM' });
    await createSite({ id: 'KYI' });
    await createMachine({ id: 'HAM-1', siteId: 'HAM' });
    await createMachine({ id: 'KYI-1', siteId: 'KYI' });

    const res = await api().get('/api/machines?siteId=KYI');

    expect(res.status).toBe(200);
    expect(
      MachineSchema.array()
        .parse(res.body)
        .map((machine) => machine.id),
    ).toEqual(['KYI-1']);
  });
});

describe('GET /api/machines/:id', () => {
  it('returns the machine without its internal sequence number', async () => {
    // A BigInt like this would crash JSON encoding if it were included.
    await createMachine({ id: 'M-1', lastSeq: 1_762_700_000_000n });

    const res = await api().get('/api/machines/M-1');

    expect(res.status).toBe(200);
    expect(MachineSchema.parse(res.body).id).toBe('M-1');
    expect(res.body).not.toHaveProperty('lastSeq');
  });

  it('returns 404 for an unknown machine', async () => {
    const res = await api().get('/api/machines/NOPE');

    expect(res.status).toBe(404);
    expect(ErrorResponseSchema.parse(res.body).error.message).toBe('Machine not found: NOPE');
  });
});
