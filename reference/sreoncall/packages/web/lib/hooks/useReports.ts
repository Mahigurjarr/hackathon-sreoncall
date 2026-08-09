'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface WorkLogReportParams {
  from: string;
  to: string;
  entity_type?: 'ticket' | 'incident' | 'all';
  project_id?: string;
  milestone_id?: string;
  team_id?: string;
  user_id?: string;
  source?: 'internal' | 'provider' | 'all';
  group_by?: 'project' | 'ticket' | 'user' | 'team' | 'source' | 'entity_type';
  billable_only?: boolean;
  approved_only?: boolean;
  consumer_name?: string;
}

export interface WorkLogReportGroup {
  _id: string;
  label: string;
  total_minutes: number;
  entry_count: number;
  entries?: WorkLogReportEntry[];
}

export interface WorkLogReportEntry {
  id: string;
  user_name: string;
  entity_type: string;
  entity_number: number | null;
  entity_title: string;
  project_name: string | null;
  duration_minutes: number;
  description: string;
  source: string;
  billable: boolean;
  logged_at: string;
}

export interface WorkLogReportSummary {
  grand_total_minutes: number;
  internal_minutes: number;
  provider_minutes: number;
  billable_minutes: number;
  ticket_minutes: number;
  incident_minutes: number;
  groups: WorkLogReportGroup[];
}

export function useWorkLogReport(params: WorkLogReportParams | null) {
  return useQuery<WorkLogReportSummary, APIError>({
    queryKey: ['work-log-report', params],
    queryFn: () => api.get<WorkLogReportSummary>('/api/v1/reports/work-logs', params as Record<string, any>),
    enabled: !!params?.from && !!params?.to,
  });
}

export function useGenerateAISummaryPDF() {
  return useMutation<void, APIError, WorkLogReportParams>({
    mutationFn: async (params) => {
      const searchParams = new URLSearchParams();
      Object.entries(params).forEach(([key, val]) => {
        if (val != null && val !== '') searchParams.set(key, String(val));
      });

      const sessionRes = await fetch('/api/auth/session');
      const session = await sessionRes.json();
      const token = session?.accessToken;
      const tenantSlug = session?.tenantSlug || 'platform';

      const headers: Record<string, string> = { 'X-Tenant-Slug': tenantSlug };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/reports/ai-summary?${searchParams}`, { headers });
      if (!res.ok) throw new Error('AI summary generation failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const from = params.from ?? 'report';
      const to = params.to ?? 'report';
      a.download = `sre-summary-${from}-to-${to}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });
}

export function useExportWorkLogReport() {
  return useMutation<void, APIError, WorkLogReportParams & { format: 'csv' | 'pdf' }>({
    mutationFn: async (params) => {
      const { format, ...rest } = params;
      // Build query string
      const searchParams = new URLSearchParams();
      searchParams.set('format', format);
      Object.entries(rest).forEach(([key, val]) => {
        if (val != null && val !== '') searchParams.set(key, String(val));
      });

      // Get session for auth
      const sessionRes = await fetch('/api/auth/session');
      const session = await sessionRes.json();
      const token = session?.accessToken;
      const tenantSlug = session?.tenantSlug || 'platform';

      const headers: Record<string, string> = { 'X-Tenant-Slug': tenantSlug };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/reports/work-logs/export?${searchParams}`, { headers });
      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `work-log-report.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });
}
