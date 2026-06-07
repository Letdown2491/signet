import { useState, useEffect, useCallback, useRef } from 'react';
import type { RelayStatusResponse } from '@signet/types';
import { apiGet, apiPost, apiDelete } from '../lib/api-client.js';
import { buildErrorMessage } from '../lib/formatters.js';
import { useSSESubscription } from '../contexts/ServerEventsContext.js';
import type { ServerEvent } from './useServerEvents.js';

// Refresh relay status every 30 seconds as fallback
const REFRESH_INTERVAL_MS = 30 * 1000;

interface MutationResult {
  ok: boolean;
  error?: string;
}

interface UseRelaysResult {
  relays: RelayStatusResponse | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  addRelay: (url: string) => Promise<MutationResult>;
  removeRelay: (url: string) => Promise<MutationResult>;
  mutating: boolean;
}

export function useRelays(): UseRelaysResult {
  const [relays, setRelays] = useState<RelayStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mutating, setMutating] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await apiGet<RelayStatusResponse>('/relays');
      setRelays(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load relay status');
    } finally {
      setLoading(false);
    }
  }, []);

  const addRelay = useCallback(async (url: string): Promise<MutationResult> => {
    setMutating(true);
    try {
      const data = await apiPost<RelayStatusResponse>('/relays', { url });
      setRelays(data);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: buildErrorMessage(err, 'Failed to add relay') };
    } finally {
      setMutating(false);
    }
  }, []);

  const removeRelay = useCallback(async (url: string): Promise<MutationResult> => {
    setMutating(true);
    try {
      const data = await apiDelete<RelayStatusResponse>('/relays', { url });
      setRelays(data);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: buildErrorMessage(err, 'Failed to remove relay') };
    } finally {
      setMutating(false);
    }
  }, []);

  // Subscribe to SSE events for real-time relay status updates
  const handleEvent = useCallback((event: ServerEvent) => {
    // Refresh data on reconnection to ensure consistency
    if (event.type === 'reconnected') {
      refresh();
      return;
    }

    if (event.type === 'relays:updated') {
      setRelays(event.relays);
      setError(null);
      setLoading(false);
    }
  }, [refresh]);

  useSSESubscription(handleEvent);

  useEffect(() => {
    // Initial fetch
    refresh();

    // Auto-refresh every 30 seconds as fallback
    intervalRef.current = setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [refresh]);

  return { relays, loading, error, refresh, addRelay, removeRelay, mutating };
}
