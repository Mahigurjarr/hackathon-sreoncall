'use client';

import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

// Fire-and-forget beacon (Inc 4): reports when a user RUNS an AI-originated query, and whether
// they edited the generated query first. Feeds the accuracy flywheel. Authed + tenant-scoped
// server-side; never surfaces errors to the user.

export interface AskFeedbackInput {
  lang: 'promql' | 'logql';
  question?: string;
  generatedQuery?: string;
  finalQuery?: string;
  edited: boolean;
  resultCount?: number;
}

export function useAskFeedback() {
  const mutation = useMutation<void, unknown, AskFeedbackInput>({
    mutationFn: (input) => api.post('/api/v1/observability/ai/ask-feedback', input),
  });
  // Convenience: swallow errors — telemetry must never break the user flow.
  const send = (input: AskFeedbackInput) => {
    mutation.mutate(input, { onError: () => {} });
  };
  return { send };
}
