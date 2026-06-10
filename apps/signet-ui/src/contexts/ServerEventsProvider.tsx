import React, { useCallback, useMemo, useRef } from 'react';
import { useServerEvents, type ServerEvent, type ServerEventCallback } from '../hooks/useServerEvents.js';
import { ServerEventsContext } from './ServerEventsContext.js';

export function ServerEventsProvider({ children }: { children: React.ReactNode }) {
  const subscribersRef = useRef<Set<ServerEventCallback>>(new Set());

  const handleEvent = useCallback((event: ServerEvent) => {
    for (const callback of subscribersRef.current) {
      try {
        callback(event);
      } catch (err) {
        console.error('Error in SSE event subscriber:', err);
      }
    }
  }, []);

  const { connected, error, reconnecting } = useServerEvents({
    enabled: true,
    onEvent: handleEvent,
  });

  const subscribe = useCallback((callback: ServerEventCallback) => {
    subscribersRef.current.add(callback);
    return () => {
      subscribersRef.current.delete(callback);
    };
  }, []);

  const value = useMemo(() => ({
    connected,
    error,
    reconnecting,
    subscribe,
  }), [connected, error, reconnecting, subscribe]);

  return (
    <ServerEventsContext.Provider value={value}>
      {children}
    </ServerEventsContext.Provider>
  );
}
