import { Router } from 'express';
import { createOrder, getOrder, listOrders } from '../controllers/orders.controller.js';

export const ordersRouter = Router();

ordersRouter.get('/', listOrders);
ordersRouter.get('/:id', getOrder);
ordersRouter.post('/', createOrder);
