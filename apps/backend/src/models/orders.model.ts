import type { DbClient } from '../config/prisma.js';
import type { Capability, Order, OrderStatus } from '../generated/prisma/client.js';

export interface NewOrder {
  partName: string;
  quantity: number;
  requiredCapabilities: Capability[];
  deadline: Date;
  destination: string;
  createdAt: Date;
}

export function ordersModel(db: DbClient) {
  return {
    findMany(filter: { status?: OrderStatus }): Promise<Order[]> {
      return db.order.findMany({
        where: { status: filter.status },
        // id breaks ties, so orders created at the same moment keep a stable order.
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      });
    },

    findById(id: string): Promise<Order | null> {
      return db.order.findUnique({ where: { id } });
    },

    insert(data: NewOrder): Promise<Order> {
      return db.order.create({ data });
    },
  };
}
