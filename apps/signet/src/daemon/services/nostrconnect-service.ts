import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';
import { encrypt as nip44Encrypt, getConversationKey } from 'nostr-tools/nip44';
import { npubEncode, decode as nip19Decode } from 'nostr-tools/nip19';
import createDebug from 'debug';
import { toErrorMessage } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { KeyService } from './key-service.js';

const debug = createDebug('signet:nostrconnect');

interface NostrconnectResponse {
    id: string;
    result?: string;
    error?: string;
}

export interface NostrconnectServiceConfig {
    keyService: KeyService;
}

/**
 * Callback for when an app connects via nostrconnect.
 * Used to create per-app relay subscriptions.
 */
export type OnAppConnectedCallback = (keyName: string, appId: number, relays: string[]) => void;

/**
 * Callback for when an app is revoked.
 * Used to clean up per-app relay subscriptions.
 */
export type OnAppRevokedCallback = (keyName: string, appId: number) => void;

/**
 * Service for handling nostrconnect:// client-initiated connections.
 *
 * Responsibilities:
 * - Sending connect responses to clients on their specified relays
 * - Managing per-app relay subscriptions via callbacks
 */
export class NostrconnectService {
    private readonly keyService: KeyService;
    private onAppConnected?: OnAppConnectedCallback;
    private onAppRevoked?: OnAppRevokedCallback;

    constructor(config: NostrconnectServiceConfig) {
        this.keyService = config.keyService;
    }

    /**
     * Set callback for when an app connects via nostrconnect.
     * The daemon uses this to create per-app relay subscriptions.
     */
    public setOnAppConnected(callback: OnAppConnectedCallback): void {
        this.onAppConnected = callback;
    }

    /**
     * Set callback for when an app is revoked.
     * The daemon uses this to clean up per-app relay subscriptions.
     */
    public setOnAppRevoked(callback: OnAppRevokedCallback): void {
        this.onAppRevoked = callback;
    }

    /**
     * Notify that an app was revoked (for subscription cleanup).
     */
    public notifyAppRevoked(keyName: string, appId: number): void {
        if (this.onAppRevoked) {
            this.onAppRevoked(keyName, appId);
        }
    }

    /**
     * Send a connect response to a client on their specified relays.
     *
     * This is called after POST /nostrconnect creates the KeyUser.
     * The response includes the secret from the nostrconnect URI to prove
     * we received and processed the connection request.
     *
     * @param keyName - The key to use for signing and encryption
     * @param clientPubkey - The client's pubkey (from nostrconnect URI)
     * @param clientRelays - The relays the client is listening on
     * @param secret - The secret from the nostrconnect URI (returned as result)
     */
    public async sendConnectResponse(
        keyName: string,
        clientPubkey: string,
        clientRelays: string[],
        secret: string
    ): Promise<{ success: boolean; error?: string }> {
        // Get the signing key
        const nsec = this.keyService.getActiveKey(keyName);
        if (!nsec) {
            return { success: false, error: `Key "${keyName}" is not active` };
        }

        // Convert nsec to bytes for signing
        const decoded = nip19Decode(nsec);
        if (decoded.type !== 'nsec') {
            return { success: false, error: 'Invalid key format' };
        }
        const secretKey = decoded.data as Uint8Array;
        const signerPubkey = getPublicKey(secretKey);

        // Generate a unique request ID for the connect response
        // (The client will use this to match our response to their request)
        const responseId = `nostrconnect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        // Build the connect response
        // Per NIP-46, the result should be the secret from the URI
        const response: NostrconnectResponse = {
            id: responseId,
            result: secret,
        };

        try {
            // Encrypt with NIP-44
            const conversationKey = getConversationKey(secretKey, clientPubkey);
            const encrypted = nip44Encrypt(JSON.stringify(response), conversationKey);

            // Create and sign the event
            const event = finalizeEvent({
                kind: 24133,
                content: encrypted,
                tags: [['p', clientPubkey]],
                created_at: Math.floor(Date.now() / 1000),
            }, secretKey);

            // Create a temporary pool to publish to the client's relays
            const tempPool = new SimplePool();

            try {
                debug('sending connect response to %s on %d relays', npubEncode(clientPubkey), clientRelays.length);
                logger.info('Sending nostrconnect response', { to: npubEncode(clientPubkey), relays: clientRelays });

                // Publish to client's relays
                const results = await Promise.allSettled(
                    tempPool.publish(clientRelays, event)
                );

                const successes = results.filter(r => r.status === 'fulfilled').length;
                const failures = results.filter(r => r.status === 'rejected').length;

                debug('published to %d/%d relays (failures: %d)', successes, clientRelays.length, failures);

                if (successes === 0) {
                    const errors = results
                        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
                        .map(r => r.reason?.message || String(r.reason))
                        .join(', ');
                    return { success: false, error: `Failed to publish to any relay: ${errors}` };
                }

                logger.info('Nostrconnect response sent', { successes, total: clientRelays.length });
                return { success: true };
            } finally {
                // Clean up temporary pool
                tempPool.close(clientRelays);
            }
        } catch (error) {
            const message = toErrorMessage(error);
            logger.error('Failed to send nostrconnect response', { error: message });
            return { success: false, error: message };
        }
    }

    /**
     * Set up subscription on client's relays to receive their NIP-46 requests.
     *
     * This delegates to the daemon's backend via the onAppConnected callback,
     * which creates a subscription on the app's relays for the key's pubkey.
     *
     * @param keyName - The key name
     * @param appId - The KeyUser ID
     * @param clientRelays - The relays to subscribe to
     */
    public subscribeToClientRelays(
        keyName: string,
        appId: number,
        clientRelays: string[]
    ): void {
        if (!this.onAppConnected) {
            debug('no onAppConnected callback set, skipping subscription');
            logger.warn('Per-app relay subscriptions not configured');
            return;
        }

        if (!clientRelays || clientRelays.length === 0) {
            debug('no client relays provided, skipping subscription');
            return;
        }

        debug('creating subscription for app %d on %d relays', appId, clientRelays.length);
        this.onAppConnected(keyName, appId, clientRelays);
    }
}

// Singleton instance
let nostrconnectService: NostrconnectService | undefined;

export function initNostrconnectService(config: NostrconnectServiceConfig): NostrconnectService {
    nostrconnectService = new NostrconnectService(config);
    return nostrconnectService;
}

export function getNostrconnectService(): NostrconnectService {
    if (!nostrconnectService) {
        throw new Error('NostrconnectService not initialized');
    }
    return nostrconnectService;
}
