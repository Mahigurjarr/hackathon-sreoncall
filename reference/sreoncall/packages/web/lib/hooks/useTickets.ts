'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

// -- Types --

export type TicketPriority = 'high' | 'medium' | 'low';
export type TicketType = 'epic' | 'user_story' | 'task' | 'bug';

export type LinkType = 'related' | 'blocks' | 'blocked_by' | 'parent' | 'child';

export interface WorkflowState {
  name: string;
  label: string;
  category: 'todo' | 'in_progress' | 'done';
  color: string;
  is_initial: boolean;
  is_terminal: boolean;
}

export interface WorkflowTransition {
  from: string;
  to: string;
  allowed_roles: string[];
  requires_comment: boolean;
}

export interface TicketWorkflow {
  id: string;
  ticket_type: string;
  states: WorkflowState[];
  transitions: WorkflowTransition[];
}

export interface WorkLog {
  id: string;
  user: TicketUser | null;
  minutes: number;
  description: string;
  logged_at: string;
  created_at: string;
  status?: 'pending' | 'approved' | 'rejected';
  approved_by?: string | null;
  approved_at?: string | null;
  rejection_reason?: string | null;
  source?: 'internal' | 'provider';
  source_user_name?: string | null;
  billable?: boolean;
}

export interface WorkLogEntry {
  id: string;
  entity_type: string;
  entity_id: string;
  user: TicketUser | null;
  duration_minutes: number;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  logged_at: string;
  created_at: string;
  source?: 'internal' | 'provider';
  source_user_name?: string;
  ticket?: {
    id: string;
    number: number;
    title: string;
    status: string;
    priority: string;
    type: string;
  };
}

export interface TicketSla {
  config_id: string | null;
  response_deadline: string | null;
  resolution_deadline: string | null;
  response_met: boolean | null;
  resolution_met: boolean | null;
  first_response_at: string | null;
  paused_at: string | null;
  paused_duration_ms: number;
}

export interface LinkedTicketRef {
  id: string;
  number: number;
  key: string;
  title: string;
  status: string;
  priority: TicketPriority;
  type: TicketType;
}

export interface Ticket {
  id: string;
  project_id: string | null;
  project_name?: string | null;
  project_key?: string | null;
  project_color?: string | null;
  milestone_id?: string | null;
  sprint_id?: string | null;
  is_backlog?: boolean;
  watcher_ids: string[];
  number: number;
  type: TicketType;
  title: string;
  description: string;
  status: string;
  priority: TicketPriority;
  assignee_id: string | null;
  assignee: TicketUser | null;
  team_id: string | null;
  team: TicketTeam | null;
  reporter_id: string;
  reporter: TicketUser;
  labels: string[];
  related_ids: string[];
  blocks_ids: string[];
  blocked_by_ids: string[];
  linked_incident_ids: string[];
  linked_change_request_ids: string[];
  linked_tickets?: Record<string, LinkedTicketRef>;
  parent_id: string | null;
  time_estimate_raw: string | null;
  time_estimate_minutes: number | null;
  time_spent_minutes: number;
  custom_fields: Record<string, any>;
  tenant_name?: string | null;
  provider_ticket_id?: string | null;
  work_logs: WorkLog[];
  sla: TicketSla | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  comments: TicketComment[];
  activity: TicketActivity[];
}

export interface TicketUser {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

export interface TicketTeam {
  id: string;
  name: string;
}

export interface CommentAttachment {
  file_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  url: string;
}

export interface CommentReaction {
  emoji: string;
  count: number;
  user_ids: string[];
}

export interface TicketComment {
  id: string;
  body: string;
  author: TicketUser;
  is_internal: boolean;
  attachments?: CommentAttachment[];
  reactions?: CommentReaction[];
  created_at: string;
  updated_at: string;
  edited_at?: string | null;
}

export interface TicketActivity {
  id: string;
  action: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  actor: TicketUser;
  created_at: string;
}

export interface TicketFilters {
  project_id?: string;
  milestone_id?: string;
  sprint_id?: string;
  status?: string;
  priority?: TicketPriority;
  assignee_id?: string;
  reporter_id?: string;
  team_id?: string;
  search?: string;
  consumer_name?: string;
  page?: number;
  page_size?: number;
}

export interface BoardColumn {
  status: string;
  label: string;
  tickets: Ticket[];
}

export interface TicketBoard {
  columns: BoardColumn[];
}

export interface CreateTicketInput {
  project_id: string;
  milestone_id?: string;
  type: TicketType;
  title: string;
  description: string;
  priority: TicketPriority;
  assignee_id?: string | null;
  team_id?: string | null;
  labels?: string[];
  parent_id?: string;
  time_estimate?: string;
  time_estimate_minutes?: number | null;
}

export interface UpdateTicketInput {
  title?: string;
  description?: string;
  status?: string;
  priority?: TicketPriority;
  assignee_id?: string | null;
  team_id?: string | null;
  reporter_id?: string;
  milestone_id?: string | null;
  sprint_id?: string | null;
  is_backlog?: boolean;
  sprint?: { id: string; name: string; status: string } | null;
  labels?: string[];
  watcher_ids?: string[];
  time_estimate?: string;
  time_estimate_minutes?: number | null;
  created_at?: string;
}

// Backend returns cursor-based pagination
interface BackendTicketResponse {
  data: Ticket[];
  pagination: {
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more: boolean;
    limit: number;
    total?: number;
  };
}

// What our hooks expose (simplified for UI)
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// -- Hooks --

export function useTickets(filters: TicketFilters = {}) {
  return useQuery<PaginatedResponse<Ticket>, APIError>({
    queryKey: ['tickets', filters],
    queryFn: async () => {
      const result = await api.get<BackendTicketResponse>('/api/v1/tickets', {
        project_id: filters.project_id,
        milestone_id: filters.milestone_id,
        status: filters.status,
        priority: filters.priority,
        assignee_id: filters.assignee_id,
        reporter_id: filters.reporter_id,
        team_id: filters.team_id,
        search: filters.search,
        consumer_name: filters.consumer_name,
        limit: filters.page_size ?? 50,
      });

      const total = result.pagination.total ?? result.data.length;
      const pageSize = result.pagination.limit || 50;

      return {
        items: result.data,
        total,
        page: filters.page ?? 1,
        page_size: pageSize,
        total_pages: Math.ceil(total / pageSize),
      };
    },
  });
}

export function useTicket(id: string) {
  return useQuery<Ticket, APIError>({
    queryKey: ['ticket', id],
    queryFn: () => api.get<Ticket>(`/api/v1/tickets/${id}`),
    enabled: !!id,
  });
}

// Board queries can't be matched client-side when they filter by free-text
// search or consumer_name (those checks require server-side data we don't have
// locally), so those are still invalidated wholesale.
function ticketMatchesBoardFilters(ticket: Ticket, filters: Partial<TicketFilters>): boolean {
  if (filters.project_id && ticket.project_id !== filters.project_id) return false;
  if (filters.status && ticket.status !== filters.status) return false;
  if (filters.priority && ticket.priority !== filters.priority) return false;
  if (filters.assignee_id && ticket.assignee_id !== filters.assignee_id) return false;
  if (filters.reporter_id && ticket.reporter_id !== filters.reporter_id) return false;
  if (filters.team_id && ticket.team_id !== filters.team_id) return false;
  return true;
}

export function useCreateTicket() {
  const queryClient = useQueryClient();

  return useMutation<Ticket, APIError, CreateTicketInput>({
    mutationFn: (input) => {
      return api.post<Ticket>('/api/v1/tickets', {
        project_id: input.project_id,
        type: input.type,
        title: input.title,
        description: input.description,
        priority: input.priority,
        assignee_id: input.assignee_id || undefined,
        team_id: input.team_id || undefined,
        labels: input.labels,
        parent_id: input.parent_id || undefined,
        time_estimate: input.time_estimate || undefined,
        time_estimate_minutes: input.time_estimate_minutes ?? undefined,
      });
    },
    onSuccess: (data) => {
      // Patch the new ticket straight into any cached board views instead of
      // invalidating (and re-fetching + re-populating up to 500 tickets).
      queryClient.getQueryCache().findAll({ queryKey: ['ticket-board'] }).forEach((query) => {
        const filters = (query.queryKey[1] as Partial<TicketFilters>) || {};
        if (filters.search || filters.consumer_name) {
          queryClient.invalidateQueries({ queryKey: query.queryKey });
          return;
        }
        if (!ticketMatchesBoardFilters(data, filters)) return;
        queryClient.setQueryData<TicketBoard>(query.queryKey, (old) => {
          if (!old) return old;
          return {
            columns: old.columns.map((col) =>
              col.status === data.status ? { ...col, tickets: [data, ...col.tickets] } : col
            ),
          };
        });
      });
      queryClient.invalidateQueries({ queryKey: ['ticket-board-projects'] });
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-recent-tickets'] });
    },
  });
}

export function useCreateConsumerTicket() {
  const queryClient = useQueryClient();

  return useMutation<Ticket, APIError, { consumerId: string; input: Omit<CreateTicketInput, 'project_id'> }>({
    mutationFn: ({ consumerId, input }) => {
      return api.post<Ticket>(`/api/v1/provider/consumers/${consumerId}/tickets`, {
        type: input.type,
        title: input.title,
        description: input.description,
        priority: input.priority,
        labels: input.labels,
        time_estimate: input.time_estimate || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-board'] });
      queryClient.invalidateQueries({ queryKey: ['provider-consumer-tickets'] });
    },
  });
}

export function useUpdateTicket() {
  const queryClient = useQueryClient();

  return useMutation<Ticket, APIError, { id: string; input: UpdateTicketInput }>({
    mutationFn: ({ id, input }) => {
      return api.patch<Ticket>(`/api/v1/tickets/${id}`, {
        ...input,
      });
    },
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: ['ticket', id] });
      const previousTicket = queryClient.getQueryData<Ticket>(['ticket', id]);
      if (previousTicket) {
        queryClient.setQueryData<Ticket>(['ticket', id], { ...previousTicket, ...input });
      }
      return { previousTicket, id };
    },
    onError: (_err, _vars, context) => {
      const ctx = context as { previousTicket?: Ticket; id?: string } | undefined;
      if (ctx?.previousTicket && ctx.id) {
        queryClient.setQueryData(['ticket', ctx.id], ctx.previousTicket);
      }
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-board'] });
      queryClient.invalidateQueries({ queryKey: ['ticket', data.id] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
}

export function useDeleteTicket() {
  const queryClient = useQueryClient();

  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete<void>(`/api/v1/tickets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-board'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-stats'] });
    },
  });
}

export function useTicketBoard(filters: Omit<TicketFilters, 'page' | 'page_size'> = {}) {
  return useQuery<TicketBoard, APIError>({
    queryKey: ['ticket-board', filters],
    queryFn: () =>
      api.get<TicketBoard>('/api/v1/tickets/board', {
        project_id: filters.project_id,
        status: filters.status,
        priority: filters.priority,
        assignee_id: filters.assignee_id,
        reporter_id: filters.reporter_id,
        team_id: filters.team_id,
        search: filters.search,
        consumer_name: filters.consumer_name,
      }),
    staleTime: 30_000,
  });
}

// Lightweight lookup of which projects currently have tickets, used to populate
// filter dropdowns without pulling down (and populating) the full board again.
export function useTicketBoardProjects(filters: { assignee_id?: string } = {}) {
  return useQuery<string[], APIError>({
    queryKey: ['ticket-board-projects', filters],
    queryFn: async () => {
      const res = await api.get<{ project_ids: string[] }>('/api/v1/tickets/board/projects', {
        assignee_id: filters.assignee_id,
      });
      return res.project_ids;
    },
    staleTime: 30_000,
  });
}

export function useLinkTicket() {
  const queryClient = useQueryClient();
  return useMutation<Ticket, APIError, { id: string; targetId: string; type: LinkType }>({
    mutationFn: ({ id, targetId, type }) =>
      api.post<Ticket>(`/api/v1/tickets/${id}/link`, { targetId, type }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['ticket', vars.id] });
    },
  });
}

export function useUnlinkTicket() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, { id: string; targetId: string }>({
    mutationFn: ({ id, targetId }) => api.delete<void>(`/api/v1/tickets/${id}/link/${targetId}`),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['ticket', vars.id] });
    },
  });
}

export function useAddWorkLog() {
  const queryClient = useQueryClient();
  return useMutation<Ticket, APIError, { ticketId: string; minutes: number; description?: string; logged_at?: string }>({
    mutationFn: ({ ticketId, minutes, ...rest }) =>
      api.post<Ticket>(`/api/v1/tickets/${ticketId}/work-logs`, { duration_minutes: minutes, ...rest }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-board'] });
      queryClient.invalidateQueries({ queryKey: ['ticket', vars.ticketId] });
    },
  });
}

export function useRemoveWorkLog() {
  const queryClient = useQueryClient();
  return useMutation<Ticket, APIError, { ticketId: string; logId: string }>({
    mutationFn: ({ ticketId, logId }) =>
      api.delete<Ticket>(`/api/v1/tickets/${ticketId}/work-logs/${logId}`),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-board'] });
      queryClient.invalidateQueries({ queryKey: ['ticket', vars.ticketId] });
    },
  });
}

export function useEditWorkLog() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, { ticketId: string; logId: string; duration_minutes: number; description: string; logged_at: string }>({
    mutationFn: ({ ticketId, logId, ...body }) =>
      api.patch<void>(`/api/v1/tickets/${ticketId}/work-logs/${logId}`, body),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['ticket', vars.ticketId] });
      queryClient.invalidateQueries({ queryKey: ['work-logs'] });
    },
  });
}

export function useChildTickets(ticketId: string) {
  return useQuery<{ data: Ticket[] }, APIError>({
    queryKey: ['ticket-children', ticketId],
    queryFn: () => api.get<{ data: Ticket[] }>(`/api/v1/tickets/${ticketId}/children`),
    enabled: !!ticketId,
  });
}

export function useLinkIncident() {
  const queryClient = useQueryClient();
  return useMutation<Ticket, APIError, { ticketId: string; incidentId: string }>({
    mutationFn: ({ ticketId, incidentId }) =>
      api.post<Ticket>(`/api/v1/tickets/${ticketId}/link-incident`, { incident_id: incidentId }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['ticket', vars.ticketId] });
    },
  });
}

export function useUnlinkIncident() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, { ticketId: string; incidentId: string }>({
    mutationFn: ({ ticketId, incidentId }) =>
      api.delete<void>(`/api/v1/tickets/${ticketId}/link-incident/${incidentId}`),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['ticket', vars.ticketId] });
    },
  });
}

export function useLinkChangeRequest() {
  const queryClient = useQueryClient();
  return useMutation<Ticket, APIError, { ticketId: string; changeRequestId: string }>({
    mutationFn: ({ ticketId, changeRequestId }) =>
      api.post<Ticket>(`/api/v1/tickets/${ticketId}/link-change-request`, { change_request_id: changeRequestId }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['ticket', vars.ticketId] });
    },
  });
}

export function useEscalateTicket() {
  const queryClient = useQueryClient();
  return useMutation<{ bridge_id: string; provider_ticket_id: string; status: string; escalated_at: string }, APIError, string>({
    mutationFn: (id) => api.post(`/api/v1/tickets/${id}/escalate`, {}),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    },
  });
}

export function useUnlinkChangeRequest() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, { ticketId: string; changeRequestId: string }>({
    mutationFn: ({ ticketId, changeRequestId }) =>
      api.delete<void>(`/api/v1/tickets/${ticketId}/link-change-request/${changeRequestId}`),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['ticket', vars.ticketId] });
    },
  });
}

export function usePendingWorkLogs() {
  return useQuery<{ data: WorkLogEntry[]; total_minutes: number }, APIError>({
    queryKey: ['work-logs', 'pending'],
    queryFn: () => api.get('/api/v1/tickets/work-logs', { status: 'pending' }),
  });
}

export function useWorkLogs(filters: { status?: string } = {}) {
  return useQuery<{ data: WorkLogEntry[]; total_minutes: number }, APIError>({
    queryKey: ['work-logs', filters],
    queryFn: () => api.get('/api/v1/tickets/work-logs', filters),
  });
}

export function useApproveWorkLog() {
  const queryClient = useQueryClient();
  return useMutation<WorkLogEntry, APIError, { logId: string; ticketId: string }>({
    mutationFn: ({ logId }) => api.patch<WorkLogEntry>(`/api/v1/tickets/work-logs/${logId}/approve`, {}),
    onSuccess: (_data, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['work-logs'] });
    },
  });
}

export function useBulkApproveWorkLogs() {
  const queryClient = useQueryClient();
  return useMutation<{ approved_count: number }, APIError, { ids: string[]; ticketId?: string }>({
    mutationFn: ({ ids }) =>
      api.patch<{ approved_count: number }>('/api/v1/tickets/work-logs/bulk-approve', { ids }),
    onSuccess: (_data, { ticketId }) => {
      if (ticketId) queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['work-logs'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-board'] });
    },
  });
}

// -- Attachment Types & Hooks --

export interface TicketAttachment {
  _id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  object_key: string;
  bucket: string;
  created_at: string;
}

export function useTicketAttachments(ticketId: string) {
  return useQuery<{ data: TicketAttachment[] }, APIError>({
    queryKey: ['ticket-attachments', ticketId],
    queryFn: () => api.get<{ data: TicketAttachment[] }>(`/api/v1/tickets/${ticketId}/attachments`),
    enabled: !!ticketId,
  });
}

export function useUploadTicketAttachment() {
  const queryClient = useQueryClient();
  return useMutation<
    TicketAttachment,
    APIError,
    { ticketId: string; file: File }
  >({
    mutationFn: async ({ ticketId, file }) => {
      // Step 1: Register attachment and get file_id
      const { file_id } = await api.post<{
        upload_url: string;
        file_id: string;
      }>(`/api/v1/tickets/${ticketId}/attachments`, {
        original_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        size_bytes: file.size,
      });

      // Step 2: Upload file via API proxy (MinIO is not reachable from browser)
      // Use getAuthHeaders to include JWT token
      const sessionRes = await fetch('/api/auth/session');
      const session = await sessionRes.json();
      const token = session?.accessToken;
      const tenantSlug = session?.tenantSlug || 'platform';

      const formData = new FormData();
      formData.append('file', file);
      const headers: Record<string, string> = { 'X-Tenant-Slug': tenantSlug };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const uploadRes = await fetch(`/api/v1/storage/files/${file_id}/upload`, {
        method: 'POST',
        body: formData,
        headers,
      });
      if (!uploadRes.ok) {
        throw new Error('Failed to upload file to storage');
      }

      return { _id: file_id } as TicketAttachment;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['ticket-attachments', vars.ticketId] });
    },
  });
}

export function useDeleteTicketAttachment() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, { ticketId: string; fileId: string }>({
    mutationFn: ({ ticketId, fileId }) =>
      api.delete<void>(`/api/v1/tickets/${ticketId}/attachments/${fileId}`),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['ticket-attachments', vars.ticketId] });
    },
  });
}

export async function downloadTicketAttachment(fileId: string) {
  const sessionRes = await fetch('/api/auth/session');
  const session = await sessionRes.json();
  const token = session?.accessToken;
  const tenantSlug = session?.tenantSlug || 'platform';

  const headers: Record<string, string> = { 'X-Tenant-Slug': tenantSlug };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`/api/v1/storage/files/${fileId}/download`, {
    headers,
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('Download failed');

  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export function useRejectWorkLog() {
  const queryClient = useQueryClient();
  return useMutation<WorkLogEntry, APIError, { logId: string; ticketId: string; reason?: string }>({
    mutationFn: ({ logId, reason }) =>
      api.patch<WorkLogEntry>(`/api/v1/tickets/work-logs/${logId}/reject`, { reason }),
    onSuccess: (_data, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
      queryClient.invalidateQueries({ queryKey: ['work-logs'] });
    },
  });
}

// ─── Ticket Workflow ──────────────────────────────────────────────────────────

export function useTicketWorkflows() {
  return useQuery<{ data: TicketWorkflow[] }, APIError>({
    queryKey: ['ticket-workflows'],
    queryFn: () => api.get<{ data: TicketWorkflow[] }>('/api/v1/ticket-workflows'),
    staleTime: 5 * 60 * 1000,
  });
}

export function useTicketWorkflow(ticketType: string) {
  const { data } = useTicketWorkflows();
  return (data?.data ?? []).find((w) => w.ticket_type === ticketType) ?? null;
}

// ─── Comments ────────────────────────────────────────────────────────────────

export function useUpdateComment() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, { ticketId: string; commentId: string; body: string }>({
    mutationFn: ({ ticketId, commentId, body }) =>
      api.patch<void>(`/api/v1/tickets/${ticketId}/comments/${commentId}`, { body }),
    onSuccess: (_data, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
    },
  });
}

export function useDeleteComment() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, { ticketId: string; commentId: string }>({
    mutationFn: ({ ticketId, commentId }) =>
      api.delete<void>(`/api/v1/tickets/${ticketId}/comments/${commentId}`),
    onSuccess: (_data, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
    },
  });
}

// ─── Bulk operations ──────────────────────────────────────────────────────────

export interface BulkUpdateInput {
  status?: string;
  priority?: TicketPriority;
  assignee_id?: string | null;
}

export function useBulkUpdateTickets() {
  const queryClient = useQueryClient();
  return useMutation<{ updated_count: number }, APIError, { ticket_ids: string[]; update: BulkUpdateInput }>({
    mutationFn: (body) => api.post<{ updated_count: number }>('/api/v1/tickets/bulk', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      queryClient.invalidateQueries({ queryKey: ['ticket-board'] });
    },
  });
}


export function useTicketSearch(query: string, excludeId?: string) {
  return useQuery<Ticket[], APIError>({
    queryKey: ['ticket-search', query, excludeId],
    queryFn: async () => {
      if (!query.trim()) return [];
      const result = await api.get<BackendTicketResponse>('/api/v1/tickets', { search: query, limit: 10 });
      return result.data.filter((t: any) => t._id?.toString() !== excludeId && t.id !== excludeId);
    },
    enabled: query.trim().length >= 1,
    staleTime: 10000,
  });
}

// ─── Analytics ───────────────────────────────────────────────────────────────

export interface CycleTimeData {
  avg_days:    number;
  median_days: number;
  p75_days:    number;
  p95_days:    number;
  sample_size: number;
  by_type:     Record<string, number>;
  trend:       Array<{ week: string; avg_days: number; count: number }>;
}

export function useCycleTime(filters: { days?: number; project_id?: string } = {}) {
  return useQuery<CycleTimeData, APIError>({
    queryKey: ['ticket-cycle-time', filters],
    queryFn: () => api.get<CycleTimeData>('/api/v1/tickets/analytics/cycle-time', {
      days:       filters.days ?? 30,
      project_id: filters.project_id,
    }),
    staleTime: 5 * 60 * 1000,
  });
}

export function useBacklogTickets(filters: Pick<TicketFilters, 'project_id' | 'search'> = {}) {
  return useQuery<PaginatedResponse<Ticket>, APIError>({
    queryKey: ['tickets-backlog', filters],
    queryFn: async () => {
      const result = await api.get<BackendTicketResponse>('/api/v1/tickets', {
        project_id: filters.project_id,
        search: filters.search,
        is_backlog: 'true',
        limit: 200,
      });
      const total = result.pagination.total ?? result.data.length;
      return { items: result.data, total, page: 1, page_size: total, total_pages: 1 };
    },
  });
}

export function useWorkloadStats() {
  return useQuery<{ data: Array<{ assignee_id: string; name: string; count: number }> }, APIError>({
    queryKey: ['ticket-workload'],
    queryFn: () => api.get('/api/v1/tickets/analytics/workload'),
    staleTime: 2 * 60 * 1000,
  });
}

export function useStatusDistribution() {
  return useQuery<{ data: Array<{ status: string; count: number }> }, APIError>({
    queryKey: ['ticket-status-distribution'],
    queryFn: () => api.get('/api/v1/tickets/analytics/status-distribution'),
    staleTime: 2 * 60 * 1000,
  });
}

export function useThroughput(weeks = 12) {
  return useQuery<{ data: Array<{ week: string; count: number }>; total: number }, APIError>({
    queryKey: ['ticket-throughput', weeks],
    queryFn: () => api.get('/api/v1/tickets/analytics/throughput', { weeks }),
    staleTime: 5 * 60 * 1000,
  });
}

export function useTimesheet(filters: { from?: string; until?: string; user_id?: string } = {}) {
  return useQuery<{ data: Array<{ user: { id: string; name: string; email: string; avatar_url: string | null }; total_minutes: number; billable_minutes: number; entries: any[] }> }, APIError>({
    queryKey: ['ticket-timesheet', filters],
    queryFn: () => api.get('/api/v1/tickets/work-logs/timesheet', filters),
    staleTime: 60 * 1000,
  });
}

export function useToggleReaction() {
  const queryClient = useQueryClient();
  return useMutation<{ action: 'added' | 'removed'; emoji: string }, APIError, { ticketId: string; commentId: string; emoji: string }>({
    mutationFn: ({ ticketId, commentId, emoji }) =>
      api.post(`/api/v1/tickets/${ticketId}/comments/${commentId}/reactions`, { emoji }),
    onSuccess: (_data, { ticketId }) => {
      queryClient.invalidateQueries({ queryKey: ['ticket', ticketId] });
    },
  });
}
