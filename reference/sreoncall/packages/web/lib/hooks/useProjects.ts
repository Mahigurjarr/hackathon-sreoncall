'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export interface Project {
  id: string;
  name: string;
  key: string | null;
  color: string | null;
  description: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  visibility?: 'org' | 'private';
}

interface ProjectsResponse {
  data: Project[];
  pagination: { has_more: boolean; next_cursor: string | null; total: number };
}

export interface ProjectFilters {
  search?: string;
}

export interface CreateProjectInput {
  name: string;
  description?: string;
  visibility?: 'org' | 'private';
}

export function useProjects(filters: ProjectFilters = {}) {
  return useQuery<ProjectsResponse, APIError>({
    queryKey: ['projects', filters],
    queryFn: () =>
      api.get<ProjectsResponse>('/api/v1/projects', {
        search: filters.search,
        limit:  200,
      }),
  });
}

export function useProject(id: string) {
  return useQuery<Project, APIError>({
    queryKey: ['project', id],
    queryFn:  () => api.get<Project>(`/api/v1/projects/${id}`),
    enabled:  !!id,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation<Project, APIError, CreateProjectInput>({
    mutationFn: (input) => api.post<Project>('/api/v1/projects', input),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

export function useUpdateProject() {
  const qc = useQueryClient();
  return useMutation<Project, APIError, { id: string; input: Partial<CreateProjectInput> }>({
    mutationFn: ({ id, input }) => api.patch<Project>(`/api/v1/projects/${id}`, input),
    onSuccess:  (data) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['project', data.id] });
    },
  });
}

export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete(`/api/v1/projects/${id}`),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}

// Board Members & Invites

export interface BoardMember {
  _id: string;
  user_id: { _id: string; name: string; email: string } | string;
  role: 'admin' | 'member' | 'viewer';
  joined_at: string;
}

export interface BoardInvite {
  _id: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  created_at: string;
}

export function useBoardMembers(projectId: string) {
  return useQuery<{ data: BoardMember[] }, APIError>({
    queryKey: ['board-members', projectId],
    queryFn: () => api.get<{ data: BoardMember[] }>(`/api/v1/projects/${projectId}/members`),
    enabled: !!projectId,
  });
}

export function useBoardInvites(projectId: string) {
  return useQuery<{ data: BoardInvite[] }, APIError>({
    queryKey: ['board-invites', projectId],
    queryFn: () => api.get<{ data: BoardInvite[] }>(`/api/v1/projects/${projectId}/invites`),
    enabled: !!projectId,
  });
}

export function useInviteToBoard() {
  const qc = useQueryClient();
  return useMutation<BoardInvite, APIError, { projectId: string; email: string; role: string }>({
    mutationFn: ({ projectId, email, role }) =>
      api.post<BoardInvite>(`/api/v1/projects/${projectId}/invites`, { email, role }),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['board-invites', vars.projectId] }),
  });
}

export function useRevokeBoardInvite() {
  const qc = useQueryClient();
  return useMutation<void, APIError, { projectId: string; inviteId: string }>({
    mutationFn: ({ projectId, inviteId }) =>
      api.delete(`/api/v1/projects/${projectId}/invites/${inviteId}`),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['board-invites', vars.projectId] }),
  });
}

export function useRemoveBoardMember() {
  const qc = useQueryClient();
  return useMutation<void, APIError, { projectId: string; userId: string }>({
    mutationFn: ({ projectId, userId }) =>
      api.delete(`/api/v1/projects/${projectId}/members/${userId}`),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['board-members', vars.projectId] }),
  });
}

export function useUpdateBoardVisibility() {
  const qc = useQueryClient();
  return useMutation<Project, APIError, { projectId: string; visibility: 'org' | 'private' }>({
    mutationFn: ({ projectId, visibility }) =>
      api.patch<Project>(`/api/v1/projects/${projectId}/visibility`, { visibility }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  });
}
