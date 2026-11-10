import type { CreateOrderInput, ListOrdersQuery, Order } from '@factorymustgrow/shared';
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
  // Business rule: routing needs a shipping time to this destination.
  if (!(await db.shippingLeadTimes.destinationExists(input.destination))) {
    throw new HttpError(400, `Unknown destination: ${input.destination}`);
  }

  const newOrder = toNewOrder(input);
  const record = await db.orders.insert(newOrder);

  return toOrder(record);
}
