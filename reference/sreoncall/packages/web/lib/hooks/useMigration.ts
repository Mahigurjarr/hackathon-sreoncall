'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type Provider = 'grafana' | 'datadog' | 'newrelic' | 'groundcover';

export interface MigrationCredentials {
  provider: Provider;
  apiKey: string;
  appKey?: string;
  endpoint?: string;
}

export interface ConnectionResult {
  connected: boolean;
  dashboards: number;
  alerts: number;
}

export interface MigrationResource {
  id: string;
  title: string;
  type: 'dashboard' | 'alert';
  panelCount?: number;
  lastModified?: string;
}

export interface ImportResult {
  imported: number;
  warnings: string[];
  results: Array<{ id: string; type: string; status: string; name: string; warnings: string[] }>;
}

export function useTestConnection() {
  return useMutation<ConnectionResult, Error, MigrationCredentials>({
    mutationFn: async (creds) => {
      return api.post<ConnectionResult>('/api/v1/migrations/connect', creds);
    },
  });
}

export function useFetchDashboards(provider: Provider, apiKey: string, endpoint?: string, appKey?: string) {
  return useQuery<MigrationResource[]>({
    queryKey: ['migration-dashboards', provider, apiKey, endpoint, appKey],
    queryFn: async () => {
      const res = await api.get<{ data: MigrationResource[] }>('/api/v1/migrations/dashboards', {
        provider,
        apiKey,
        endpoint: endpoint || undefined,
        appKey: appKey || undefined,
      });
      return res.data ?? [];
    },
    enabled: !!apiKey,
  });
}

export function useFetchAlerts(provider: Provider, apiKey: string, endpoint?: string, appKey?: string) {
  return useQuery<MigrationResource[]>({
    queryKey: ['migration-alerts', provider, apiKey, endpoint, appKey],
    queryFn: async () => {
      const res = await api.get<{ data: MigrationResource[] }>('/api/v1/migrations/alerts', {
        provider,
        apiKey,
        endpoint: endpoint || undefined,
        appKey: appKey || undefined,
      });
      return res.data ?? [];
    },
    enabled: !!apiKey,
  });
}

export function useImportResources() {
  return useMutation<
    ImportResult,
    Error,
    { provider: Provider; credentials: MigrationCredentials; resources: Array<{ type: string; id: string }> }
  >({
    mutationFn: async (data) => {
      const raw = await api.post<any>('/api/v1/migrations/import', {
        ...data.credentials,
        resources: data.resources,
      });

      const results = (raw.results ?? []).map((r: any) => ({
        id: r.resourceId ?? r.id ?? '',
        type: r.type ?? '',
        status: r.status ?? 'error',
        name: r.name ?? '',
        warnings: r.warnings ?? [],
      }));

      const allWarnings = results.flatMap((r: any) => r.warnings);

      return {
        imported: raw.summary?.success ?? results.filter((r: any) => r.status === 'success').length,
        warnings: allWarnings,
        results,
      };
    },
  });
}
