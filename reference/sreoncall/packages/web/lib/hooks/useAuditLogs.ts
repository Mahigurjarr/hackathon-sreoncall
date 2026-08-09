'use client';

import { useQuery } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actor: { id: string; email: string; name?: string; ip?: string };
  action: string;
  resource_type: string;
  resource_id?: string;
  changes?: Array<{ field: string; old_value: any; new_value: any }>;
  result: 'success' | 'failure';
  request_id?: string;
}

interface AuditLogFilters {
  resource_type?: string;
  action?: string;
  actor_id?: string;
  from_date?: string;
  to_date?: string;
  limit?: number;
  cursor?: string;
}

interface AuditLogResponse {
  data: AuditLogEntry[];
  pagination: {
    next_cursor: string | null;
    has_more: boolean;
    limit: number;
    total?: number;
  };
}

export function useAuditLogs(filters: AuditLogFilters = {}) {
  return useQuery<AuditLogResponse, APIError>({
    queryKey: ['audit-logs', filters],
    queryFn: () =>
      api.get<AuditLogResponse>('/api/v1/audit-logs', {
        resource_type: filters.resource_type,
        action: filters.action,
        actor_id: filters.actor_id,
        from_date: filters.from_date,
        to_date: filters.to_date,
        limit: filters.limit ?? 50,
        cursor: filters.cursor,
      }),
  });
}
