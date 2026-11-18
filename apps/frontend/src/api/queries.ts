// Data for the screens, kept fresh by polling (the plan's choice over WebSockets).
// Actions refresh the affected data straight away instead of waiting for the next poll.
import type { OrderStatus } from '@factorymustgrow/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

const POLL_MS = 2000;

const keys = {
  orders: (status?: OrderStatus) => ['orders', { status }] as const,
  order: (id: string) => ['order', id] as const,
  decisions: (orderId: string) => ['decisions', orderId] as const,
  clock: ['clock'] as const,
};

export function useOrders(status?: OrderStatus) {
  return useQuery({
    queryKey: keys.orders(status),
    queryFn: () => api.listOrders(status),
    refetchInterval: POLL_MS,
  });
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: keys.order(id),
    queryFn: () => api.getOrder(id),
    refetchInterval: POLL_MS,
  });
}

export function useDecisions(orderId: string) {
  return useQuery({
    queryKey: keys.decisions(orderId),
    queryFn: () => api.listDecisions(orderId),
    refetchInterval: POLL_MS,
  });
}

export function useClock() {
  return useQuery({ queryKey: keys.clock, queryFn: api.getClock, refetchInterval: POLL_MS });
}

// After any action on an order, everything showing it reloads.
function useRefreshOrder(orderId: string) {
  const queryClient = useQueryClient();

  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['orders'] }),
      queryClient.invalidateQueries({ queryKey: keys.order(orderId) }),
      queryClient.invalidateQueries({ queryKey: keys.decisions(orderId) }),
    ]);
}

export function useRouteOrder(orderId: string) {
  const refresh = useRefreshOrder(orderId);

  return useMutation({ mutationFn: () => api.routeOrder(orderId), onSettled: refresh });
}

export function useApproveDecision(orderId: string) {
  const refresh = useRefreshOrder(orderId);

  return useMutation({
    mutationFn: (decisionId: string) => api.approveDecision(decisionId),
    onSettled: refresh,
  });
}

export function useRejectDecision(orderId: string) {
  const refresh = useRefreshOrder(orderId);

  return useMutation({
    mutationFn: ({ decisionId, reason }: { decisionId: string; reason: string }) =>
      api.rejectDecision(decisionId, reason),
    onSettled: refresh,
  });
}
