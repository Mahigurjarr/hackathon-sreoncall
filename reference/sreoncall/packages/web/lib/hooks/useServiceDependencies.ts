'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type DependencyStatus = 'proposed' | 'approved' | 'rejected' | 'archived';
export type DependencyType = 'http' | 'grpc' | 'tcp' | 'database' | 'queue' | 'cache' | 'dns' | 'file' | 'custom';

export interface ServiceDependency {
  id: string;
  source_service_id: string;
  source_service_name: string | null;
  target_service_id: string;
  target_service_name: string | null;
  dependency_type: DependencyType;
  protocol_details: Record<string, unknown>;
  criticality: string;
  discovery_method: string;
  status: DependencyStatus;
  traffic_metadata: {
    avg_requests_per_minute: number | null;
    avg_latency_ms: number | null;
    error_rate_percent: number | null;
  };
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceTopologyMap {
  nodes: { id: string; name: string; type: string; current_status: string }[];
  edges: {
    id: string;
    source_service_id: string;
    target_service_id: string;
    dependency_type: DependencyType;
    criticality: string;
    traffic_metadata: { avg_requests_per_minute: number | null; avg_latency_ms: number | null; error_rate_percent: number | null } | null;
  }[];
}

export interface ServiceDependencyFilters {
  source_service_id?: string;
  target_service_id?: string;
  status?: DependencyStatus;
  type?: DependencyType;
  search?: string;
}

interface ServiceDependenciesResponse {
  data: ServiceDependency[];
  pagination: { total?: number; has_more?: boolean };
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useServiceDependencies(filters: ServiceDependencyFilters = {}) {
  return useQuery<ServiceDependency[], APIError>({
    queryKey: ['service-dependencies', filters],
    queryFn: async () => {
      const res = await api.get<ServiceDependenciesResponse>('/api/v1/service-dependencies', {
        source_service_id: filters.source_service_id,
        target_service_id: filters.target_service_id,
        status: filters.status,
        type: filters.type,
        search: filters.search,
      });
      return res.data;
    },
  });
}

export function useServiceTopology() {
  return useQuery<ServiceTopologyMap, APIError>({
    queryKey: ['service-topology'],
    queryFn: () => api.get<ServiceTopologyMap>('/api/v1/service-dependencies/map'),
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useApproveDependency() {
  const queryClient = useQueryClient();
  return useMutation<ServiceDependency, APIError, string>({
    mutationFn: (id) =>
      api.post<ServiceDependency>(`/api/v1/service-dependencies/${id}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-dependencies'] });
      queryClient.invalidateQueries({ queryKey: ['service-topology'] });
    },
  });
}

export function useRejectDependency() {
  const queryClient = useQueryClient();
  return useMutation<ServiceDependency, APIError, string>({
    mutationFn: (id) =>
      api.post<ServiceDependency>(`/api/v1/service-dependencies/${id}/reject`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-dependencies'] });
      queryClient.invalidateQueries({ queryKey: ['service-topology'] });
    },
  });
}

export function useDeleteDependency() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete<void>(`/api/v1/service-dependencies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-dependencies'] });
      queryClient.invalidateQueries({ queryKey: ['service-topology'] });
    },
  });
}

export interface BulkApproveResult {
  modified: number;
  skipped_cycle: string[];
}

export function useBulkApproveDependencies() {
  const queryClient = useQueryClient();
  return useMutation<BulkApproveResult, APIError, { ids: string[] }>({
    mutationFn: (body) =>
      api.post<BulkApproveResult>('/api/v1/service-dependencies/bulk-approve', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-dependencies'] });
      queryClient.invalidateQueries({ queryKey: ['service-topology'] });
    },
  });
}

export interface CreateDependencyInput {
  source_service_id: string;
  target_service_id: string;
  dependency_type: DependencyType;
  criticality?: string;
  protocol_details?: Record<string, unknown>;
  notes?: string;
}

export function useCreateDependency() {
  const queryClient = useQueryClient();
  return useMutation<ServiceDependency, APIError, CreateDependencyInput>({
    mutationFn: (input) =>
      api.post<ServiceDependency>('/api/v1/service-dependencies', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['service-dependencies'] });
      queryClient.invalidateQueries({ queryKey: ['service-topology'] });
    },
  });
}
