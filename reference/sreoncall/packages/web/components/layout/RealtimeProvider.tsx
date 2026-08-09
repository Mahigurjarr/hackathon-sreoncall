'use client';

import { useWebSocket } from '@/lib/hooks/useWebSocket';
import { useCommsNotifications } from '@/lib/hooks/useCommsNotifications';

export function RealtimeProvider() {
  useWebSocket();
  useCommsNotifications();
  return null;
}
