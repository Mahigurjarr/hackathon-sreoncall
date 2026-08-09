'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export type ServiceStatus = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance' | 'unknown';
export type ServiceType = 'web' | 'api' | 'database' | 'queue' | 'cache' | 'worker' | 'storage' | 'other';
export type ServiceClassification = 'app' | 'platform' | 'infrastructure' | 'monitoring' | 'system';

export interface Service {
  id: string;
  name: string;
  description: string;
  type: ServiceType;
  classification: ServiceClassification;
  auto_discovered: boolean;
  source_asset_id: string | null;
  project_id: string | null;
  escalation_policy_id: string | null;
  oncall_schedule_id: string | null;
  owner_id: string | null;
  current_status: ServiceStatus;
  enabled: boolean;
  tags: string[];
  cloud_metadata: {
    provider: string | null;
    resource_type: string | null;
    cloud_id: string | null;
    region: string | null;
    cluster: string | null;
    namespace: string | null;
  } | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

interface ServicesResponse {
  data: Service[];
  pagination: { has_more: boolean; next_cursor: string | null; total: number };
}

export interface ServiceFilters {
  search?: string;
  status?: string;
  type?: string;
  classification?: string;
  auto_discovered?: boolean;
  project_id?: string;
}

export interface CreateServiceInput {
  name: string;
  description?: string;
  type?: ServiceType;
  classification?: ServiceClassification;
  project_id: string;
  escalation_policy_id?: string | null;
  oncall_schedule_id?: string | null;
  owner_id?: string | null;
  enabled?: boolean;
  tags?: string[];
}

export function useServices(filters: ServiceFilters = {}) {
  return useQuery<ServicesResponse, APIError>({
    queryKey: ['services', filters],
    queryFn: () =>
      api.get<ServicesResponse>('/api/v1/services', {
        search:          filters.search,
        status:          filters.status,
        type:            filters.type,
        classification:  filters.classification,
        auto_discovered: filters.auto_discovered !== undefined ? String(filters.auto_discovered) : undefined,
        project_id:      filters.project_id,
        limit:           200,
      }),
  });
}

export function useService(id: string) {
  return useQuery<Service, APIError>({
    queryKey: ['service', id],
    queryFn:  () => api.get<Service>(`/api/v1/services/${id}`),
    enabled:  !!id,
  });
}

export function useCreateService() {
  const qc = useQueryClient();
  return useMutation<Service, APIError, CreateServiceInput>({
    mutationFn: (input) => api.post<Service>('/api/v1/services', input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useUpdateService() {
  const qc = useQueryClient();
  return useMutation<Service, APIError, { id: string; input: Partial<CreateServiceInput> & { classification?: ServiceClassification } }>({
    mutationFn: ({ id, input }) => api.patch<Service>(`/api/v1/services/${id}`, input),
    onSuccess:  (data) => {
      qc.invalidateQueries({ queryKey: ['services'] });
      qc.invalidateQueries({ queryKey: ['service', data.id] });
    },
  });
}

export function useDeleteService() {
  const qc = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/services/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}

export function useUpdateServiceStatus() {
  const qc = useQueryClient();
  return useMutation<Service, APIError, { id: string; status: ServiceStatus }>({
    mutationFn: ({ id, status }) => api.post<Service>(`/api/v1/services/${id}/status`, { status }),
    onSuccess:  (data) => {
      qc.invalidateQueries({ queryKey: ['services'] });
      qc.invalidateQueries({ queryKey: ['service', data.id] });
    },
  });
}

export function useBulkClassifyServices() {
  const qc = useQueryClient();
  return useMutation<{ updated: number }, APIError, { service_ids: string[]; classification: ServiceClassification }>({
    mutationFn: (input) => api.patch('/api/v1/services/bulk-classify', input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['services'] }),
  });
}
