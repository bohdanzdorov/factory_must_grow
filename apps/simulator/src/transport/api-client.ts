// HTTP calls to the backend. Every response is checked against the shared schemas.
import {
  ClockStateSchema,
  ErrorResponseSchema,
  HeartbeatResponseSchema,
  MachineSchema,
  type ClockState,
  type HeartbeatRequest,
  type HeartbeatResponse,
  type Machine,
  type MachineEventRequest,
} from '@factorymustgrow/shared';
import { z } from 'zod';

const REQUEST_TIMEOUT_MS = 5_000;

// An error response from the backend, with its status and the backend's own message.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// What the simulator needs from the backend. Tests use a fake.
export interface BackendApi {
  getClock: () => Promise<ClockState>;
  getMachine: (machineId: string) => Promise<Machine>;
  heartbeat: (machineId: string, body: HeartbeatRequest) => Promise<HeartbeatResponse>;
  sendEvent: (machineId: string, body: MachineEventRequest) => Promise<void>;
}

export function createApiClient(baseUrl: string, ingestToken: string | undefined): BackendApi {
  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (ingestToken) headers.authorization = `Bearer ${ingestToken}`;

    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const responseBody = await readBody(response);

    if (!response.ok) {
      // The backend's error shape, as the frontend reads it; anything else (a proxy's HTML
      // page, say) falls back to the status text.
      const error = ErrorResponseSchema.safeParse(responseBody);
      const reason = error.success ? error.data.error.message : response.statusText;
      throw new ApiError(
        response.status,
        `${method} ${path} failed with ${String(response.status)}: ${reason}`,
      );
    }

    return schema.parse(responseBody);
  }

  const id = encodeURIComponent;

  return {
    getClock: () => request('GET', '/api/clock', ClockStateSchema),
    getMachine: (machineId) => request('GET', `/api/machines/${id(machineId)}`, MachineSchema),
    heartbeat: (machineId, body) =>
      request('POST', `/api/machines/${id(machineId)}/heartbeat`, HeartbeatResponseSchema, body),
    // Only success matters, so the response body is not checked.
    sendEvent: async (machineId, body) => {
      await request('POST', `/api/machines/${id(machineId)}/events`, z.unknown(), body);
    },
  };
}

// The body as JSON, or undefined when it is empty or not JSON.
async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    return undefined;
  }
}
