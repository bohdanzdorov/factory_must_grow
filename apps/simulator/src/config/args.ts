import { parseArgs } from 'node:util';

export interface SimulatorArgs {
  siteId: string;
  machineId: string;
  apiUrl: string;
  ingestToken: string | undefined;
}

export const USAGE =
  'Usage: npm run sim -- --site <siteId> --machine <machineId> [--api <url>]\n' +
  'Example: npm run sim -- --site HAM --machine HAM-MILL5-1\n' +
  'Environment: SIM_API_URL (default http://localhost:4000), INGEST_TOKEN';

// Throws with a readable message when an argument is missing or unknown.
export function parseSimulatorArgs(
  argv: string[],
  environment: NodeJS.ProcessEnv = process.env,
): SimulatorArgs {
  const { values } = parseArgs({
    args: argv,
    options: {
      site: { type: 'string' },
      machine: { type: 'string' },
      api: { type: 'string' },
    },
    strict: true,
  });

  if (!values.site || !values.machine) {
    throw new Error('Both --site and --machine are required.');
  }

  return {
    siteId: values.site,
    machineId: values.machine,
    apiUrl: values.api ?? environment.SIM_API_URL ?? 'http://localhost:4000',
    ingestToken: environment.INGEST_TOKEN || undefined,
  };
}
