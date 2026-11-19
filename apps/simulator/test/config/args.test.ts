import { describe, expect, it } from 'vitest';
import { parseSimulatorArgs } from '../../src/config/args.js';

describe('parseSimulatorArgs', () => {
  it('reads the site and machine, with defaults for the rest', () => {
    expect(parseSimulatorArgs(['--site', 'HAM', '--machine', 'HAM-MILL5-1'], {})).toEqual({
      siteId: 'HAM',
      machineId: 'HAM-MILL5-1',
      apiUrl: 'http://localhost:4000',
      ingestToken: undefined,
    });
  });

  it('prefers --api over SIM_API_URL, and reads the token from INGEST_TOKEN', () => {
    const env = { SIM_API_URL: 'http://env:1', INGEST_TOKEN: 'secret' };

    expect(
      parseSimulatorArgs(['--site', 'HAM', '--machine', 'M', '--api', 'http://flag:2'], env),
    ).toMatchObject({ apiUrl: 'http://flag:2', ingestToken: 'secret' });
    expect(parseSimulatorArgs(['--site', 'HAM', '--machine', 'M'], env).apiUrl).toBe(
      'http://env:1',
    );
  });

  it('refuses a missing machine or an unknown option', () => {
    expect(() => parseSimulatorArgs(['--site', 'HAM'], {})).toThrow(/--machine/);
    expect(() => parseSimulatorArgs(['--site', 'HAM', '--machine', 'M', '--x', '1'], {})).toThrow();
  });
});
