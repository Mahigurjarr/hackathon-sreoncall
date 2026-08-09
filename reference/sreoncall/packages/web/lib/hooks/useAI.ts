'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, APIError } from '@/lib/api';
import { useCallback, useRef, useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIStatus {
  ai_available: boolean;
  model: string;
}

export interface AIAnalysisResult {
  result: string;
  incident_id: string;
  generated_at: string;
}

export interface AISuggestTitleResult {
  title: string;
  ai_generated: boolean;
}

export interface AISuggestSeverityResult {
  severity: number;
  reasoning: string;
  ai_generated: boolean;
}

export interface AIConversationSummary {
  id: string;
  title: string;
  incident_id: string | null;
  message_count: number;
  model: string;
  total_tokens: number;
  created_at: string;
  updated_at: string;
}

export interface AIMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface AIConversation {
  id: string;
  title: string;
  incident_id: string | null;
  messages: AIMessage[];
  model: string;
  total_tokens: number;
  created_at: string;
  updated_at: string;
}

// ─── AI Status ────────────────────────────────────────────────────────────────

export function useAIStatus() {
  return useQuery<AIStatus, APIError>({
    queryKey: ['ai-status'],
    queryFn: () => api.get<AIStatus>('/api/v1/ai/status'),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

// ─── Analysis mutations ───────────────────────────────────────────────────────

export function useAITriage() {
  return useMutation<AIAnalysisResult, APIError, string>({
    mutationFn: (incidentId) =>
      api.post<AIAnalysisResult>(`/api/v1/ai/triage/incident/${incidentId}`, {}),
  });
}

export function useAIRCA() {
  return useMutation<AIAnalysisResult, APIError, string>({
    mutationFn: (incidentId) =>
      api.post<AIAnalysisResult>(`/api/v1/ai/rca/incident/${incidentId}`, {}),
  });
}

export function useAIDraftPostmortem() {
  const queryClient = useQueryClient();
  return useMutation<{ postmortem_id: string; message: string }, APIError, string>({
    mutationFn: (incidentId) =>
      api.post<{ postmortem_id: string; message: string }>(`/api/v1/ai/postmortem/draft/${incidentId}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['postmortems'] });
    },
  });
}

export function useAIGenerateRunbook() {
  const queryClient = useQueryClient();
  return useMutation<{ runbook_id: string; message: string }, APIError, string>({
    mutationFn: (incidentId) =>
      api.post<{ runbook_id: string; message: string }>(`/api/v1/ai/runbooks/generate-from-incident/${incidentId}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runbooks'] });
    },
  });
}

export function useAISuggestTitle() {
  return useMutation<AISuggestTitleResult, APIError, string>({
    mutationFn: (description) =>
      api.post<AISuggestTitleResult>('/api/v1/ai/suggest/title', { description }),
  });
}

export function useAISuggestSeverity() {
  return useMutation<AISuggestSeverityResult, APIError, { title: string; description: string }>({
    mutationFn: (input) =>
      api.post<AISuggestSeverityResult>('/api/v1/ai/suggest/severity', input),
  });
}

// ─── Conversations ────────────────────────────────────────────────────────────

export function useAIConversations(incidentId?: string) {
  return useQuery<AIConversationSummary[], APIError>({
    queryKey: ['ai-conversations', incidentId],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (incidentId) params.incident_id = incidentId;
      const res = await api.get<{ data: AIConversationSummary[] }>('/api/v1/ai/conversations', params);
      return res.data;
    },
  });
}

export function useAIConversation(id: string) {
  return useQuery<AIConversation, APIError>({
    queryKey: ['ai-conversation', id],
    queryFn: () => api.get<AIConversation>(`/api/v1/ai/conversations/${id}`),
    enabled: !!id,
  });
}

export function useDeleteAIConversation() {
  const queryClient = useQueryClient();
  return useMutation<void, APIError, string>({
    mutationFn: (id) => api.delete<void>(`/api/v1/ai/conversations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-conversations'] });
    },
  });
}

// ─── Copilot Streaming Chat ──────────────────────────────────────────────────

export interface CopilotMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function useCopilotChat() {
  const [messages, setMessages] = useState<CopilotMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async (
    message: string,
    incidentId?: string,
  ) => {
    if (isStreaming) return;

    // Add user message
    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setIsStreaming(true);

    // Add placeholder assistant message
    setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      // Get auth session for headers
      const sessionRes = await fetch('/api/auth/session');
      const session = await sessionRes.json();

      const response = await fetch('/api/v1/ai/copilot/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': session?.accessToken ? `Bearer ${session.accessToken}` : '',
          'X-Tenant-Slug': session?.tenantSlug || 'platform',
        },
        body: JSON.stringify({
          message,
          incident_id: incidentId,
          conversation_id: conversationId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6);
          if (!jsonStr) continue;

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === 'text_delta') {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    content: last.content + event.text,
                  };
                }
                return updated;
              });
            } else if (event.type === 'done') {
              if (event.conversation_id) {
                setConversationId(event.conversation_id);
              }
            } else if (event.type === 'error') {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    content: 'Sorry, an error occurred while processing your request.',
                  };
                }
                return updated;
              });
            }
          } catch {
            // Skip unparseable lines
          }
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant' && !last.content) {
            updated[updated.length - 1] = {
              ...last,
              content: 'Failed to connect to AI service. Please try again.',
            };
          }
          return updated;
        });
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [isStreaming, conversationId]);

  const reset = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setConversationId(null);
    setIsStreaming(false);
  }, []);

  const loadConversation = useCallback((conv: AIConversation) => {
    setConversationId(conv.id);
    setMessages(conv.messages.map((m) => ({ role: m.role, content: m.content })));
  }, []);

  return {
    messages,
    isStreaming,
    conversationId,
    sendMessage,
    reset,
    loadConversation,
  };
}
