'use client';

import { useQuery } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface ProviderVerification {
  provider: string;
  connection_name: string | null;
  connection_status: 'connected' | 'error' | 'pending' | 'missing';
  asset_count: number;
  healthy_asset_count: number;
  metrics_status: 'verified' | 'missing' | 'not_supported' | 'unknown';
  logs_status: 'verified' | 'missing' | 'not_supported' | 'unknown';
  alert_coverage_status: 'covered' | 'partial' | 'missing';
  evidence: {
    metric_series_count: number | null;
    log_entry_count: number | null;
    active_alert_rule_count: number;
    no_data_alert_rule_count: number;
  };
  notes: string[];
  gaps: string[];
}

export interface TenantObservabilityVerificationReport {
  generated_at: string;
  summary: {
    providers_detected: number;
    assets_total: number;
    connections_total: number;
    connected_connections: number;
    active_alert_rules: number;
    alert_rules_no_data: number;
    active_synthetic_checks: number;
  };
  tenant_checks: {
    metrics_available: boolean;
    logs_available: boolean;
    tenant_metric_series_count: number | null;
    tenant_log_entry_count: number | null;
  };
  providers: ProviderVerification[];
  global_gaps: string[];
}

export function useTenantObservabilityVerification() {
  return useQuery<TenantObservabilityVerificationReport, APIError>({
    queryKey: ['tenant-observability-verification'],
    queryFn: () => api.get<TenantObservabilityVerificationReport>('/api/v1/tenant-observability-verification'),
  });
}
