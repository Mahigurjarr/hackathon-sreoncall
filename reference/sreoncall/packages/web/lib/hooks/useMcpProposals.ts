'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export type McpProposalStatus = 'pending' | 'approved' | 'rejected' | 'applied' | 'apply_failed';

export interface McpProposalItem {
  id: string;
  tool_name: string;
  target_type: 'ticket' | 'change_request';
  summary: string;
  payload: Record<string, unknown>;
  status: McpProposalStatus;
  applied_entity_id: string | null;
  apply_error: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  createdAt: string;
}

interface McpProposalsResponse {
  data: McpProposalItem[];
}

export function useMcpProposals(status?: McpProposalStatus) {
  return useQuery<McpProposalsResponse, APIError>({
    queryKey: ['mcp-proposals', status ?? 'all'],
    queryFn: () => api.get<McpProposalsResponse>(`/api/v1/mcp-proposals${status ? `?status=${status}` : ''}`),
  });
}

export function useApproveMcpProposal() {
  const queryClient = useQueryClient();
  return useMutation<McpProposalItem, APIError, string>({
    mutationFn: (id) => api.post<McpProposalItem>(`/api/v1/mcp-proposals/${id}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-proposals'] });
    },
  });
}

export function useRejectMcpProposal() {
  const queryClient = useQueryClient();
  return useMutation<McpProposalItem, APIError, string>({
    mutationFn: (id) => api.post<McpProposalItem>(`/api/v1/mcp-proposals/${id}/reject`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-proposals'] });
    },
  });
}
