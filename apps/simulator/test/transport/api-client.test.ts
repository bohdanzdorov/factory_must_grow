import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from '../../src/transport/api-client.js';

// Replaces fetch with one that always answers with this response.
function respondWith(body: string, status: number, statusText = ''): void {
  vi.stubGlobal('fetch', () => Promise.resolve(new Response(body || null, { status, statusText })));
}

const api = createApiClient('http://backend.test', 'secret');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createApiClient', () => {
  it("uses the backend's own message from an error response", async () => {
    respondWith(JSON.stringify({ error: { message: 'Machine not found: X' } }), 404);

    const error = await api.getMachine('X').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 404,
      message: 'GET /api/machines/X failed with 404: Machine not found: X',
    });
  });

  it('falls back to the status text when the error body is not the API error shape', async () => {
    respondWith('<html>Bad gateway</html>', 502, 'Bad Gateway');

    await expect(api.getClock()).rejects.toMatchObject({
      status: 502,
      message: 'GET /api/clock failed with 502: Bad Gateway',
    });
  });

  it('checks a successful response against the shared schema', async () => {
    respondWith(JSON.stringify({ now: 'not a date', scale: 60 }), 200);

    await expect(api.getClock()).rejects.toThrow();
  });

  it('accepts an event with an empty response', async () => {
    respondWith('', 204);

    await expect(
      api.sendEvent('X', {
        eventId: crypto.randomUUID(),
        seq: 1,
        type: 'MACHINE_RESET',
        payload: {},
      }),
    ).resolves.toBeUndefined();
  });

  it('sends the ingest token', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ commands: [] }))));
    vi.stubGlobal('fetch', fetchSpy);

    await api.heartbeat('X', { state: 'IDLE', jobId: null });

    expect(fetchSpy).toHaveBeenCalledWith(
      new URL('http://backend.test/api/machines/X/heartbeat'),
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer secret' },
      }),
    );
  });
});
