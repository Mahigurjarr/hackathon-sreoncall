'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export type AssetProvider = 'aws' | 'gcp' | 'azure' | 'self_managed';
export type AssetCategory = 'compute' | 'kubernetes' | 'container' | 'serverless' | 'database' | 'networking' | 'queue' | 'cache' | 'storage' | 'app_platform';
export type AssetStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown' | 'terminated';

export interface Asset {
  id: string;
  name: string;
  provider: AssetProvider;
  category: AssetCategory;
  resource_type: string;
  region: string;
  cloud_id: string;
  cloud_account_id: string;
  metadata: Record<string, unknown>;
  parent_asset_id: string | null;
  k8s_namespace: string | null;
  k8s_kind: string | null;
  k8s_replicas_desired: number | null;
  k8s_replicas_ready: number | null;
  k8s_pod_issues: string[];
  status: AssetStatus;
  status_reason: string | null;
  last_seen_at: string;
  service_id: string | null;
  connection_id: string | null;
  is_aggregate: boolean;
  aggregate_count: number | null;
  created_at: string;
  updated_at: string;
}

interface AssetsResponse {
  data: Asset[];
  pagination: { has_more: boolean; next_cursor: string | null; total: number };
}

export interface AssetsSummary {
  total: number;
  healthy: number;
  by_provider: Record<string, Record<string, Record<string, number>>>;
  provider_counts: Record<string, number>;
}

interface AssetTreeResponse {
  cluster: Asset;
  children: Asset[];
}

export interface AssetFilters {
  provider?: string;
  category?: string;
  status?: string;
  parent_id?: string;
  connection_id?: string;
  resource_type?: string;
  tree?: boolean;
}

const KEYS = {
  all: ['assets'] as const,
  list: (filters: AssetFilters) => ['assets', 'list', filters] as const,
  summary: ['assets', 'summary'] as const,
  detail: (id: string) => ['assets', id] as const,
  tree: (id: string) => ['assets', 'tree', id] as const,
};

export function useAssets(filters: AssetFilters = {}) {
  return useQuery<AssetsResponse, APIError>({
    queryKey: KEYS.list(filters),
    queryFn: () =>
      api.get<AssetsResponse>('/api/v1/assets', {
        provider:      filters.provider,
        category:      filters.category,
        status:        filters.status,
        parent_id:     filters.parent_id,
        connection_id: filters.connection_id,
        resource_type: filters.resource_type,
        tree:          filters.tree ? 'true' : undefined,
        limit:         500,
      }),
  });
}

export function useAssetsSummary() {
  return useQuery<AssetsSummary, APIError>({
    queryKey: KEYS.summary,
    queryFn: () => api.get<AssetsSummary>('/api/v1/assets/summary'),
  });
}

export function useAssetById(id: string) {
  return useQuery<Asset, APIError>({
    queryKey: KEYS.detail(id),
    queryFn: () => api.get<Asset>(`/api/v1/assets/${id}`),
    enabled: !!id,
  });
}

export function useAssetTree(clusterId: string) {
  return useQuery<AssetTreeResponse, APIError>({
    queryKey: KEYS.tree(clusterId),
    queryFn: () => api.get<AssetTreeResponse>(`/api/v1/assets/${clusterId}/tree`),
    enabled: !!clusterId,
  });
}

export function useLinkAsset() {
  const qc = useQueryClient();
  return useMutation<Asset, APIError, { assetId: string; serviceId: string }>({
    mutationFn: ({ assetId, serviceId }) =>
      api.post<Asset>(`/api/v1/assets/${assetId}/link`, { service_id: serviceId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: ['services'] });
    },
  });
}

export function useUnlinkAsset() {
  const qc = useQueryClient();
  return useMutation<Asset, APIError, string>({
    mutationFn: (assetId) => api.delete<Asset>(`/api/v1/assets/${assetId}/link`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: ['services'] });
    },
  });
}
