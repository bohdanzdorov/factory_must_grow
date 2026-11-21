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

    // Locks the order's row until the surrounding transaction ends, so concurrent work on
    // the same order waits its turn instead of racing. Only meaningful inside `transaction()`.
    // Returns false if the order doesn't exist.
    async lockById(id: string): Promise<boolean> {
      const rows = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM orders WHERE id = ${id} FOR UPDATE
      `;
      return rows.length > 0;
    },

    // Locks several orders like lockById, always in id order: two transactions locking an
    // overlapping set of orders then queue up instead of deadlocking.
    async lockByIds(ids: string[]): Promise<void> {
      if (ids.length === 0) return;
      await db.$queryRaw`
        SELECT id FROM orders WHERE id = ANY(${ids}) ORDER BY id FOR UPDATE
      `;
    },

    // The orders with these ids, most urgent deadline first (id breaks ties).
    findManyByIdsByDeadline(ids: string[]): Promise<Order[]> {
      return db.order.findMany({
        where: { id: { in: ids } },
        orderBy: [{ deadline: 'asc' }, { id: 'asc' }],
      });
    },

    updateStatus(id: string, status: OrderStatus, blockedReason: string | null): Promise<Order> {
      return db.order.update({ where: { id }, data: { status, blockedReason } });
    },
  };
}
