'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export type RuleType = 'json_parse' | 'regex_extract' | 'label_set' | 'line_filter' | 'drop' | 'redact';

export interface LogPipelineRule {
  id: string;
  name: string;
  order: number;
  enabled: boolean;
  type: RuleType;
  config: Record<string, any>;
}

export interface CreateRuleInput {
  name: string;
  type: RuleType;
  enabled?: boolean;
  config?: Record<string, any>;
}

export interface UpdateRuleInput {
  name?: string;
  type?: RuleType;
  enabled?: boolean;
  config?: Record<string, any>;
}

const KEYS = {
  all: ['log-pipelines'] as const,
  config: ['log-pipelines', 'config'] as const,
};

export function useLogPipeline() {
  return useQuery<{ data: LogPipelineRule[] }>({
    queryKey: KEYS.all,
    queryFn: () => api.get('/api/v1/log-pipelines'),
  });
}

export function useAddRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRuleInput) => api.post('/api/v1/log-pipelines/rules', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.config });
    },
  });
}

export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ruleId, ...input }: UpdateRuleInput & { ruleId: string }) =>
      api.patch(`/api/v1/log-pipelines/rules/${ruleId}`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.config });
    },
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ruleId: string) => api.delete(`/api/v1/log-pipelines/rules/${ruleId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.config });
    },
  });
}

export function useReorderRules() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ruleIds: string[]) => api.post('/api/v1/log-pipelines/reorder', { ruleIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEYS.all });
      qc.invalidateQueries({ queryKey: KEYS.config });
    },
  });
}

export function useGenerateConfig() {
  return useQuery<{ data: string }>({
    queryKey: KEYS.config,
    queryFn: () => api.get('/api/v1/log-pipelines/config'),
  });
}

export function usePreviewPipeline() {
  return useMutation<{ data: { input: string[]; output: string[] } }, Error, string[]>({
    mutationFn: (sampleLines: string[]) =>
      api.post('/api/v1/log-pipelines/preview', { sampleLines }),
  });
}
