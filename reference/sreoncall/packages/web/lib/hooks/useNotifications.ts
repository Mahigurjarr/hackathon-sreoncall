'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface Notification {
  id: string;
  type: string;
  priority: 'info' | 'warning' | 'error' | 'critical';
  title: string;
  body: string;
  read: boolean;
  read_at: string | null;
  archived: boolean;
  resource_type: string | null;
  resource_id: string | null;
  created_at: string;
}

interface NotificationsResponse {
  data: Notification[];
  pagination: {
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more: boolean;
    limit: number;
    total?: number;
  };
}

interface UnreadCountResponse {
  count: number;
}

interface NotificationStats {
  unread: number;
  total: number;
  by_type: Record<string, number>;
}

// 1. Unread count (polled every 30s)
export function useUnreadCount() {
  return useQuery<UnreadCountResponse, APIError>({
    queryKey: ['notifications-unread-count'],
    queryFn: () => api.get<UnreadCountResponse>('/api/v1/notifications/unread-count'),
    refetchInterval: 30000,
  });
}

// 2. List notifications (basic)
export function useNotifications(limit = 20) {
  return useQuery<NotificationsResponse, APIError>({
    queryKey: ['notifications', limit],
    queryFn: () => api.get<NotificationsResponse>('/api/v1/notifications', { limit }),
  });
}

// 3. Mark single notification as read
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation<any, APIError, string>({
    mutationFn: (id) => api.patch(`/api/v1/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notification-stats'] });
    },
  });
}

// 4. Mark all notifications as read
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation<any, APIError, void>({
    mutationFn: () => api.post('/api/v1/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notification-stats'] });
    },
  });
}

// 5. Notification stats (unread count, total, breakdown by type)
export function useNotificationStats() {
  return useQuery<NotificationStats, APIError>({
    queryKey: ['notification-stats'],
    queryFn: () => api.get<NotificationStats>('/api/v1/notifications/stats'),
  });
}

// 6. Delete a single notification
export function useDeleteNotification() {
  const queryClient = useQueryClient();

  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/notifications/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notification-stats'] });
    },
  });
}

// 7. Notification preferences
export interface NotificationPreferences {
  email: boolean;
  in_app: boolean;
  ticket_assigned: boolean;
  ticket_updated: boolean;
  ticket_commented: boolean;
  mention: boolean;
  sla_breach: boolean;
  channels: {
    incident: boolean;
    ticket: boolean;
    oncall: boolean;
    system: boolean;
  };
  quiet_hours: {
    enabled: boolean;
    start: string;
    end: string;
    timezone: string;
  };
}

export function useNotificationPreferences() {
  return useQuery<NotificationPreferences, APIError>({
    queryKey: ['notification-preferences'],
    queryFn: () => api.get<NotificationPreferences>('/api/v1/notifications/preferences'),
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation<NotificationPreferences, APIError, Partial<NotificationPreferences>>({
    mutationFn: (prefs) => api.patch<NotificationPreferences>('/api/v1/notifications/preferences', prefs),
    onSuccess: (data) => {
      queryClient.setQueryData(['notification-preferences'], data);
    },
  });
}

export function useSendTestNotification() {
  const queryClient = useQueryClient();

  return useMutation<any, APIError, void>({
    mutationFn: () => api.post('/api/v1/notifications/test'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
      queryClient.invalidateQueries({ queryKey: ['notification-stats'] });
    },
  });
}

// 8. Filtered notifications (by read status, type, with limit)
export function useFilteredNotifications(
  filters: { read?: boolean; type?: string; limit?: number } = {}
) {
  const { read, type, limit = 20 } = filters;
  return useQuery<NotificationsResponse, APIError>({
    queryKey: ['notifications', { read, type, limit }],
    queryFn: () =>
      api.get<NotificationsResponse>('/api/v1/notifications', {
        limit,
        ...(read !== undefined ? { read: String(read) } : {}),
        ...(type ? { type } : {}),
      }),
  });
}
