import { createContext, useContext, useEffect } from 'react';
import { type ServerEventCallback } from '../hooks/useServerEvents.js';

interface ServerEventsContextType {
  connected: boolean;
  error: string | null;
  reconnecting: boolean;
  subscribe: (callback: ServerEventCallback) => () => void;
}

export const ServerEventsContext = createContext<ServerEventsContextType | null>(null);

export function useServerEventsContext() {
  const context = useContext(ServerEventsContext);
  if (!context) {
    throw new Error('useServerEventsContext must be used within a ServerEventsProvider');
  }
  return context;
}

/**
 * Hook to subscribe to SSE events with automatic cleanup
 */
export function useSSESubscription(callback: ServerEventCallback) {
  const { subscribe } = useServerEventsContext();

  useEffect(() => {
    return subscribe(callback);
  }, [subscribe, callback]);
}
