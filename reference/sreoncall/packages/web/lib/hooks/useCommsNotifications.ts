'use client';

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useWebSocket } from './useWebSocket';

interface CommsNotificationOptions {
  /** User's notification preferences */
  commsEnabled?: boolean;
  commsSound?: boolean;
  commsBrowserNotifications?: boolean;
  quietHoursActive?: boolean;
}

export function useCommsNotifications(options: CommsNotificationOptions = {}) {
  const {
    commsEnabled = true,
    commsSound = true,
    commsBrowserNotifications = true,
    quietHoursActive = false,
  } = options;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const permissionRequestedRef = useRef(false);

  // Pre-load audio
  useEffect(() => {
    audioRef.current = new Audio('/sounds/notification.mp3');
    audioRef.current.volume = 0.5;
  }, []);

  // Request browser notification permission once
  useEffect(() => {
    if (commsBrowserNotifications && !permissionRequestedRef.current && typeof Notification !== 'undefined') {
      permissionRequestedRef.current = true;
      if (Notification.permission === 'default') {
        Notification.requestPermission();
      }
    }
  }, [commsBrowserNotifications]);

  useWebSocket({
    onMessage: (event) => {
      if (event.type !== 'comms.message.new') return;
      if (!commsEnabled || quietHoursActive) return;

      const sender = (event.payload?.sender_display_name as string) || 'Someone';
      const preview = (event.payload?.body_preview as string) || '';
      const threadId = event.payload?.thread_id as string;

      // Always show toast
      toast.info(`New message from ${sender}`, {
        description: preview,
        action: threadId
          ? { label: 'View', onClick: () => window.location.assign(`/consumers/communications/_/${threadId}`) }
          : undefined,
      });

      // Play sound
      if (commsSound && audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }

      // Browser notification
      if (commsBrowserNotifications && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(`New message from ${sender}`, { body: preview, icon: '/favicon.ico' });
      }
    },
  });
}
