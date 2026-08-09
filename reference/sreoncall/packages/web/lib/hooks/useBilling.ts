'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BillingPlanLimits {
  max_users: number;
  min_users: number;
  max_tickets_per_month: number;
  max_storage_gb: number;
  api_rate_limit: number;
  custom_fields: boolean;
  sla_management: boolean;
  custom_workflows: boolean;
  audit_log_retention_days: number;
  agents_enabled: boolean;
  max_agents: number;
  // New limits
  max_incidents_per_month: number;
  max_on_call_schedules: number;
  max_escalation_policies: number;
  max_notifications_per_day: number;
  observability_retention_days: number;
  max_synthetic_checks: number;
  max_status_pages: number;
  sso_enabled: boolean;
  scim_enabled: boolean;
  voice_whatsapp_enabled: boolean;
  white_label_enabled: boolean;
  notification_channels: string[];
}

export interface BillingPlan {
  id: string;
  name: string;
  description: string;
  price_monthly_cents: number;
  price_yearly_cents: number;
  features: string[];
  limits: BillingPlanLimits;
  is_popular: boolean;
  sort_order: number;
}

export interface Subscription {
  id?: string;
  plan: string;
  status: string;
  current_period_start?: string;
  current_period_end?: string;
  cancel_at_period_end?: boolean;
  seat_quantity?: number;
  monthly_amount_cents?: number;
  stripe_configured: boolean;
}

export interface Invoice {
  id: string;
  number: string;
  status: 'draft' | 'open' | 'paid' | 'void' | 'uncollectible';
  amount_cents: number;
  currency: string;
  period_start: string;
  period_end: string;
  pdf_url?: string;
  hosted_invoice_url?: string;
  created_at: string;
}

export interface InvoicesResponse {
  data: Invoice[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface UsageData {
  period: string;
  users: number;
  tickets: number;
  incidents: number;
  storage_bytes: number;
  api_calls: number;
  agent_executions: number;
  notifications_sent: number;
  on_call_schedules: number;
  escalation_policies: number;
  synthetic_checks: number;
  status_pages: number;
  agents: number;
  // v2 dimensions
  services: number;
  sms_sent: number;
  voice_calls: number;
  whatsapp_sent: number;
  ai_tokens_used: number;
  dashboards: number;
  alert_rules: number;
  slos: number;
  traces_ingested: number;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export function useBillingPlans() {
  return useQuery<{ data: BillingPlan[] }, APIError>({
    queryKey: ['billing-plans'],
    queryFn: () => api.get<{ data: BillingPlan[] }>('/api/v1/billing/plans'),
    staleTime: 60_000,
  });
}

export function useSubscription() {
  return useQuery<Subscription, APIError>({
    queryKey: ['billing-subscription'],
    queryFn: () => api.get<Subscription>('/api/v1/billing/subscription'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useUsage() {
  return useQuery<UsageData, APIError>({
    queryKey: ['billing-usage'],
    queryFn: () => api.get<UsageData>('/api/v1/billing/usage'),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

export function useInvoices(page = 1, limit = 10) {
  return useQuery<InvoicesResponse, APIError>({
    queryKey: ['billing-invoices', page, limit],
    queryFn: () => api.get<InvoicesResponse>('/api/v1/billing/invoices', { page, limit }),
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────────

export function useCreateCheckout() {
  return useMutation<{ url: string; session_id: string }, APIError, { plan: string }>({
    mutationFn: (body) => api.post('/api/v1/billing/checkout', body),
  });
}

export function useCreatePortalSession() {
  return useMutation<{ url: string }, APIError, void>({
    mutationFn: () => api.post('/api/v1/billing/portal'),
  });
}

export function useChangePlan() {
  const queryClient = useQueryClient();
  return useMutation<any, APIError, { plan: string }>({
    mutationFn: (body) => api.patch('/api/v1/billing/subscription/plan', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-subscription'] });
      queryClient.invalidateQueries({ queryKey: ['billing-usage'] });
      queryClient.invalidateQueries({ queryKey: ['tenant-current'] });
    },
  });
}

export function useCancelSubscription() {
  const queryClient = useQueryClient();
  return useMutation<any, APIError, void>({
    mutationFn: () => api.post('/api/v1/billing/subscription/cancel'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-subscription'] });
    },
  });
}

export function useReactivateSubscription() {
  const queryClient = useQueryClient();
  return useMutation<any, APIError, void>({
    mutationFn: () => api.post('/api/v1/billing/subscription/reactivate'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['billing-subscription'] });
    },
  });
}
