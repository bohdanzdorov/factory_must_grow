import { Router } from 'express';
import { listDecisions, routeOrder } from '../controllers/routing.controller.js';

// Routing an order and reading its decisions. Mounted at /api/orders next to the orders
// router, because these are actions on one order.
export const routingRouter = Router();

routingRouter.post('/:id/route', routeOrder);
routingRouter.get('/:id/decisions', listDecisions);
