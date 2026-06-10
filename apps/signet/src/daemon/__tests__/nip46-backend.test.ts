// Regression coverage for the per-peer conversation-key (ECDH) cache added in
// 1.11.0. The optimization memoizes getConversationKey so the inbound path is
// verify-bound rather than ECDH-bound. Because the cached value is *derived key
// material*, two invariants matter beyond raw speed:
//
//   1. Correctness — a cache hit must return the same key a fresh ECDH would, so
//      decryption of requests and encryption of responses stay correct.
//   2. Containment — the cache is dropped on stop()/lock so derived secrets do
//      not linger in memory after a key is locked.
//
// We exercise both directly on the memoization seam and end-to-end through the
// real inbound event path (decrypt request -> route -> encrypt response).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  type Event,
} from 'nostr-tools/pure';
import {
  encrypt as nip44Encrypt,
  decrypt as nip44Decrypt,
  getConversationKey,
} from 'nostr-tools/nip44';

// db.ts instantiates a PrismaClient (and the better-sqlite3 adapter) at import
// time; the backend only touches prisma.keyUser.findUnique on the response path
// (to look up custom relays), so a stub returning null is sufficient.
vi.mock('../../db.js', () => ({
  default: {
    keyUser: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

// services/index.js transitively loads every service (and db). The methods the
// backend pulls from it are only reached by connect/logout, not the flows under
// test, so empty stubs keep the import hermetic.
vi.mock('../services/index.js', () => ({
  getConnectionTokenService: () => ({
    validateAndRedeemToken: vi.fn().mockResolvedValue(false),
  }),
  appService: {
    logoutApp: vi.fn().mockResolvedValue(undefined),
  },
}));

import { Nip46Backend, type PermitCallback } from '../nip46-backend.js';
import { getAllCacheStats } from '../lib/ttl-cache.js';

const NIP46_KIND = 24133;

// Fixtures: a signer (the bunker key) and a client (a connected app).
const signerSecret = generateSecretKey();
const signerPubkey = getPublicKey(signerSecret);
const clientSecret = generateSecretKey();
const clientPubkey = getPublicKey(clientSecret);

// The shared ECDH key (symmetric: signer<->client). Used both to build inbound
// request ciphertext and to decrypt the response the backend publishes.
const sharedKey = getConversationKey(clientSecret, signerPubkey);

interface MockPool {
  subscribe: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  getRelays: ReturnType<typeof vi.fn>;
}

/**
 * Build a backend wired to a mock relay pool. start() registers an onEvent
 * handler via pool.subscribe; we capture it so a test can feed crafted events
 * straight into the real inbound path.
 */
function makeBackend(permit: PermitCallback) {
  let capturedOnEvent: ((event: Event) => void) | undefined;
  const pool: MockPool = {
    subscribe: vi.fn((_filter, onEvent: (event: Event) => void) => {
      capturedOnEvent = onEvent;
      return () => {};
    }),
    publish: vi.fn().mockResolvedValue({ successes: [], failures: [] }),
    getRelays: vi.fn().mockReturnValue([]),
  };

  // Unique key name per backend so each test gets an isolated cache entry in the
  // global registry.
  const keyName = `test-key-${Math.random().toString(36).slice(2)}`;
  const backend = new Nip46Backend({
    keyName,
    nsec: signerSecret,
    // The mock only needs the surface the backend actually calls.
    pool: pool as unknown as never,
    permitCallback: permit,
  });

  const cacheName = `nip46-convkeys:${keyName}`;
  return {
    backend,
    pool,
    cacheName,
    stats: () => getAllCacheStats()[cacheName],
    emit: (event: Event) => {
      if (!capturedOnEvent) throw new Error('start() was not called');
      capturedOnEvent(event);
    },
  };
}

/** A realistic inbound NIP-46 request: kind 24133, NIP-44 sealed, client-signed. */
function buildRequest(method: string, params: string[] = [], id = 'req-1'): Event {
  const payload = JSON.stringify({ id, method, params });
  return finalizeEvent(
    {
      kind: NIP46_KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', signerPubkey]],
      content: nip44Encrypt(payload, sharedKey),
    },
    clientSecret,
  );
}

describe('Nip46Backend conversation-key cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('memoization (direct)', () => {
    it('returns the correct key and serves repeat lookups from cache', () => {
      const { backend, cacheName } = makeBackend(vi.fn().mockResolvedValue(true));
      // conversationKey() is private; this is the seam the optimization added.
      const derive = (pk: string): Uint8Array =>
        (backend as unknown as { conversationKey(p: string): Uint8Array }).conversationKey(pk);

      const expected = getConversationKey(signerSecret, clientPubkey);

      const first = derive(clientPubkey);
      const second = derive(clientPubkey);

      // Correct value...
      expect(Array.from(first)).toEqual(Array.from(expected));
      // ...and a hit returns the very same cached instance (not a re-derivation).
      expect(second).toBe(first);

      const stats = getAllCacheStats()[cacheName];
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBe(1);
    });

    it('keys the cache per peer, not globally', () => {
      const { backend, cacheName } = makeBackend(vi.fn().mockResolvedValue(true));
      const derive = (pk: string): Uint8Array =>
        (backend as unknown as { conversationKey(p: string): Uint8Array }).conversationKey(pk);

      const otherPubkey = getPublicKey(generateSecretKey());
      const a = derive(clientPubkey);
      const b = derive(otherPubkey);

      expect(Array.from(a)).toEqual(Array.from(getConversationKey(signerSecret, clientPubkey)));
      expect(Array.from(b)).toEqual(Array.from(getConversationKey(signerSecret, otherPubkey)));
      expect(Array.from(a)).not.toEqual(Array.from(b));
      expect(getAllCacheStats()[cacheName].misses).toBe(2);
    });
  });

  describe('containment on stop()', () => {
    it('tears down the conversation-key cache when the backend stops (key locked)', () => {
      const { backend, cacheName } = makeBackend(vi.fn().mockResolvedValue(true));
      const derive = (pk: string): Uint8Array =>
        (backend as unknown as { conversationKey(p: string): Uint8Array }).conversationKey(pk);

      backend.start();
      derive(clientPubkey);
      expect(getAllCacheStats()[cacheName].size).toBe(1);

      backend.stop();

      // stop() destroys the cache rather than just clearing it: the derived secret is
      // dropped AND the cache is unregistered from the global stats registry and its
      // cleanup interval is cleared (no leaked timer per lock/unlock). Backends are
      // single-use — the next unlock builds a fresh backend with its own cache — so a
      // gone-from-the-registry entry is the correct post-stop state.
      expect(getAllCacheStats()[cacheName]).toBeUndefined();
    });
  });

  describe('inbound path (end-to-end)', () => {
    it('decrypts a request and encrypts a correct response using the cached key', async () => {
      const permit = vi.fn().mockResolvedValue(true);
      const { backend, pool, cacheName, emit } = makeBackend(permit);
      backend.start();

      emit(buildRequest('get_public_key', [], 'req-1'));

      // handleEvent is async and fire-and-forget from the subscription callback;
      // the response publish is the observable completion point.
      await vi.waitFor(() => expect(pool.publish).toHaveBeenCalledTimes(1));

      // The permit callback saw the decrypted request from the right peer.
      expect(permit).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'get_public_key', pubkey: clientPubkey }),
      );

      // The published response decrypts (with the symmetric shared key) to the
      // expected RPC result — proving the cached key produced correct ciphertext.
      const published = pool.publish.mock.calls[0][0] as Event;
      expect(published.kind).toBe(NIP46_KIND);
      const response = JSON.parse(nip44Decrypt(published.content, sharedKey));
      expect(response).toEqual({ id: 'req-1', result: signerPubkey });

      // One peer touched: a miss on request-decrypt, then a hit on
      // response-encrypt within the same request.
      const stats = getAllCacheStats()[cacheName];
      expect(stats.misses).toBe(1);
      expect(stats.hits).toBeGreaterThanOrEqual(1);
    });

    it('serves a second request from the same peer entirely from cache', async () => {
      const { backend, pool, cacheName, emit } = makeBackend(vi.fn().mockResolvedValue(true));
      backend.start();

      emit(buildRequest('get_public_key', [], 'req-1'));
      await vi.waitFor(() => expect(pool.publish).toHaveBeenCalledTimes(1));

      const missesAfterFirst = getAllCacheStats()[cacheName].misses;

      // Distinct id + content => distinct event id, so dedup/replay guards pass.
      emit(buildRequest('get_public_key', [], 'req-2'));
      await vi.waitFor(() => expect(pool.publish).toHaveBeenCalledTimes(2));

      // No new ECDH derivation for the already-seen peer.
      expect(getAllCacheStats()[cacheName].misses).toBe(missesAfterFirst);

      const second = JSON.parse((pool.publish.mock.calls[1][0] as Event).content
        ? nip44Decrypt((pool.publish.mock.calls[1][0] as Event).content, sharedKey)
        : '{}');
      expect(second).toEqual({ id: 'req-2', result: signerPubkey });
    });
  });

  describe('replay protection (sender high-water mark)', () => {
    // A fresh client per test: the sender watermark is a module-level cache keyed by
    // pubkey, so reusing the shared clientPubkey would inherit watermark state from
    // other tests in this file.
    function freshClient() {
      const secret = generateSecretKey();
      const pubkey = getPublicKey(secret);
      const shared = getConversationKey(secret, signerPubkey);
      const build = (createdAt: number, id: string): Event =>
        finalizeEvent(
          {
            kind: NIP46_KIND,
            created_at: createdAt,
            tags: [['p', signerPubkey]],
            content: nip44Encrypt(JSON.stringify({ id, method: 'get_public_key', params: [] }), shared),
          },
          secret,
        );
      return { build };
    }

    it('rejects a request older than the newest already seen from that sender', async () => {
      const permit = vi.fn().mockResolvedValue(true);
      const { backend, pool, emit } = makeBackend(permit);
      backend.start();

      const { build } = freshClient();
      const now = Math.floor(Date.now() / 1000);

      // First request establishes the watermark at `now`.
      emit(build(now, 'wm-new'));
      await vi.waitFor(() => expect(pool.publish).toHaveBeenCalledTimes(1));
      expect(permit).toHaveBeenCalledTimes(1);

      // A captured older request (still inside the absolute freshness window, but
      // below the watermark minus slack) must be rejected — not signed, not published.
      emit(build(now - 300, 'wm-old'));
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(pool.publish).toHaveBeenCalledTimes(1);
      expect(permit).toHaveBeenCalledTimes(1);
    });

    it('still admits a fresh request at or after the watermark', async () => {
      const permit = vi.fn().mockResolvedValue(true);
      const { backend, pool, emit } = makeBackend(permit);
      backend.start();

      const { build } = freshClient();
      const now = Math.floor(Date.now() / 1000);

      emit(build(now, 'wm-1'));
      await vi.waitFor(() => expect(pool.publish).toHaveBeenCalledTimes(1));

      // Same-second (equal) and slightly-later requests are legitimate and pass.
      emit(build(now, 'wm-2'));
      await vi.waitFor(() => expect(pool.publish).toHaveBeenCalledTimes(2));
      expect(permit).toHaveBeenCalledTimes(2);
    });
  });

  describe('publish failure handling', () => {
    it('does not publish a second frame when the response publish fails (no amplification)', async () => {
      const { backend, pool, emit } = makeBackend(vi.fn().mockResolvedValue(true));
      // Simulate a total publish failure (every relay rejected the response).
      pool.publish.mockRejectedValue(new Error('Failed to publish to any relay: rate limited'));
      backend.start();

      emit(buildRequest('get_public_key', [], 'req-amp'));
      await vi.waitFor(() => expect(pool.publish).toHaveBeenCalledTimes(1));

      // Before the fix, the failed response publish triggered a *second* publish
      // (an error frame). Give any such follow-up a chance to fire, then assert
      // it never did — exactly one publish attempt per request.
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(pool.publish).toHaveBeenCalledTimes(1);
    });
  });
});
