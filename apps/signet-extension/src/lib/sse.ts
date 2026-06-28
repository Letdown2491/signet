import type { DaemonClient } from './client';

/** SSE event types that can change the pending set, warranting a re-fetch. */
const COUNT_AFFECTING = new Set([
  'request:created',
  'request:approved',
  'request:denied',
  'request:expired',
  'app:connected',
  'app:revoked',
]);

/**
 * Open the daemon SSE stream and invoke `onChange` whenever an event arrives that
 * could change the pending set. Resolves when the stream ends; throws on connect
 * failure so the caller can decide whether to retry. Shared by the background
 * (updates the badge) and the popup (refreshes the live list).
 */
export async function streamPendingChanges(
  client: DaemonClient,
  onChange: () => void | Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  const res = await client.openEvents(signal);
  if (!res.ok || !res.body) throw new Error(`/events responded ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; each carries one `data: {json}`.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
      if (!dataLine) continue;
      try {
        const evt = JSON.parse(dataLine.slice(5).trim());
        if (typeof evt?.type === 'string' && COUNT_AFFECTING.has(evt.type)) await onChange();
      } catch {
        // Ignore parse errors and keep-alive pings.
      }
    }
  }
}
