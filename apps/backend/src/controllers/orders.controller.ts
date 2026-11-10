import { CreateOrderSchema, ListOrdersQuerySchema } from '@factorymustgrow/shared';
import type { Request, Response } from 'express';
import * as ordersService from '../services/orders.service.js';

export async function listOrders(req: Request, res: Response): Promise<void> {
  const query = ListOrdersQuerySchema.parse(req.query);

  res.json(await ordersService.listOrders(query));
}

export async function getOrder(req: Request<{ id: string }>, res: Response): Promise<void> {
  res.json(await ordersService.getOrder(req.params.id));
}

export async function createOrder(req: Request, res: Response): Promise<void> {
  const input = CreateOrderSchema.parse(req.body);
  const order = await ordersService.createOrder(input);

  res.status(201).location(`/api/orders/${order.id}`).json(order);
}
