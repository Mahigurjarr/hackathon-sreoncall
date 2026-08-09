'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export type CalendarPlatform = 'google' | 'microsoft';

export interface CalendarConnection {
  id: string;
  platform: CalendarPlatform;
  email: string;
  status: 'connected' | 'disconnected' | 'error';
  created_at: string;
}

export interface CalendarConnectionsResponse {
  data: CalendarConnection[];
  providers: { google: boolean; microsoft: boolean };
}

export function useCalendarConnections() {
  return useQuery<CalendarConnectionsResponse, APIError>({
    queryKey: ['calendar-connections'],
    queryFn: () => api.get<CalendarConnectionsResponse>('/api/v1/calendar/connections'),
  });
}

export function useDisconnectCalendar() {
  const qc = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete<void>(`/api/v1/calendar/connections/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['calendar-connections'] }),
  });
}

/**
 * Kick off the provider OAuth from the browser — mirrors the Slack connect flow:
 * pass the current session token + tenant + origin to the public start route,
 * which redirects to the provider consent screen.
 */
export async function startCalendarConnect(platform: CalendarPlatform): Promise<void> {
  const res = await fetch('/api/auth/session');
  const session = await res.json();
  const tenantId = session?.user?.tenantId;
  const token = session?.accessToken;
  if (!tenantId || !token) throw new Error('Unable to retrieve session. Please sign in again.');
  window.location.href =
    `/api/v1/oauth/calendar/${platform}/start` +
    `?tenant_id=${encodeURIComponent(tenantId)}` +
    `&token=${encodeURIComponent(token)}` +
    `&origin=${encodeURIComponent(window.location.host)}`;
}
