'use client';

import { useQuery, useMutation } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface IncidentAnalyticsParams {
  from: string;
  to: string;
}

interface MetricSummary {
  mean: number | null;
  median: number | null;
  p95: number | null;
}

export interface IncidentAnalyticsReport {
  range: { from: string; to: string };
  summary: {
    total_incidents: number;
    resolved_incidents: number;
    open_incidents: number;
    mtta_seconds: MetricSummary;
    mttr_seconds: MetricSummary;
  };
  by_classification: Array<{
    classification: string;
    count: number;
    resolved: number;
    mtta_mean_seconds: number | null;
    mttr_mean_seconds: number | null;
  }>;
  by_severity: Array<{
    severity: number;
    count: number;
    mtta_mean_seconds: number | null;
    mttr_mean_seconds: number | null;
  }>;
  by_service: Array<{
    service_id: string | null;
    service_name: string;
    classification: string;
    count: number;
    mtta_mean_seconds: number | null;
    mttr_mean_seconds: number | null;
  }>;
}

export function useIncidentAnalytics(params: IncidentAnalyticsParams | null) {
  return useQuery<IncidentAnalyticsReport, APIError>({
    queryKey: ['incident-analytics', params],
    queryFn: () => api.get<IncidentAnalyticsReport>('/api/v1/reports/incidents', params as Record<string, any>),
    enabled: !!params?.from && !!params?.to,
  });
}

export function useExportIncidentAnalytics() {
  return useMutation<void, APIError, IncidentAnalyticsParams & { format: 'csv' | 'pdf' }>({
    mutationFn: async (params) => {
      const search = new URLSearchParams();
      search.set('format', params.format);
      search.set('from', params.from);
      search.set('to', params.to);

      const sessionRes = await fetch('/api/auth/session');
      const session = await sessionRes.json();
      const token = session?.accessToken;
      const tenantSlug = session?.tenantSlug || 'platform';

      const headers: Record<string, string> = { 'X-Tenant-Slug': tenantSlug };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(`/api/v1/reports/incidents/export?${search}`, { headers });
      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `incident-analytics.${params.format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  });
}
