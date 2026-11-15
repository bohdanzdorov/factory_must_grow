import type { CreateOrderInput, ListOrdersQuery, Order } from '@factorymustgrow/shared';
import { getClock } from '../config/clock.js';
import { db } from '../config/database.js';
import { HttpError } from '../errors/http-error.js';
import { toNewOrder, toOrder } from '../mappers/order.mapper.js';

export async function listOrders(query: ListOrdersQuery): Promise<Order[]> {
  const records = await db.orders.findMany({ status: query.status });

  return records.map(toOrder);
}

export async function getOrder(id: string): Promise<Order> {
  const record = await db.orders.findById(id);

  if (!record) {
    throw new HttpError(404, `Order not found: ${id}`);
  }

  return toOrder(record);
}

export async function createOrder(input: CreateOrderInput): Promise<Order> {
  const now = getClock().now();

  // Checked here rather than in the shared schema, because "now" is simulated time.
  if (new Date(input.deadline) <= now) {
    throw new HttpError(400, 'Invalid request', [
      { path: 'deadline', message: 'Deadline must be in the future' },
    ]);
  }

  // Business rule: routing needs a shipping time to this destination.
  if (!(await db.shippingLeadTimes.destinationExists(input.destination))) {
    throw new HttpError(400, `Unknown destination: ${input.destination}`);
  }

  const record = await db.orders.insert(toNewOrder(input, now));

  return toOrder(record);
}
