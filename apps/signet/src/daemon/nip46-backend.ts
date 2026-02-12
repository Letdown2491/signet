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
import prisma from '../db.js';
import type { RelayPool } from './lib/relay-pool.js';
import type { SubscriptionManager } from './lib/subscription-manager.js';
import { getConnectionTokenService } from './services/index.js';

const debug = createDebug('signet:nip46');

// Deduplication cache: track processed event IDs to avoid reprocessing
// Events can be delivered multiple times (relay reconnect, subscription refresh)
// TTL of 10 minutes covers typical health check cycles with margin
const PROCESSED_EVENTS_TTL_MS = 10 * 60 * 1000;
const PROCESSED_EVENTS_MAX_SIZE = 5000;
const processedEvents = new TTLCache<true>('nip46-processed-events', {
    ttlMs: PROCESSED_EVENTS_TTL_MS,
    maxSize: PROCESSED_EVENTS_MAX_SIZE,
});

type Nip46Method =
    | 'connect'
    | 'sign_event'
    | 'get_public_key'
    | 'nip04_encrypt' | 'nip04_decrypt'
    | 'nip44_encrypt' | 'nip44_decrypt'
    | 'ping'
    | 'switch_relays';

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

    // Per-app subscriptions for nostrconnect apps with custom relays
    private readonly appSubscriptions: Map<number, () => void> = new Map();

    constructor(config: Nip46BackendConfig) {
        this.keyName = config.keyName;
        this.nsec = config.nsec;
        this.pubkey = getPublicKey(this.nsec);
        this.pool = config.pool;
        this.subscriptionManager = config.subscriptionManager;
        this.permitCallback = config.permitCallback;
        this.adminSecret = config.adminSecret;
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

        // Mark as processed BEFORE we handle it to prevent concurrent duplicates
        processedEvents.set(event.id, true);

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

            if (result !== undefined) {
                await this.sendResponse(id, remotePubkey, result);
            } else {
                await this.sendError(id, remotePubkey, 'Not authorized');
            }
        } catch (err) {
            const message = toErrorMessage(err);
            logger.error('Error handling NIP-46 method', { key: this.keyName, method, error: message });
            await this.sendError(id, remotePubkey, message);
        }
    }

    /**
     * Decrypt an incoming NIP-46 request.
     */
    private decryptRequest(event: Event): Nip46Request | null {
        try {
            const conversationKey = getConversationKey(this.nsec, event.pubkey);
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
        // Check if client has an existing connection (KeyUser record)
        const keyUser = await prisma.keyUser.findUnique({
            where: {
                unique_key_user: {
                    keyName: this.keyName,
                    userPubkey: remotePubkey,
                },
            },
            select: { id: true },
        });

        if (!keyUser) {
            debug('[%s] switch_relays: no connection found for %s', this.keyName, npubEncode(remotePubkey));
            return undefined;
        }

        const relays = this.pool.getRelays();
        debug('[%s] switch_relays: returning %d relays', this.keyName, relays.length);
        return JSON.stringify(relays);
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
        const conversationKey = getConversationKey(this.nsec, thirdPartyPubkey);
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
        const conversationKey = getConversationKey(this.nsec, thirdPartyPubkey);
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
     * Encrypt and publish a response.
     * Publishes to both pool relays and any custom relays the app connected with.
     */
    private async sendEncryptedResponse(remotePubkey: string, response: Nip46Response): Promise<void> {
        // Encrypt with NIP-44
        const conversationKey = getConversationKey(this.nsec, remotePubkey);
        const encrypted = nip44Encrypt(JSON.stringify(response), conversationKey);

        // Create and sign event
        const event = finalizeEvent({
            kind: 24133,
            content: encrypted,
            tags: [['p', remotePubkey]],
            created_at: Math.floor(Date.now() / 1000),
        }, this.nsec);

        debug('[%s] sending response %s to %s', this.keyName, response.id, npubEncode(remotePubkey));

        // Look up app's custom relays (if connected via nostrconnect)
        let appRelays: string[] = [];
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
                appRelays = JSON.parse(keyUser.nostrconnectRelays);
                debug('[%s] found %d custom relays for app', this.keyName, appRelays.length);
            }
        } catch (err) {
            debug('[%s] failed to lookup app relays: %s', this.keyName, (err as Error).message);
        }

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
