'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useQueryClient } from '@tanstack/react-query';

interface WebSocketEvent {
  type: string;
  payload: Record<string, unknown>;
}

interface UseWebSocketOptions {
  onMessage?: (event: WebSocketEvent) => void;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const {
    onMessage,
    reconnectInterval = 3000,
    maxReconnectAttempts = 10,
  } = options;

  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Derive WS URL from the current hostname when the env var is absent so the
  // hook works on any deployment domain without per-environment config.
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL ||
    (typeof window !== 'undefined'
      ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}/ws`
      : 'wss://web.sreoncall.com/ws');

  const invalidateQueriesForEvent = useCallback(
    (event: WebSocketEvent) => {
      switch (event.type) {
        case 'ticket.created':
        case 'ticket.updated':
        case 'ticket.deleted':
          queryClient.invalidateQueries({ queryKey: ['tickets'] });
          queryClient.invalidateQueries({ queryKey: ['ticket-board'] });
          if (event.payload?.id) {
            queryClient.invalidateQueries({
              queryKey: ['ticket', event.payload.id],
            });
          }
          break;
        case 'comment.created':
        case 'comment.updated':
          if (event.payload?.ticket_id) {
            queryClient.invalidateQueries({
              queryKey: ['ticket', event.payload.ticket_id],
            });
          }
          break;
        case 'notification.new':
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          break;
        case 'incident': {
          const incId = event.payload?.incident_id as string | undefined;
          if (incId) {
            queryClient.invalidateQueries({ queryKey: ['incident', incId] });
            queryClient.invalidateQueries({ queryKey: ['incident-timeline', incId] });
          }
          queryClient.invalidateQueries({ queryKey: ['incidents'] });
          break;
        }
        case 'comms':
        case 'comms.message.new':
          queryClient.invalidateQueries({ queryKey: ['comms-inbox'] });
          queryClient.invalidateQueries({ queryKey: ['comms-threads'] });
          if (event.payload?.thread_id) {
            queryClient.invalidateQueries({
              queryKey: ['comms-messages', event.payload.thread_id],
            });
          }
          break;
        case 'comms.delivered':
        case 'comms.messages.read':
          if (event.payload?.thread_id) {
            queryClient.invalidateQueries({
              queryKey: ['comms-messages', event.payload.thread_id],
            });
          }
          break;
        case 'notetaker': {
          const sid = event.payload?.session_id as string | undefined;
          if (sid) {
            queryClient.invalidateQueries({ queryKey: ['notetaker-transcript', sid] });
          }
          break;
        }
        default:
          break;
      }
    },
    [queryClient],
  );

  const connect = useCallback(() => {
    if (!session?.accessToken) return;

    const url = `${wsUrl}?token=${encodeURIComponent(session.accessToken)}`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (messageEvent) => {
      try {
        const raw = JSON.parse(messageEvent.data);
        // Normalize events: gateway sends { type, subject, data } — map to { type, payload }
        let event: WebSocketEvent;
        if (raw.type === 'comms' && raw.data?.event) {
          event = { type: raw.data.event, payload: raw.data };
        } else if (raw.type === 'incident') {
          event = { type: 'incident', payload: raw.data || {} };
        } else if (raw.type === 'notetaker') {
          event = { type: 'notetaker', payload: raw.data || {} };
        } else {
          event = raw;
        }
        invalidateQueriesForEvent(event);
        onMessage?.(event);
      } catch {
        // Silently ignore malformed messages
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      wsRef.current = null;

      if (reconnectAttemptsRef.current < maxReconnectAttempts) {
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current += 1;
          connect();
        }, reconnectInterval);
      }
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [session?.accessToken, wsUrl, invalidateQueriesForEvent, onMessage, reconnectInterval, maxReconnectAttempts]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    reconnectAttemptsRef.current = maxReconnectAttempts; // prevent reconnect
    wsRef.current?.close();
    wsRef.current = null;
    setIsConnected(false);
  }, [maxReconnectAttempts]);

  const sendMessage = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return { isConnected, sendMessage, disconnect };
}
