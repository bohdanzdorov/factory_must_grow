import { Router } from 'express';
import { createOrder, getOrder, listOrders } from '../controllers/orders.controller.js';
import { listDecisions, routeOrder } from '../controllers/routing.controller.js';

export const ordersRouter = Router();

ordersRouter.get('/', listOrders);
ordersRouter.get('/:id', getOrder);
ordersRouter.post('/', createOrder);
ordersRouter.post('/:id/route', routeOrder);
ordersRouter.get('/:id/decisions', listDecisions);
