import { ErrorResponseSchema, SiteDetailSchema, SiteSchema } from '@factorymustgrow/shared';
import { describe, expect, it } from 'vitest';
import { api } from './helpers/api.js';
import { createMachine, createSite } from './helpers/factories.js';

describe('GET /api/sites', () => {
  it('lists sites sorted by id', async () => {
    await createSite({ id: 'LON', name: 'London', country: 'GB' });
    await createSite({ id: 'HAM', name: 'Hamburg', country: 'DE' });

    const res = await api().get('/api/sites');

    expect(res.status).toBe(200);
    const sites = SiteSchema.array().parse(res.body);
    expect(sites.map((site) => site.id)).toEqual(['HAM', 'LON']);
  });

  it('returns an empty list when there are no sites', async () => {
    const res = await api().get('/api/sites');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe('GET /api/sites/:id', () => {
  it('returns the site with its machines and their capabilities', async () => {
    await createSite({ id: 'HAM', name: 'Hamburg' });
    await createMachine({
      id: 'HAM-MILL5-1',
      siteId: 'HAM',
      capabilities: [
        { capability: 'MILLING_5_AXIS', cycleMinutesPerPart: 12 },
        { capability: 'MILLING_3_AXIS', cycleMinutesPerPart: 10.5 },
      ],
    });

    const res = await api().get('/api/sites/HAM');

    expect(res.status).toBe(200);
    const site = SiteDetailSchema.parse(res.body);
    expect(site.name).toBe('Hamburg');
    expect(site.machines).toHaveLength(1);
    expect(site.machines[0]?.capabilities).toEqual([
      { capability: 'MILLING_3_AXIS', cycleMinutesPerPart: 10.5 },
      { capability: 'MILLING_5_AXIS', cycleMinutesPerPart: 12 },
    ]);
  });

  it('returns 404 for an unknown site', async () => {
    const res = await api().get('/api/sites/NOPE');

    expect(res.status).toBe(404);
    expect(ErrorResponseSchema.parse(res.body).error.message).toBe('Site not found: NOPE');
  });
});
