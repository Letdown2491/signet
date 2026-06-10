// Regression coverage for the global pending-authorization cap. An unauthenticated
// `connect` flood from rotating pubkeys would otherwise grow memory/timers and amplify
// relay traffic without bound (each pending auth holds a polling promise + expiry timer
// and publishes an auth_url). The cap rejects new authorizations once the ceiling is hit
// and releases the slot when one completes.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// A mutable holder the db mock reads, so a test can switch between "decision pending"
// (auth hangs) and "approved" (auth completes).
const h = vi.hoisted(() => ({ decision: { allowed: null as boolean | null, params: undefined as string | undefined } }));

vi.mock('../../db.js', () => ({
  default: {
    request: {
      create: vi.fn(async () => ({
        id: `rid-${Math.random().toString(36).slice(2)}`,
        createdAt: new Date(),
        keyName: 'k',
        method: 'connect',
        remotePubkey: 'p',
        params: null,
        KeyUser: null,
      })),
      findUnique: vi.fn(async () => h.decision),
    },
  },
}));

vi.mock('../services/index.js', () => ({
  getEventService: () => ({ emitRequestCreated: vi.fn(), emitRequestExpired: vi.fn() }),
  emitCurrentStats: vi.fn(async () => {}),
}));

import { requestAuthorization } from '../authorize.js';
import { MAX_PENDING_AUTHORIZATIONS } from '../constants.js';

function mockConnectionManager() {
  return {
    config: vi.fn(async () => ({ baseUrl: 'http://localhost' })),
    ensureConnected: vi.fn(async () => {}),
    sendResponse: vi.fn(async () => {}),
  } as unknown as Parameters<typeof requestAuthorization>[0];
}

describe('requestAuthorization pending cap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('completes a normal authorization and releases its slot', async () => {
    h.decision = { allowed: true, params: 'signed' };
    const cm = mockConnectionManager();
    const result = await requestAuthorization(cm, 'k', 'p', 'rid-ok', 'connect');
    expect(result).toBe('signed');
  });

  it('rejects new authorizations once the concurrent pending limit is reached', async () => {
    h.decision = { allowed: null, params: undefined }; // never decided -> auth stays pending
    const cm = mockConnectionManager();
    const hanging: Promise<unknown>[] = [];

    // Each call increments the pending counter synchronously (before its first await),
    // so after this loop the cap is exactly reached. The calls then hang in the poll
    // loop (findUnique reports no decision; fake timers keep the poll from advancing).
    for (let i = 0; i < MAX_PENDING_AUTHORIZATIONS; i++) {
      hanging.push(requestAuthorization(cm, 'k', `pubkey-${i}`, `rid-${i}`, 'connect').catch(() => {}));
    }

    await expect(
      requestAuthorization(cm, 'k', 'over', 'rid-over', 'connect'),
    ).rejects.toThrow(/too many pending/i);

    // The flood never published an auth_url for the rejected request (admission control
    // happens before persistRequest / sendResponse).
    expect((cm as unknown as { sendResponse: ReturnType<typeof vi.fn> }).sendResponse)
      .toHaveBeenCalledTimes(MAX_PENDING_AUTHORIZATIONS);

    void hanging;
  });
});
