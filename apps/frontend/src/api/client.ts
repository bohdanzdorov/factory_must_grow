// Every call to the backend goes through here. Responses are checked against the shared
// schemas, so the UI never works with data that doesn't match the API contract.
import {
  ClockStateSchema,
  ErrorResponseSchema,
  OrderDecisionResultSchema,
  OrderSchema,
  RoutingDecisionSchema,
  type ErrorResponse,
  type OrderStatus,
} from '@factorymustgrow/shared';
import type { ZodType } from 'zod';

// An error response from the API, with the backend's own message.
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly issues: NonNullable<ErrorResponse['error']['issues']> = [],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, schema: ZodType<T>, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
  });
  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = ErrorResponseSchema.safeParse(body);
    throw parsed.success
      ? new ApiError(response.status, parsed.data.error.message, parsed.data.error.issues)
      : new ApiError(response.status, `Request failed with status ${String(response.status)}`);
  }

  return schema.parse(body);
}

export const api = {
  listOrders: (status?: OrderStatus) =>
    request(`/orders${status ? `?status=${status}` : ''}`, OrderSchema.array()),

  getOrder: (id: string) => request(`/orders/${id}`, OrderSchema),

  listDecisions: (orderId: string) =>
    request(`/orders/${orderId}/decisions`, RoutingDecisionSchema.array()),

  getClock: () => request('/clock', ClockStateSchema),

  routeOrder: (orderId: string) =>
    request(`/orders/${orderId}/route`, OrderDecisionResultSchema, { method: 'POST' }),

  approveDecision: (decisionId: string) =>
    request(`/decisions/${decisionId}/approve`, OrderDecisionResultSchema, { method: 'POST' }),

  rejectDecision: (decisionId: string, reason: string) =>
    request(`/decisions/${decisionId}/reject`, OrderDecisionResultSchema, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};
