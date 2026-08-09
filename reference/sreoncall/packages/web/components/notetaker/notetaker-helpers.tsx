'use client';

import { Badge } from '@/components/ui/Badge';
import type { NotetakerStatus, NotetakerPlatform } from '@/lib/hooks/useNotetaker';

const STATUS_VARIANT: Record<NotetakerStatus, { variant: any; label: string }> = {
  scheduled: { variant: 'secondary', label: 'Scheduled' },
  joining: { variant: 'info', label: 'Joining' },
  recording: { variant: 'destructive', label: '● Recording' },
  processing: { variant: 'warning', label: 'Processing' },
  transcribing: { variant: 'warning', label: 'Transcribing' },
  summarizing: { variant: 'ai', label: 'Summarizing' },
  completed: { variant: 'success', label: 'Completed' },
  failed: { variant: 'destructive', label: 'Failed' },
};

export function NotetakerStatusBadge({ status }: { status: NotetakerStatus }) {
  const s = STATUS_VARIANT[status] || { variant: 'secondary', label: status };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

const PLATFORM_LABEL: Record<NotetakerPlatform, string> = {
  zoom: 'Zoom',
  meet: 'Google Meet',
  teams: 'MS Teams',
  slack_huddle: 'Slack Huddle',
  upload: 'Upload',
};

export function platformLabel(p: NotetakerPlatform): string {
  return PLATFORM_LABEL[p] || p;
}

export function isInFlight(status: NotetakerStatus): boolean {
  return !['completed', 'failed'].includes(status);
}

export function formatDuration(seconds: number): string {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
