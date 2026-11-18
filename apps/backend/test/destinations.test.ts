import { DestinationsSchema } from '@factorymustgrow/shared';
import { describe, expect, it } from 'vitest';
import { api } from './helpers/api.js';
import { createShippingLeadTime, createSite } from './helpers/factories.js';

describe('GET /api/destinations', () => {
  it('lists every destination once, sorted, however many sites ship there', async () => {
    const ham = await createSite({ id: 'HAM' });
    const lon = await createSite({ id: 'LON' });
    await createShippingLeadTime({ siteId: ham.id, destination: 'GB', days: 3 });
    await createShippingLeadTime({ siteId: ham.id, destination: 'DE', days: 1 });
    await createShippingLeadTime({ siteId: lon.id, destination: 'GB', days: 1 });
    await createShippingLeadTime({ siteId: lon.id, destination: 'US', days: 6 });

    const res = await api().get('/api/destinations');

    expect(res.status).toBe(200);
    expect(DestinationsSchema.parse(res.body)).toEqual(['DE', 'GB', 'US']);
  });

  it('is empty when no site ships anywhere', async () => {
    await createSite({ id: 'HAM' });

    const res = await api().get('/api/destinations');

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
