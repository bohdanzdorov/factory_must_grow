// Pretends to be one machine's controller. Start one process per machine:
//   npm run sim -- --site HAM --machine HAM-MILL5-1
import { setTimeout as sleep } from 'node:timers/promises';
import { pino } from 'pino';
import { ApiError, createApiClient, type BackendApi } from './transport/api-client.js';
import { parseSimulatorArgs, USAGE, type SimulatorArgs } from './config/args.js';
import { BackendClock } from './domain/clock.js';
import { Outbox } from './transport/outbox.js';
import { Simulator, TICK_MS } from './simulator.js';

const STARTUP_RETRY_MS = 2_000;

let args: SimulatorArgs;
try {
  args = parseSimulatorArgs(process.argv.slice(2));
} catch (err) {
  console.error(`${err instanceof Error ? err.message : String(err)}\n\n${USAGE}`);
  process.exit(2);
}

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { machineId: args.machineId },
  ...(process.stdout.isTTY ? { transport: { target: 'pino-pretty' } } : {}),
});

const api = createApiClient(args.apiUrl, args.ingestToken);
const stop = new AbortController();
process.once('SIGINT', () => {
  stop.abort();
});
process.once('SIGTERM', () => {
  stop.abort();
});

await main();

async function main(): Promise<void> {
  if (!args.ingestToken) logger.warn('INGEST_TOKEN is not set; the backend may refuse requests');

  const clock = await untilReady(() => startClock(api), 'clock');
  if (!clock) return;
  const verified = await untilReady(() => verifyMachine(api, args), 'machine');
  if (!verified) return;

  const outbox = new Outbox({
    send: (event) => api.sendEvent(args.machineId, event),
    logger,
  });
  const simulator = new Simulator({ machineId: args.machineId, api, clock, outbox, logger });

  logger.info(
    { siteId: args.siteId, apiUrl: args.apiUrl, scale: clock.scale },
    'Simulator started',
  );

  // Not setInterval: a slow request must never overlap the next tick.
  while (!stop.signal.aborted) {
    const started = Date.now();
    try {
      await simulator.tick();
    } catch (err) {
      logger.error({ err }, 'Tick failed');
    }
    await sleep(Math.max(0, TICK_MS - (Date.now() - started)), undefined, {
      signal: stop.signal,
    }).catch(() => undefined);
  }

  // One last try for events still queued; whatever doesn't make it is lost (see outbox.ts).
  await outbox.flush();
  logger.info({ undelivered: outbox.size }, 'Simulator stopped');
}

async function startClock(backend: BackendApi): Promise<BackendClock> {
  return BackendClock.fromState(await backend.getClock());
}

// Exits with a clear message when the machine doesn't exist or belongs to another site.
async function verifyMachine(
  backend: BackendApi,
  { siteId, machineId }: SimulatorArgs,
): Promise<boolean> {
  try {
    const machine = await backend.getMachine(machineId);
    if (machine.siteId !== siteId) {
      fatal(`Machine ${machineId} belongs to site ${machine.siteId}, not ${siteId}.`);
    }
    return true;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) fatal(`Machine ${machineId} not found.`);
    throw err;
  }
}

// Waits for the backend to come up, so simulators can start before it does.
// Returns undefined if the process is stopped while waiting.
async function untilReady<T>(load: () => Promise<T>, what: string): Promise<T | undefined> {
  for (;;) {
    try {
      return await load();
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        `Backend not ready (${what}), retrying`,
      );
    }
    try {
      await sleep(STARTUP_RETRY_MS, undefined, { signal: stop.signal });
    } catch {
      return undefined;
    }
  }
}

function fatal(message: string): never {
  logger.fatal(message);
  process.exit(1);
}
