// Events waiting to reach the backend. They are sent one at a time, in order, and each stays
// at the front until the backend accepts it, so delivery is at least once: a lost response
// means the same event (same eventId and seq) is sent again.
// In memory only: events not yet delivered are lost if the process stops. The backend's
// missed-heartbeat timeout covers a machine that disappears.
import { randomUUID } from 'node:crypto';
import type { MachineEventRequest } from '@factorymustgrow/shared';
import type { Logger } from 'pino';
import { ApiError } from './api-client.js';
import type { MachineEvent } from '../domain/machine.js';

export const RETRY_FIRST_MS = 500;
export const RETRY_MAX_MS = 5_000;

export interface OutboxOptions {
  send: (event: MachineEventRequest) => Promise<void>;
  logger: Logger;
  // seq starts at the real time, so events after a restart are never older than ones the
  // backend has already seen.
  firstSeq?: number;
  newId?: () => string;
  realNow?: () => number;
}

export class Outbox {
  private readonly queue: MachineEventRequest[] = [];
  private nextSeq: number;
  private retryDelayMs = RETRY_FIRST_MS;
  private retryAt = 0;

  private readonly send: OutboxOptions['send'];
  private readonly logger: Logger;
  private readonly newId: () => string;
  private readonly realNow: () => number;

  constructor(options: OutboxOptions) {
    this.send = options.send;
    this.logger = options.logger;
    this.realNow = options.realNow ?? Date.now;
    this.newId = options.newId ?? randomUUID;
    this.nextSeq = options.firstSeq ?? this.realNow();
  }

  get size(): number {
    return this.queue.length;
  }

  add(event: MachineEvent): MachineEventRequest {
    const request: MachineEventRequest = { eventId: this.newId(), seq: this.nextSeq++, ...event };
    this.queue.push(request);
    return request;
  }

  // Sends queued events in order until one fails, then waits (with backoff) before trying
  // again. Returns at once while waiting, so a backend outage never delays heartbeats.
  async flush(): Promise<void> {
    if (this.realNow() < this.retryAt) return;

    for (let event = this.queue[0]; event; event = this.queue[0]) {
      try {
        await this.send(event);
      } catch (err) {
        if (!isRetryable(err)) {
          // The backend rejected the event itself; sending it again cannot help.
          this.logger.error({ err, event }, 'Event rejected by the backend, dropping it');
          this.queue.shift();
          continue;
        }
        this.logger.warn(
          { err: describe(err), eventId: event.eventId, retryInMs: this.retryDelayMs },
          'Event not delivered, will retry',
        );
        this.retryAt = this.realNow() + this.retryDelayMs;
        this.retryDelayMs = Math.min(this.retryDelayMs * 2, RETRY_MAX_MS);
        return;
      }

      this.queue.shift();
      this.retryDelayMs = RETRY_FIRST_MS;
      this.logger.info({ type: event.type, seq: event.seq, ...event.payload }, 'Event delivered');
    }
  }
}

// Only a 400 means the event itself is invalid. Anything else (network errors, 5xx, a 404
// while the endpoint isn't deployed, a 401 before the token is set) may succeed later.
function isRetryable(err: unknown): boolean {
  return !(err instanceof ApiError && err.status === 400);
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
