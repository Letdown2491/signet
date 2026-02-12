import { useEffect, useRef, useState, useCallback } from 'react';
import type { PendingRequest, ConnectedApp, DashboardStats, KeyInfo, RelayStatusResponse, ActivityEntry, AdminActivityEntry, LogEntry, HealthStatus } from '@signet/types';
import type { DeadManSwitchStatus } from '../lib/api-client.js';

/**
 * Server-sent event types matching the backend event-service.ts
 */
export type ServerEvent =
  | { type: 'connected' }
  | { type: 'reconnected' }
  | { type: 'request:created'; request: PendingRequest }
  | { type: 'request:approved'; requestId: string; activity: ActivityEntry }
  | { type: 'request:denied'; requestId: string; activity: ActivityEntry }
  | { type: 'request:expired'; requestId: string }
  | { type: 'request:auto_approved'; activity: ActivityEntry }
  | { type: 'app:connected'; app: ConnectedApp }
  | { type: 'app:revoked'; appId: number }
  | { type: 'app:updated'; app: ConnectedApp }
  | { type: 'key:created'; key: KeyInfo }
  | { type: 'key:unlocked'; keyName: string }
  | { type: 'key:locked'; keyName: string }
  | { type: 'key:deleted'; keyName: string }
  | { type: 'key:renamed'; oldName: string; newName: string }
  | { type: 'key:updated'; keyName: string }
  | { type: 'stats:updated'; stats: DashboardStats }
  | { type: 'relays:updated'; relays: RelayStatusResponse }
  | { type: 'admin:event'; activity: AdminActivityEntry }
  | { type: 'deadman:panic'; status: DeadManSwitchStatus }
  | { type: 'deadman:reset'; status: DeadManSwitchStatus }
  | { type: 'deadman:updated'; status: DeadManSwitchStatus }
  | { type: 'log:entry'; entry: LogEntry }
  | { type: 'health:updated'; health: HealthStatus }
  | { type: 'ping' };

export type ServerEventCallback = (event: ServerEvent) => void;

export interface UseServerEventsOptions {
  enabled?: boolean;
  onEvent?: ServerEventCallback;
}

export interface UseServerEventsResult {
  connected: boolean;
  error: string | null;
  reconnecting: boolean;
  connectionCount: number;
}

const MAX_RECONNECT_DELAY = 30000; // 30 seconds
const INITIAL_RECONNECT_DELAY = 1000; // 1 second
const HEARTBEAT_TIMEOUT = 45000; // Expect server ping within 45 seconds
const HEARTBEAT_CHECK_INTERVAL = 10000; // Check every 10 seconds

function getApiBase(): string {
  const envBase = import.meta.env.VITE_DAEMON_API_URL ?? import.meta.env.VITE_BUNKER_API_URL;
  if (typeof envBase === 'string' && envBase.trim().length > 0) {
    return envBase.trim().replace(/\/+$/, '');
  }
  return '';
}

export function useServerEvents(options: UseServerEventsOptions = {}): UseServerEventsResult {
  const { enabled = true, onEvent } = options;

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [connectionCount, setConnectionCount] = useState(0);

  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastEventTimeRef = useRef<number>(Date.now());
  const hasConnectedBeforeRef = useRef(false);
  const onEventRef = useRef(onEvent);
  // Track reconnection state synchronously to prevent race conditions
  const isReconnectingRef = useRef(false);

  // Keep the callback ref up to date
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const connect = useCallback(() => {
    if (!enabled) return;

    // Clean up any existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const apiBase = getApiBase();
    const url = `${apiBase}/events`;

    try {
      const eventSource = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = eventSource;

      eventSource.onopen = () => {
        const isReconnection = hasConnectedBeforeRef.current;
        hasConnectedBeforeRef.current = true;
        isReconnectingRef.current = false; // Clear reconnecting flag synchronously

        setConnected(true);
        setError(null);
        setReconnecting(false);
        reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
        lastEventTimeRef.current = Date.now();
        setConnectionCount(c => c + 1);

        // Emit reconnected event so subscribers can refresh their state
        if (isReconnection && onEventRef.current) {
          onEventRef.current({ type: 'reconnected' });
        }
      };

      eventSource.onmessage = (event) => {
        lastEventTimeRef.current = Date.now();
        try {
          const data = JSON.parse(event.data) as ServerEvent;
          if (onEventRef.current) {
            onEventRef.current(data);
          }
        } catch (err) {
          console.error('Failed to parse SSE event:', err);
        }
      };

      eventSource.onerror = () => {
        setConnected(false);

        // EventSource automatically tries to reconnect, but we want more control
        eventSource.close();
        eventSourceRef.current = null;

        // Don't reconnect if we're offline
        if (!navigator.onLine) {
          setError('Network offline');
          setReconnecting(false);
          return;
        }

        // Exponential backoff for reconnect
        isReconnectingRef.current = true; // Set synchronously to prevent race conditions
        setReconnecting(true);
        setError('Connection lost. Reconnecting...');

        // Clear any existing reconnect timeout to prevent leaks
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current);
        }

        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectDelayRef.current = Math.min(
            reconnectDelayRef.current * 2,
            MAX_RECONNECT_DELAY
          );
          connect();
        }, reconnectDelayRef.current);
      };
    } catch {
      setError('Failed to connect to event stream');
      setConnected(false);
    }
  }, [enabled]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    isReconnectingRef.current = false;
    setConnected(false);
    setReconnecting(false);
  }, []);

  // Main connection effect
  useEffect(() => {
    if (enabled) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [enabled, connect, disconnect]);

  // Heartbeat monitoring - detect stale connections
  useEffect(() => {
    if (!enabled) return;

    heartbeatIntervalRef.current = setInterval(() => {
      // Check both connected state and that we're not already reconnecting
      // Using ref for reconnecting check to avoid race conditions with async state updates
      if (connected && !isReconnectingRef.current && Date.now() - lastEventTimeRef.current > HEARTBEAT_TIMEOUT) {
        console.warn('SSE heartbeat timeout, reconnecting...');
        isReconnectingRef.current = true; // Prevent multiple reconnection attempts
        connect();
      }
    }, HEARTBEAT_CHECK_INTERVAL);

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [enabled, connected, connect]);

  // Page visibility handling - reconnect when tab becomes visible
  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Reset last event time to avoid immediate timeout
        lastEventTimeRef.current = Date.now();

        if (!connected && !reconnecting) {
          console.log('Tab visible, reconnecting SSE...');
          connect();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [enabled, connected, reconnecting, connect]);

  // Network status awareness
  useEffect(() => {
    if (!enabled) return;

    const handleOnline = () => {
      console.log('Network online, reconnecting SSE...');
      setError(null);
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      connect();
    };

    const handleOffline = () => {
      console.log('Network offline');
      disconnect();
      setError('Network offline');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [enabled, connect, disconnect]);

  return {
    connected,
    error,
    reconnecting,
    connectionCount,
  };
}
