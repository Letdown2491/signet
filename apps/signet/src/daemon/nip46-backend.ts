import crypto from 'crypto';
import { finalizeEvent, verifyEvent, getPublicKey, type Event } from 'nostr-tools/pure';
import { npubEncode } from 'nostr-tools/nip19';
import { encrypt as nip44Encrypt, decrypt as nip44Decrypt, getConversationKey } from 'nostr-tools/nip44';
import { encrypt as nip04Encrypt, decrypt as nip04Decrypt } from 'nostr-tools/nip04';
import createDebug from 'debug';
import { bytesToHex } from './lib/hex.js';
import { toErrorMessage } from './lib/errors.js';
import { logger } from './lib/logger.js';
import { TTLCache } from './lib/ttl-cache.js';
import { AppRateLimiter } from './lib/app-rate-limiter.js';
import {
    NIP46_APP_RATE_REFILL_PER_SEC,
    NIP46_APP_RATE_BURST,
    NIP46_APP_RATE_MAX_DELAY_MS,
} from './constants.js';
import prisma from '../db.js';
import type { RelayPool } from './lib/relay-pool.js';
import type { SubscriptionManager } from './lib/subscription-manager.js';
import { getConnectionTokenService, appService } from './services/index.js';

const debug = createDebug('signet:nip46');

// Deduplication cache: track processed event IDs to avoid reprocessing
// Events can be delivered multiple times (relay reconnect, subscription refresh)
// TTL of 10 minutes covers typical health check cycles with margin
const PROCESSED_EVENTS_TTL_MS = 10 * 60 * 1000;
const PROCESSED_EVENTS_MAX_SIZE = 5000;

// Replay freshness window. NIP-46 requests are interactive and short-lived, so we
// reject events whose created_at is implausibly old or in the future. The absolute
// max age is the first replay gate; future drift tolerates client clock skew.
const MAX_EVENT_AGE_SEC = PROCESSED_EVENTS_TTL_MS / 1000;
const MAX_FUTURE_DRIFT_SEC = 120;
const processedEvents = new TTLCache<true>('nip46-processed-events', {
    ttlMs: PROCESSED_EVENTS_TTL_MS,
    maxSize: PROCESSED_EVENTS_MAX_SIZE,
});

// Per-sender high-water mark of the newest created_at seen. This is a second replay
// gate that does not depend on the dedup cache retaining the event id: even if an
// attacker floods the (bounded, LRU) dedup cache to evict a captured request's id and
// replays it within the freshness window, the replay is rejected once the same app has
// sent any newer request. The slack tolerates clock skew / out-of-order relay delivery.
// It can't be abused across apps (the watermark is keyed by the signature-verified
// sender pubkey), and the only false positive is self-inflicted: a single client whose
// clock jumps backward by more than the slack within the window would have one request
// rejected until the watermark ages out.
const REPLAY_WATERMARK_SLACK_SEC = 60;
const senderWatermark = new TTLCache<number>('nip46-sender-watermark', {
    ttlMs: PROCESSED_EVENTS_TTL_MS,
    maxSize: PROCESSED_EVENTS_MAX_SIZE,
});

// Conversation-key (ECDH) cache. getConversationKey is by far the most expensive
// step of NIP-44 decryption (~1.9ms ECDH vs ~20us symmetric decrypt), and the
// key is a pure function of (our nsec, remote pubkey) — so it's identical for
// every request from a given peer. Memoizing it makes the inbound path roughly
// verify-bound instead of ECDH-bound. Bounded so a flood of validly-signed
// events from throwaway pubkeys can't grow it without limit.
const CONV_KEY_CACHE_TTL_MS = 30 * 60 * 1000;
const CONV_KEY_CACHE_MAX_SIZE = 2000;

// Per-app custom-relay cache: avoids a DB lookup on every outbound response just to
// fetch an app's nostrconnect relays. An app's relays change only on (re)connect,
// where we prime this cache directly, so it is effectively never stale; the TTL is a
// safety bound and a miss falls back to the DB (the source of truth).
const APP_RELAY_CACHE_TTL_MS = 5 * 60 * 1000;
const APP_RELAY_CACHE_MAX_SIZE = 2000;

type Nip46Method =
    | 'connect'
    | 'sign_event'
    | 'get_public_key'
    | 'nip04_encrypt' | 'nip04_decrypt'
    | 'nip44_encrypt' | 'nip44_decrypt'
    | 'ping'
    | 'switch_relays'
    | 'logout';

interface Nip46Request {
    id: string;
    method: Nip46Method;
    params: string[];
}

interface Nip46Response {
    id: string;
    result?: string;
    error?: string;
}

export interface PermitCallbackParams {
    id: string;
    method: Nip46Method;
    pubkey: string;
    params?: string[];
}

export type PermitCallback = (params: PermitCallbackParams) => Promise<boolean>;

export interface Nip46BackendConfig {
    keyName: string;
    nsec: Uint8Array;          // 32-byte secret key
    pool: RelayPool;
    subscriptionManager?: SubscriptionManager;
    permitCallback: PermitCallback;
    adminSecret?: string;
}

/**
 * NIP-46 Remote Signer Backend using nostr-tools.
 * Handles incoming signing requests and responds via Nostr relays.
 */
export class Nip46Backend {
    public readonly keyName: string;
    public readonly pubkey: string;

    private readonly nsec: Uint8Array;
    private readonly pool: RelayPool;
    private readonly subscriptionManager?: SubscriptionManager;
    private readonly permitCallback: PermitCallback;
    private readonly adminSecret?: string;

    private unsubscribe?: () => void;
    private isRunning = false;

    // Per-peer ECDH conversation-key cache (see CONV_KEY_CACHE_* above).
    private readonly convKeyCache: TTLCache<Uint8Array>;

    // Per-app (per remote pubkey) request throttle so one client can't saturate
    // the shared relays for every other app on this key.
    private readonly appRateLimiter: AppRateLimiter;

    // Per-app subscriptions for nostrconnect apps with custom relays
    private readonly appSubscriptions: Map<number, () => void> = new Map();

    // Per-app (per remote pubkey) custom relay list cache (see APP_RELAY_CACHE_* above).
    private readonly appRelayCache: TTLCache<string[]>;

    constructor(config: Nip46BackendConfig) {
        this.keyName = config.keyName;
        this.nsec = config.nsec;
        this.pubkey = getPublicKey(this.nsec);
        this.pool = config.pool;
        this.subscriptionManager = config.subscriptionManager;
        this.permitCallback = config.permitCallback;
        this.adminSecret = config.adminSecret;
        // Unique name per backend so each key's cache is tracked/cleaned
        // independently in the shared cache registry.
        this.convKeyCache = new TTLCache<Uint8Array>(`nip46-convkeys:${this.keyName}`, {
            ttlMs: CONV_KEY_CACHE_TTL_MS,
            maxSize: CONV_KEY_CACHE_MAX_SIZE,
        });
        this.appRateLimiter = new AppRateLimiter({
            name: `nip46-apprate:${this.keyName}`,
            refillPerSec: NIP46_APP_RATE_REFILL_PER_SEC,
            burst: NIP46_APP_RATE_BURST,
            maxDelayMs: NIP46_APP_RATE_MAX_DELAY_MS,
        });
        this.appRelayCache = new TTLCache<string[]>(`nip46-apprelays:${this.keyName}`, {
            ttlMs: APP_RELAY_CACHE_TTL_MS,
            maxSize: APP_RELAY_CACHE_MAX_SIZE,
        });
    }

    /**
     * Return the NIP-44 conversation key for a peer, memoizing the expensive
     * ECDH derivation. The key is constant for a given (nsec, pubkey) pair.
     */
    private conversationKey(pubkey: string): Uint8Array {
        const cached = this.convKeyCache.get(pubkey);
        if (cached) {
            return cached;
        }
        const key = getConversationKey(this.nsec, pubkey);
        this.convKeyCache.set(pubkey, key);
        return key;
    }

    /**
     * Start listening for NIP-46 requests.
     */
    public start(): void {
        if (this.isRunning) {
            logger.warn('Backend already running', { key: this.keyName });
            return;
        }

        const npub = npubEncode(this.pubkey);
        logger.info('Starting NIP-46 backend', { key: this.keyName, npub });

        const subscriptionId = `nip46-${this.keyName}`;
        const filter = {
            kinds: [24133],
            '#p': [this.pubkey],
        };
        const onEvent = (event: Event) => {
            this.handleEvent(event).catch((err) => {
                logger.error('Error handling event', { key: this.keyName, error: toErrorMessage(err) });
            });
        };

        // Use SubscriptionManager if available (provides auto-reconnect after sleep)
        // Otherwise fall back to direct pool subscription
        if (this.subscriptionManager) {
            this.unsubscribe = this.subscriptionManager.subscribe(subscriptionId, filter, onEvent);
            debug('[%s] using managed subscription', this.keyName);
        } else {
            this.unsubscribe = this.pool.subscribe(filter, onEvent, subscriptionId);
            debug('[%s] using direct pool subscription', this.keyName);
        }

        this.isRunning = true;
        logger.info('NIP-46 subscription active', { key: this.keyName });
    }

    /**
     * Stop the backend.
     */
    public stop(): void {
        if (!this.isRunning) {
            return;
        }

        logger.info('Stopping NIP-46 backend', { key: this.keyName });

        // Clean up main subscription
        this.unsubscribe?.();

        // Clean up all per-app subscriptions
        for (const [appId, cleanup] of this.appSubscriptions) {
            debug('[%s] cleaning up app subscription %d', this.keyName, appId);
            cleanup();
        }
        this.appSubscriptions.clear();

        // Destroy the per-backend caches: clears cached conversation keys (so derived
        // secrets don't linger after the key is locked) AND stops each cache's cleanup
        // interval. A fresh Nip46Backend is created on the next unlock, so these
        // instances are single-use — destroying avoids leaking an interval (and the
        // cache object its closure pins) on every lock/unlock cycle.
        this.convKeyCache.destroy();
        this.appRateLimiter.destroy();
        this.appRelayCache.destroy();

        this.isRunning = false;
    }

    /**
     * Add a subscription for an app's custom relays.
     * This allows apps connected via nostrconnect:// to send requests
     * through their specified relays.
     *
     * @param appId - The KeyUser ID
     * @param relays - The app's relay URLs
     */
    public addAppSubscription(appId: number, relays: string[]): void {
        if (!this.subscriptionManager) {
            debug('[%s] no subscription manager, skipping app subscription', this.keyName);
            return;
        }

        // Skip if no custom relays
        if (!relays || relays.length === 0) {
            debug('[%s] no relays for app %d, skipping subscription', this.keyName, appId);
            return;
        }

        // Skip relays that are already in the pool
        const poolRelays = new Set(this.pool.getRelays());
        const uniqueRelays = relays.filter(r => !poolRelays.has(r));

        if (uniqueRelays.length === 0) {
            debug('[%s] app %d relays already covered by pool, skipping', this.keyName, appId);
            return;
        }

        // Clean up existing subscription if any
        this.removeAppSubscription(appId);

        const subscriptionId = `nip46-${this.keyName}-app-${appId}`;
        const filter = {
            kinds: [24133],
            '#p': [this.pubkey],
        };

        logger.info('Creating app subscription', { key: this.keyName, appId, relayCount: uniqueRelays.length });

        const cleanup = this.subscriptionManager.subscribe(
            subscriptionId,
            filter,
            (event) => {
                this.handleEvent(event).catch((err) => {
                    logger.error('Error handling event from app relay', { key: this.keyName, error: toErrorMessage(err) });
                });
            },
            uniqueRelays
        );

        this.appSubscriptions.set(appId, cleanup);
        debug('[%s] created app subscription %d with %d relays', this.keyName, appId, uniqueRelays.length);
    }

    /**
     * Remove an app's subscription.
     * Called when an app is revoked.
     *
     * @param appId - The KeyUser ID
     */
    public removeAppSubscription(appId: number): void {
        const cleanup = this.appSubscriptions.get(appId);
        if (cleanup) {
            debug('[%s] removing app subscription %d', this.keyName, appId);
            cleanup();
            this.appSubscriptions.delete(appId);
            logger.info('Removed app subscription', { key: this.keyName, appId });
        }
    }

    /**
     * Handle an incoming NIP-46 request event.
     */
    private async handleEvent(event: Event): Promise<void> {
        // Deduplicate: skip events we've already processed
        // This happens when subscriptions are refreshed (health checks) and relays
        // redeliver historical events
        if (processedEvents.has(event.id)) {
            debug('[%s] skipping duplicate event %s', this.keyName, event.id.slice(0, 8));
            return;
        }

        // Verify signature
        if (!verifyEvent(event)) {
            debug('[%s] invalid signature, ignoring', this.keyName);
            return;
        }

        // Reject stale or future-dated events (replay protection that survives
        // dedup-cache eviction).
        const nowSec = Math.floor(Date.now() / 1000);
        if (event.created_at > nowSec + MAX_FUTURE_DRIFT_SEC ||
            event.created_at < nowSec - MAX_EVENT_AGE_SEC) {
            debug('[%s] rejecting event %s with stale/future created_at %d',
                this.keyName, event.id.slice(0, 8), event.created_at);
            return;
        }

        // Second replay gate: reject events older than the newest one already seen from
        // this sender (minus slack). Survives dedup-cache eviction (see senderWatermark).
        const watermark = senderWatermark.get(event.pubkey);
        if (watermark !== undefined && event.created_at < watermark - REPLAY_WATERMARK_SLACK_SEC) {
            debug('[%s] rejecting event %s below sender watermark (%d < %d)',
                this.keyName, event.id.slice(0, 8), event.created_at, watermark);
            return;
        }
        if (watermark === undefined || event.created_at > watermark) {
            senderWatermark.set(event.pubkey, event.created_at);
        }

        // Mark as processed BEFORE we handle it (and before any throttle delay
        // below) so relay redelivery can't double-process this event.
        processedEvents.set(event.id, true);

        // Per-app pacing: smooth or shed bursts from a single connected app so one
        // client can't saturate the shared relays for everyone on this key.
        // tryAcquire may delay briefly; it returns false only when the app is so
        // far over budget that the request is shed rather than queued.
        const allowed = await this.appRateLimiter.tryAcquire(event.pubkey);
        if (!allowed) {
            debug('[%s] shedding over-rate request from %s', this.keyName, npubEncode(event.pubkey));
            logger.warn('Rate-limiting NIP-46 app', { key: this.keyName, from: npubEncode(event.pubkey) });
            return;
        }

        // Decrypt and parse request
        const request = this.decryptRequest(event);
        if (!request) {
            return;
        }

        const { id, method, params } = request;
        const remotePubkey = event.pubkey;

        const humanPubkey = npubEncode(remotePubkey);
        debug('[%s] request %s: %s from %s', this.keyName, id, method, humanPubkey);
        logger.info('NIP-46 request', { key: this.keyName, requestId: id, method, from: humanPubkey });

        try {
            const result = await this.handleMethod(id, method, params, remotePubkey);

            // Publish failures are swallowed (and logged) by publishOutcome so a
            // failed publish never triggers a *second* publish. Under a relay
            // rate-limit storm that amplification is exactly what we must avoid.
            if (result !== undefined) {
                await this.publishOutcome(id, 'response', () => this.sendResponse(id, remotePubkey, result));
            } else {
                await this.publishOutcome(id, 'authorization error', () => this.sendError(id, remotePubkey, 'Not authorized'));
            }
        } catch (err) {
            // A method-level failure (parse/validation/etc.) — surface a single
            // generic error frame (internal details stay server-side only).
            const message = toErrorMessage(err);
            logger.error('Error handling NIP-46 method', { key: this.keyName, method, error: message });
            await this.publishOutcome(id, 'error', () => this.sendError(id, remotePubkey, 'Request failed'));
        }
    }

    /**
     * Publish a response/error frame, swallowing any publish failure with a
     * warning instead of letting it bubble up and trigger a second publish.
     * When the relays are rate-limiting us, retrying the publish (or sending an
     * error frame that also can't get through) only deepens the storm.
     */
    private async publishOutcome(requestId: string, kind: string, send: () => Promise<void>): Promise<void> {
        try {
            await send();
        } catch (err) {
            logger.warn('Failed to publish NIP-46 ' + kind, {
                key: this.keyName,
                requestId,
                error: toErrorMessage(err),
            });
        }
    }

    /**
     * Decrypt an incoming NIP-46 request.
     */
    private decryptRequest(event: Event): Nip46Request | null {
        try {
            const conversationKey = this.conversationKey(event.pubkey);
            const decrypted = nip44Decrypt(event.content, conversationKey);
            return JSON.parse(decrypted) as Nip46Request;
        } catch (err) {
            debug('[%s] failed to decrypt request: %s', this.keyName, err);
            return null;
        }
    }

    /**
     * Route request to appropriate handler.
     */
    private async handleMethod(
        id: string,
        method: Nip46Method,
        params: string[],
        remotePubkey: string
    ): Promise<string | undefined> {
        // Special handling for connect with secret
        if (method === 'connect') {
            return this.handleConnect(id, params, remotePubkey);
        }

        // switch_relays: return signer's preferred relays (no permission required, but must be connected)
        if (method === 'switch_relays') {
            return this.handleSwitchRelays(remotePubkey);
        }

        // logout: client ends its own session (self-scoped, no permission required)
        if (method === 'logout') {
            return this.handleLogout(id, remotePubkey);
        }

        // Check permissions via callback
        const permitted = await this.permitCallback({
            id,
            method,
            pubkey: remotePubkey,
            params,
        });

        if (!permitted) {
            return undefined; // Will send "Not authorized"
        }

        // Dispatch to method handlers
        switch (method) {
            case 'get_public_key':
                return this.pubkey;

            case 'sign_event':
                return this.handleSignEvent(params);

            case 'nip44_encrypt':
                return this.handleNip44Encrypt(params);

            case 'nip44_decrypt':
                return this.handleNip44Decrypt(params);

            case 'nip04_encrypt':
                return this.handleNip04Encrypt(params);

            case 'nip04_decrypt':
                return this.handleNip04Decrypt(params);

            case 'ping':
                return 'pong';

            default:
                throw new Error(`Unsupported method: ${method}`);
        }
    }

    /**
     * Handle connect request with secret validation.
     * Validates against one-time connection tokens first, then falls back to admin secret.
     * Secret validates the connection attempt but does NOT auto-approve.
     * User must still approve and select trust level via the UI.
     */
    private async handleConnect(
        id: string,
        params: string[],
        remotePubkey: string
    ): Promise<string | undefined> {
        // params[0] is the remote-signer pubkey the client intends to connect to.
        // Reject mismatches as defense-in-depth (events are already #p-filtered to us).
        const targetPubkey = params[0];
        if (targetPubkey && targetPubkey !== this.pubkey) {
            debug('[%s] connect targeting a different signer pubkey, ignoring', this.keyName);
            return undefined;
        }

        const providedSecret = params[1];
        const humanPubkey = npubEncode(remotePubkey);

        if (providedSecret) {
            // First, try to validate as a one-time connection token
            const tokenService = getConnectionTokenService();
            const tokenValid = await tokenService.validateAndRedeemToken(providedSecret, this.keyName);

            if (tokenValid) {
                debug('[%s] connect with valid one-time token from %s', this.keyName, humanPubkey);
            } else if (this.adminSecret) {
                // Fallback: check against persistent admin secret
                const secretsMatch = providedSecret.length === this.adminSecret.length &&
                    crypto.timingSafeEqual(Buffer.from(providedSecret), Buffer.from(this.adminSecret));

                if (!secretsMatch) {
                    debug('[%s] connect with invalid secret from %s', this.keyName, humanPubkey);
                    return undefined; // Silent rejection - no response sent
                }
                debug('[%s] connect with valid admin secret from %s', this.keyName, humanPubkey);
            } else {
                // No admin secret configured and token was invalid
                debug('[%s] connect with invalid token from %s (no admin secret fallback)', this.keyName, humanPubkey);
                return undefined; // Silent rejection
            }
        }
        // If no secret provided, proceed to approval flow (existing behavior)

        // All connect requests go through the normal approval flow
        // This allows the user to see the request and select a trust level
        logger.info('Connect request, awaiting approval', { key: this.keyName, from: humanPubkey });
        const permitted = await this.permitCallback({
            id,
            method: 'connect',
            pubkey: remotePubkey,
            params,
        });
        return permitted ? 'ack' : undefined;
    }

    /**
     * Handle switch_relays request.
     * Returns the signer's preferred relay list if the client is connected,
     * otherwise returns undefined (not authorized).
     * See: https://github.com/nostr-protocol/nips/pull/2193
     */
    private async handleSwitchRelays(remotePubkey: string): Promise<string | undefined> {
        // Check if client has an active connection (KeyUser record)
        const keyUser = await prisma.keyUser.findUnique({
            where: {
                unique_key_user: {
                    keyName: this.keyName,
                    userPubkey: remotePubkey,
                },
            },
            select: { revokedAt: true, suspendedAt: true, suspendUntil: true },
        });

        if (!keyUser) {
            debug('[%s] switch_relays: no connection found for %s', this.keyName, npubEncode(remotePubkey));
            return undefined;
        }

        // Don't respond to revoked or currently-suspended apps.
        const suspended = keyUser.suspendedAt !== null &&
            (keyUser.suspendUntil === null || keyUser.suspendUntil.getTime() > Date.now());
        if (keyUser.revokedAt !== null || suspended) {
            debug('[%s] switch_relays: connection revoked/suspended for %s', this.keyName, npubEncode(remotePubkey));
            return undefined;
        }

        const relays = this.pool.getRelays();
        debug('[%s] switch_relays: returning %d relays', this.keyName, relays.length);
        return JSON.stringify(relays);
    }

    /**
     * Handle logout request: the client signals it no longer needs the session.
     * We revoke the corresponding KeyUser so further requests from this
     * client-pubkey are denied until a new connect re-establishes a session.
     *
     * This is a self-scoped courtesy action — the target is always derived from
     * the request's pubkey, never from params — so it requires no approval.
     * Per the spec it is advisory (not a security boundary): we ack regardless,
     * and re-acking is harmless if there is no active session to remove.
     */
    private async handleLogout(id: string, remotePubkey: string): Promise<string> {
        const keyUser = await prisma.keyUser.findUnique({
            where: {
                unique_key_user: {
                    keyName: this.keyName,
                    userPubkey: remotePubkey,
                },
            },
            select: { id: true, revokedAt: true },
        });

        if (keyUser && keyUser.revokedAt === null) {
            debug('[%s] logout: revoking session for %s', this.keyName, npubEncode(remotePubkey));
            // logoutApp writes the audit entry then revokes (DB revoke + ACL
            // cache invalidation + subscription cleanup + app:revoked SSE).
            await appService.logoutApp(keyUser.id, id, this.keyName, remotePubkey);
        } else {
            debug('[%s] logout: no active session for %s', this.keyName, npubEncode(remotePubkey));
        }

        return 'ack';
    }

    /**
     * Sign an event.
     */
    private handleSignEvent(params: string[]): string {
        const eventJson = params[0];
        if (!eventJson) {
            throw new Error('Missing event to sign');
        }

        const unsigned = JSON.parse(eventJson);
        const signed = finalizeEvent(unsigned, this.nsec);
        return JSON.stringify(signed);
    }

    /**
     * NIP-44 encrypt for third party.
     */
    private handleNip44Encrypt(params: string[]): string {
        const [thirdPartyPubkey, plaintext] = params;
        if (!thirdPartyPubkey || !plaintext) {
            throw new Error('Missing parameters for nip44_encrypt');
        }
        const conversationKey = this.conversationKey(thirdPartyPubkey);
        return nip44Encrypt(plaintext, conversationKey);
    }

    /**
     * NIP-44 decrypt from third party.
     */
    private handleNip44Decrypt(params: string[]): string {
        const [thirdPartyPubkey, ciphertext] = params;
        if (!thirdPartyPubkey || !ciphertext) {
            throw new Error('Missing parameters for nip44_decrypt');
        }
        const conversationKey = this.conversationKey(thirdPartyPubkey);
        return nip44Decrypt(ciphertext, conversationKey);
    }

    /**
     * NIP-04 encrypt for third party.
     */
    private async handleNip04Encrypt(params: string[]): Promise<string> {
        const [thirdPartyPubkey, plaintext] = params;
        if (!thirdPartyPubkey || !plaintext) {
            throw new Error('Missing parameters for nip04_encrypt');
        }
        const privkeyHex = bytesToHex(this.nsec);
        return nip04Encrypt(privkeyHex, thirdPartyPubkey, plaintext);
    }

    /**
     * NIP-04 decrypt from third party.
     */
    private async handleNip04Decrypt(params: string[]): Promise<string> {
        const [thirdPartyPubkey, ciphertext] = params;
        if (!thirdPartyPubkey || !ciphertext) {
            throw new Error('Missing parameters for nip04_decrypt');
        }
        const privkeyHex = bytesToHex(this.nsec);
        return nip04Decrypt(privkeyHex, thirdPartyPubkey, ciphertext);
    }

    /**
     * Send a success response.
     */
    private async sendResponse(id: string, remotePubkey: string, result: string): Promise<void> {
        const response: Nip46Response = { id, result };
        await this.sendEncryptedResponse(remotePubkey, response);
    }

    /**
     * Send an error response.
     */
    private async sendError(id: string, remotePubkey: string, error: string): Promise<void> {
        const response: Nip46Response = { id, result: 'error', error };
        await this.sendEncryptedResponse(remotePubkey, response);
    }

    /**
     * Prime (or overwrite) the cached custom relay list for an app. Called when an
     * app connects via nostrconnect, where the relays are set/changed — so the cache
     * never serves a stale list for the path that mutates it.
     */
    public setAppRelays(remotePubkey: string, relays: string[]): void {
        this.appRelayCache.set(remotePubkey, relays);
    }

    /**
     * Get an app's custom (nostrconnect) relays, caching the DB lookup so we don't hit
     * the database on every outbound response. Returns [] for bunker apps (no custom
     * relays). A transient DB error is not cached.
     */
    private async getAppRelays(remotePubkey: string): Promise<string[]> {
        const cached = this.appRelayCache.get(remotePubkey);
        if (cached !== undefined) {
            return cached;
        }

        let relays: string[] = [];
        try {
            const keyUser = await prisma.keyUser.findUnique({
                where: {
                    unique_key_user: {
                        keyName: this.keyName,
                        userPubkey: remotePubkey,
                    },
                },
                select: { nostrconnectRelays: true },
            });
            if (keyUser?.nostrconnectRelays) {
                const parsed = JSON.parse(keyUser.nostrconnectRelays);
                if (Array.isArray(parsed)) {
                    relays = parsed;
                }
            }
        } catch (err) {
            debug('[%s] failed to lookup app relays: %s', this.keyName, (err as Error).message);
            return relays; // don't cache a transient failure
        }

        this.appRelayCache.set(remotePubkey, relays);
        return relays;
    }

    /**
     * Encrypt and publish a response.
     * Publishes to both pool relays and any custom relays the app connected with.
     */
    private async sendEncryptedResponse(remotePubkey: string, response: Nip46Response): Promise<void> {
        // Encrypt with NIP-44
        const conversationKey = this.conversationKey(remotePubkey);
        const encrypted = nip44Encrypt(JSON.stringify(response), conversationKey);

        // Create and sign event
        const event = finalizeEvent({
            kind: 24133,
            content: encrypted,
            tags: [['p', remotePubkey]],
            created_at: Math.floor(Date.now() / 1000),
        }, this.nsec);

        debug('[%s] sending response %s to %s', this.keyName, response.id, npubEncode(remotePubkey));

        // Look up app's custom relays (if connected via nostrconnect), cached to avoid
        // a DB round-trip on every response.
        const appRelays = await this.getAppRelays(remotePubkey);

        // Publish to pool relays first
        await this.pool.publish(event);

        // If app has custom relays not in pool, also publish there
        if (appRelays.length > 0) {
            const poolRelays = new Set(this.pool.getRelays());
            const uniqueAppRelays = appRelays.filter(r => !poolRelays.has(r));

            if (uniqueAppRelays.length > 0) {
                debug('[%s] also publishing to %d app-specific relays', this.keyName, uniqueAppRelays.length);
                try {
                    await this.pool.publish(event, uniqueAppRelays);
                } catch (err) {
                    // Log but don't fail - we already published to pool relays
                    debug('[%s] failed to publish to app relays: %s', this.keyName, (err as Error).message);
                }
            }
        }
    }

    /**
     * Apply a token to grant permissions to a remote pubkey.
     * This is used for token-based authorization flow.
     *
     * Uses atomic token claiming to prevent race conditions where
     * two requests could redeem the same token simultaneously.
     */
    public async applyToken(remotePubkey: string, token: string): Promise<void> {
        // Validate token exists and get its data
        const record = await this.fetchTokenRecord(token);

        // Atomically claim the token - only succeeds if redeemedAt is still null
        // This prevents race conditions where two requests pass validation simultaneously
        const claimed = await prisma.token.updateMany({
            where: {
                id: record.id,
                redeemedAt: null, // Only claim if not already redeemed
            },
            data: {
                redeemedAt: new Date(),
            },
        });

        if (claimed.count === 0) {
            throw new Error('Token already redeemed');
        }

        // Token successfully claimed - now create permissions
        try {
            const keyUser = await prisma.keyUser.upsert({
                where: { unique_key_user: { keyName: record.keyName, userPubkey: remotePubkey } },
                update: {},
                create: {
                    keyName: record.keyName,
                    userPubkey: remotePubkey,
                    description: record.clientName,
                },
            });

            // Link token to keyUser
            await prisma.token.update({
                where: { id: record.id },
                data: { keyUserId: keyUser.id },
            });

            await prisma.signingCondition.create({
                data: {
                    keyUserId: keyUser.id,
                    method: 'connect',
                    allowed: true,
                },
            });

            for (const rule of record.policy!.rules) {
                await prisma.signingCondition.create({
                    data: {
                        keyUserId: keyUser.id,
                        method: rule.method,
                        allowed: true,
                        kind: rule.kind !== null && rule.kind !== undefined ? rule.kind.toString() : undefined,
                    },
                });
            }
        } catch (error) {
            // If permission creation fails, unclaim the token so it can be retried
            await prisma.token.update({
                where: { id: record.id },
                data: { redeemedAt: null, keyUserId: null },
            });
            throw error;
        }
    }

    /**
     * Fetch and validate a token record.
     * Does NOT check redeemedAt - that's handled atomically in applyToken.
     */
    private async fetchTokenRecord(token: string) {
        const record = await prisma.token.findUnique({
            where: { token },
            include: { policy: { include: { rules: true } } },
        });

        if (!record) {
            throw new Error('Token not found');
        }

        if (record.redeemedAt) {
            throw new Error('Token already redeemed');
        }

        if (!record.policy) {
            throw new Error('Token policy missing');
        }

        if (record.expiresAt && record.expiresAt < new Date()) {
            throw new Error('Token expired');
        }

        return record;
    }
}
