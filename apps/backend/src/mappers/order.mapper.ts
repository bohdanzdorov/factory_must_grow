import type { CreateOrderInput, Order } from '@factorymustgrow/shared';
import type { Order as OrderRecord } from '../generated/prisma/client.js';
import type { NewOrder } from '../models/orders.model.js';

// Database record → API response.
export function toOrder(record: OrderRecord): Order {
  return {
    id: record.id,
    partName: record.partName,
    quantity: record.quantity,
    requiredCapabilities: record.requiredCapabilities,
    deadline: record.deadline.toISOString(),
    destination: record.destination,
    status: record.status,
    blockedReason: record.blockedReason,
    createdAt: record.createdAt.toISOString(),
  };
}

// Validated request → what the model stores.
export function toNewOrder(input: CreateOrderInput): NewOrder {
  return {
    partName: input.partName,
    quantity: input.quantity,
    requiredCapabilities: input.requiredCapabilities,
    deadline: new Date(input.deadline),
    destination: input.destination,
  };
}
