// Runs a task again and again in the background, every `intervalMs` real milliseconds.
// A run never overlaps the next one: the wait starts only after a run has finished, so a slow
// run (a busy database, say) delays the next instead of piling up beside it.
import { setTimeout as sleep } from 'node:timers/promises';
import { logger } from '../config/logger.js';

export interface BackgroundLoop {
  // Stops the loop and waits for a run in progress to finish.
  stop(): Promise<void>;
}

export function startLoop(
  name: string,
  task: () => Promise<void>,
  options: { intervalMs: number; firstRunAfterMs?: number },
): BackgroundLoop {
  const stopping = new AbortController();

  async function run(): Promise<void> {
    // Waits that end early when stop() is called.
    const wait = (ms: number) =>
      sleep(ms, undefined, { signal: stopping.signal }).then(
        () => true,
        () => false,
      );

    if (!(await wait(options.firstRunAfterMs ?? options.intervalMs))) return;

    while (!stopping.signal.aborted) {
      try {
        await task();
      } catch (err) {
        // One failed run must not stop the loop; the next run tries again.
        logger.error({ err, loop: name }, 'Background task failed');
      }
      if (!(await wait(options.intervalMs))) return;
    }
  }

  const running = run();
  logger.info({ loop: name, intervalMs: options.intervalMs }, 'Background loop started');

  return {
    async stop() {
      stopping.abort();
      await running;
    },
  };
}
