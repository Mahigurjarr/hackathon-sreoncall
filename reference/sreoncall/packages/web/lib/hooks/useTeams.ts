'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface TeamMember {
  _id: string;
  name: string;
  email: string;
}

export interface Team {
  _id: string;
  /** Alias for _id, returned by the API for consistency with other resources. */
  id?: string;
  name: string;
  description?: string;
  members: TeamMember[];
  team_lead: TeamMember | null;
  manager: TeamMember | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTeamInput {
  name: string;
  description?: string;
  members?: string[];
  team_lead?: string | null;
  manager?: string | null;
}

export type UpdateTeamInput = Partial<CreateTeamInput>;

interface TeamsResponse {
  data: Team[];
  pagination: { total?: number };
}

interface MemberConflict {
  user_id: string;
  user_name: string;
  team_id: string;
  team_name: string;
}

interface ConflictsResponse {
  conflicts: MemberConflict[];
}

export function useTeams() {
  return useQuery<Team[], APIError>({
    queryKey: ['teams'],
    queryFn: async () => {
      const res = await api.get<TeamsResponse | Team[]>('/api/v1/teams');
      return Array.isArray(res) ? res : res.data;
    },
  });
}

export function useCreateTeam() {
  const queryClient = useQueryClient();
  return useMutation<Team, APIError, CreateTeamInput>({
    mutationFn: (input) => api.post<Team>('/api/v1/teams', input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

export function useUpdateTeam() {
  const queryClient = useQueryClient();
  return useMutation<Team, APIError, { id: string; input: UpdateTeamInput }>({
    mutationFn: ({ id, input }) => api.patch<Team>(`/api/v1/teams/${id}`, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

export function useDeleteTeam() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete<void>(`/api/v1/teams/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
  });
}

export function useCheckMemberConflicts(userIds: string[], excludeTeamId?: string) {
  return useQuery<MemberConflict[], APIError>({
    queryKey: ['team-member-conflicts', userIds, excludeTeamId],
    queryFn: async () => {
      if (userIds.length === 0) return [];
      const params: Record<string, string> = { user_ids: userIds.join(',') };
      if (excludeTeamId) params['exclude_team_id'] = excludeTeamId;
      const res = await api.get<ConflictsResponse>('/api/v1/teams/check-conflicts', params);
      return res.conflicts;
    },
    enabled: userIds.length > 0,
  });
}
