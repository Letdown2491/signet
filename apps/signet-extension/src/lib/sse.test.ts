import { describe, expect, it } from 'vitest';
import type { DaemonClient } from './client';
import { streamPendingChanges } from './sse';

function clientFromChunks(chunks: string[]): DaemonClient {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return { openEvents: async () => new Response(body, { status: 200 }) } as unknown as DaemonClient;
}

describe('streamPendingChanges', () => {
  it('fires onChange only for count-affecting events', async () => {
    const chunks = [
      'data: {"type":"connected"}\n\n',
      'data: {"type":"ping"}\n\n',
      'data: {"type":"request:created"}\n\n',
      'data: {"type":"request:approved"}\n\n',
      'data: {"type":"stats:updated"}\n\n',
      'data: {"type":"app:connected"}\n\n',
    ];
    let n = 0;
    await streamPendingChanges(clientFromChunks(chunks), () => void n++, new AbortController().signal);
    expect(n).toBe(3); // created, approved, app:connected (not connected/ping/stats)
  });

  it('reassembles a frame split across chunks', async () => {
    const chunks = ['data: {"type":"requ', 'est:created"}\n\n', 'data: {"type":"ping"}\n\n'];
    let n = 0;
    await streamPendingChanges(clientFromChunks(chunks), () => void n++, new AbortController().signal);
    expect(n).toBe(1);
  });

  it('ignores malformed data lines', async () => {
    const chunks = ['data: not json\n\n', 'data: {"type":"request:denied"}\n\n'];
    let n = 0;
    await streamPendingChanges(clientFromChunks(chunks), () => void n++, new AbortController().signal);
    expect(n).toBe(1);
  });

  it('throws on a non-ok response', async () => {
    const client = {
      openEvents: async () => new Response(null, { status: 401 }),
    } as unknown as DaemonClient;
    await expect(
      streamPendingChanges(client, () => {}, new AbortController().signal),
    ).rejects.toThrow();
  });
});
