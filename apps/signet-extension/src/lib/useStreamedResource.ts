import { useCallback, useEffect, useRef, useState } from 'react';
import type { DaemonClient } from './client';
import { describeError } from './errors';
import { streamPendingChanges } from './sse';

interface StreamedResource<T> {
  data: T | null;
  error: string | null;
  refresh: () => Promise<void>;
  setError: (error: string | null) => void;
}

/**
 * Fetch a resource from the daemon and keep it live: loads once, then re-runs
 * `load` whenever the daemon's SSE stream signals a request/app change. This is
 * the subscribe-then-refetch pattern shared by the Pending, Activity, and Apps
 * tabs. `load` is held in a ref, so passing a fresh closure each render does not
 * re-subscribe — the stream is torn down only when `client` changes or unmount.
 */
export function useStreamedResource<T>(
  client: DaemonClient,
  load: (client: DaemonClient) => Promise<T>,
): StreamedResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadRef = useRef(load);
  loadRef.current = load;

  const refresh = useCallback(async () => {
    try {
      setData(await loadRef.current(client));
      setError(null);
    } catch (e) {
      setError(describeError(e));
    }
  }, [client]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh();
    void (async () => {
      try {
        await streamPendingChanges(client, refresh, controller.signal);
      } catch {
        // Stream dropped; keep last-fetched data.
      }
    })();
    return () => controller.abort();
  }, [client, refresh]);

  return { data, error, refresh, setError };
}
