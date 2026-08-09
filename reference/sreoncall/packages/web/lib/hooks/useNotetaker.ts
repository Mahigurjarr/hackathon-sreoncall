'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';

export type NotetakerSource = 'recall_bot' | 'upload';
export type NotetakerPlatform = 'zoom' | 'meet' | 'teams' | 'slack_huddle' | 'upload';
export type NotetakerStatus =
  | 'scheduled'
  | 'joining'
  | 'recording'
  | 'processing'
  | 'transcribing'
  | 'summarizing'
  | 'completed'
  | 'failed';
export type SuggestionType = 'ticket' | 'runbook' | 'incident_timeline';
export type SuggestionStatus = 'suggested' | 'accepted' | 'dismissed';

export interface NotetakerSuggestion {
  id: string;
  type: SuggestionType;
  status: SuggestionStatus;
  payload: Record<string, unknown>;
  created_resource_type?: string | null;
  created_resource_id?: string | null;
  decided_at?: string | null;
}

export interface NotetakerSession {
  id: string;
  title: string;
  source: NotetakerSource;
  platform: NotetakerPlatform;
  status: NotetakerStatus;
  error?: string | null;
  channel_id?: string | null;
  incident_id?: string | null;
  meeting_url?: string | null;
  stt_provider: string;
  duration_seconds: number;
  summary?: string | null;
  key_points: string[];
  decisions: string[];
  participants: string[];
  suggestions: NotetakerSuggestion[];
  pending_suggestions: number;
  created_at: string;
  started_at?: string | null;
  ended_at?: string | null;
}

export interface TranscriptSegment {
  id: string;
  speaker: string;
  text: string;
  start_ms: number;
  end_ms: number;
  is_final: boolean;
}

export interface StartSessionInput {
  source: NotetakerSource;
  platform?: NotetakerPlatform;
  title: string;
  channel_id?: string;
  incident_id?: string;
  meeting_url?: string;
  upload?: { original_name: string; mime_type: string; size_bytes: number };
}

export interface StartSessionResult {
  session: NotetakerSession;
  upload: { upload_url: string; file_id: string; expires_in: number } | null;
}

export function useNotetakerSessions(filter?: { channel_id?: string; incident_id?: string }) {
  return useQuery<NotetakerSession[], APIError>({
    queryKey: ['notetaker-sessions', filter || {}],
    queryFn: async () => {
      const res = await api.get<{ data: NotetakerSession[] }>('/api/v1/notetaker/sessions', {
        ...(filter?.channel_id ? { channel_id: filter.channel_id } : {}),
        ...(filter?.incident_id ? { incident_id: filter.incident_id } : {}),
      });
      return res.data;
    },
  });
}

export function useNotetakerSession(id: string | null, opts?: { poll?: boolean }) {
  return useQuery<NotetakerSession, APIError>({
    queryKey: ['notetaker-session', id],
    queryFn: async () => {
      const res = await api.get<{ session: NotetakerSession }>(`/api/v1/notetaker/sessions/${id}`);
      return res.session;
    },
    enabled: !!id,
    // Poll while a session is in flight so status/summary update live.
    refetchInterval: (query) => {
      if (!opts?.poll) return false;
      const s = query.state.data as NotetakerSession | undefined;
      if (!s) return 4000;
      return ['completed', 'failed'].includes(s.status) ? false : 4000;
    },
  });
}

export function useNotetakerTranscript(id: string | null) {
  return useQuery<TranscriptSegment[], APIError>({
    queryKey: ['notetaker-transcript', id],
    queryFn: async () => {
      const res = await api.get<{ data: TranscriptSegment[] }>(`/api/v1/notetaker/sessions/${id}/transcript`);
      return res.data;
    },
    enabled: !!id,
  });
}

export function useStartSession() {
  const qc = useQueryClient();
  return useMutation<StartSessionResult, APIError, StartSessionInput>({
    mutationFn: (input) => api.post<StartSessionResult>('/api/v1/notetaker/sessions', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notetaker-sessions'] }),
  });
}

export function useFinalizeUpload() {
  const qc = useQueryClient();
  return useMutation<{ session: NotetakerSession }, APIError, string>({
    mutationFn: (sessionId) => api.post(`/api/v1/notetaker/sessions/${sessionId}/finalize-upload`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notetaker-sessions'] }),
  });
}

export function useStopSession() {
  const qc = useQueryClient();
  return useMutation<{ session: NotetakerSession }, APIError, string>({
    mutationFn: (sessionId) => api.post(`/api/v1/notetaker/sessions/${sessionId}/stop`),
    onSuccess: (_d, sessionId) => {
      qc.invalidateQueries({ queryKey: ['notetaker-sessions'] });
      qc.invalidateQueries({ queryKey: ['notetaker-session', sessionId] });
    },
  });
}

export function useAcceptSuggestion(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<
    { resource_type: string; resource_id: string },
    APIError,
    { suggestionId: string; project_id?: string }
  >({
    mutationFn: ({ suggestionId, project_id }) =>
      api.post(`/api/v1/notetaker/sessions/${sessionId}/suggestions/${suggestionId}/accept`, { project_id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notetaker-session', sessionId] }),
  });
}

export function useDismissSuggestion(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, APIError, string>({
    mutationFn: (suggestionId) =>
      api.post(`/api/v1/notetaker/sessions/${sessionId}/suggestions/${suggestionId}/dismiss`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notetaker-session', sessionId] }),
  });
}

export function useRegenerateSummary(sessionId: string) {
  const qc = useQueryClient();
  return useMutation<{ session: NotetakerSession }, APIError, void>({
    mutationFn: () => api.post(`/api/v1/notetaker/sessions/${sessionId}/regenerate-summary`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notetaker-session', sessionId] }),
  });
}

/**
 * Upload a recording file to storage via the API proxy, then the caller
 * finalizes the session to start transcription. We proxy through the API
 * (rather than PUT to the presigned URL) because MinIO is not reachable from
 * the browser on most deployments — same pattern as ticket attachments.
 */
export async function uploadRecording(fileId: string, file: File): Promise<void> {
  const sessionRes = await fetch('/api/auth/session');
  const session = await sessionRes.json();
  const token = session?.accessToken;
  const tenantSlug = session?.tenantSlug || 'platform';

  const formData = new FormData();
  formData.append('file', file);
  const headers: Record<string, string> = { 'X-Tenant-Slug': tenantSlug };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`/api/v1/storage/files/${fileId}/upload`, {
    method: 'POST',
    body: formData,
    headers,
  });
  if (!res.ok) throw new Error(`Upload failed with status ${res.status}`);
}
