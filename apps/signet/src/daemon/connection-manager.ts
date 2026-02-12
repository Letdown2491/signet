import { getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { npubEncode, decode as nip19Decode } from 'nostr-tools/nip19';
import { encrypt as nip44Encrypt, getConversationKey } from 'nostr-tools/nip44';
import { hexToBytes } from './lib/hex.js';
import { toErrorMessage } from './lib/errors.js';
import { logger } from './lib/logger.js';
import createDebug from 'debug';
import fs from 'fs';
import path from 'path';
import type { ConnectionInfo } from '@signet/types';
import type { ConfigFile } from '../config/types.js';
import { loadConfig } from '../config/config.js';
import type { RelayPool } from './lib/relay-pool.js';

const debug = createDebug('signet:connection');

export interface ConnectionManagerConfig {
    key: string;          // Admin key (nsec or hex)
    relays: string[];
    secret?: string;
}

interface Nip46Response {
    id: string;
    result?: string;
    error?: string;
}

/**
 * Manages connection information and NIP-46 RPC communication.
 * Handles:
 * - Generating bunker connection URIs
 * - Sending NIP-46 responses (like auth_url) to clients
 */
export class ConnectionManager {
    public readonly configFile: string;

    private readonly pool: RelayPool;
    private readonly nsec: Uint8Array;
    private readonly pubkey: string;
    private readonly secret?: string;
    private readonly relays: string[];
    private connectionInfo?: ConnectionInfo;
    private readyResolver?: () => void;
    private readonly readyPromise: Promise<void>;

    constructor(config: ConnectionManagerConfig, configFile: string, pool: RelayPool) {
        this.configFile = configFile;
        this.secret = config.secret;
        this.relays = config.relays;
        this.pool = pool;

        // Parse the admin key
        this.nsec = this.parseSecretKey(config.key);
        this.pubkey = getPublicKey(this.nsec);

        this.readyPromise = new Promise((resolve) => {
            this.readyResolver = resolve;
        });

        this.initialize();
    }

    private parseSecretKey(key: string): Uint8Array {
        if (key.startsWith('nsec1')) {
            const decoded = nip19Decode(key);
            if (decoded.type !== 'nsec') {
                throw new Error('Invalid nsec key');
            }
            return decoded.data as Uint8Array;
        }
        // Assume hex
        return hexToBytes(key);
    }

    private initialize(): void {
        try {
            this.writeConnectionStrings();
        } catch (error) {
            logger.error('Failed to initialize connection manager', { error: toErrorMessage(error) });
            this.readyResolver?.();
            this.readyResolver = undefined;
        }
    }

    public async config(): Promise<ConfigFile> {
        return loadConfig(this.configFile);
    }

    public async waitUntilReady(): Promise<void> {
        if (this.connectionInfo) {
            return;
        }
        await this.readyPromise;
    }

    public getConnectionInfo(): ConnectionInfo | undefined {
        return this.connectionInfo;
    }

    /**
     * Ensure relay connections are active before sending.
     * Call this before using sendResponse() to handle disconnections.
     */
    public async ensureConnected(): Promise<void> {
        await this.pool.ensureConnected();
    }

    /**
     * Send a NIP-46 response to a remote client.
     * This is used for sending auth_url responses during the authorization flow.
     */
    public async sendResponse(
        requestId: string,
        remotePubkey: string,
        result: string,
        error?: string,
        authUrl?: string
    ): Promise<void> {
        const response: Nip46Response = error
            ? { id: requestId, result, error }
            : { id: requestId, result };

        // If this is an auth_url response, include it in the error field
        // per NIP-46 spec: auth_url is sent as error with result='auth_url'
        if (authUrl) {
            response.result = 'auth_url';
            response.error = authUrl;
        }

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

        debug('sending response %s to %s', requestId, npubEncode(remotePubkey));
        await this.pool.publish(event);
    }

    private writeConnectionStrings(): void {
        const relays = this.resolveConnectionRelays();
        const secret = this.secret?.trim().toLowerCase() || undefined;
        const npub = npubEncode(this.pubkey);

        const hexUri = this.buildBunkerUri(this.pubkey, relays, secret);
        const npubUri = this.buildBunkerUri(npub, relays, secret);

        logger.info('Connection URI generated', { uri: hexUri });

        const folder = path.dirname(this.configFile);
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, 'connection.txt'), `${hexUri}\n`);

        this.connectionInfo = {
            npub,
            pubkey: this.pubkey,
            npubUri,
            hexUri,
            relays,
            secret,
        };

        this.readyResolver?.();
        this.readyResolver = undefined;
    }

    private resolveConnectionRelays(): string[] {
        let relaySources: string[] = [];
        try {
            const rawConfig = fs.readFileSync(this.configFile, 'utf8');
            const parsed = JSON.parse(rawConfig);
            if (Array.isArray(parsed?.nostr?.relays)) {
                relaySources = parsed.nostr.relays as string[];
            }
        } catch {
            relaySources = [];
        }

        if (relaySources.length === 0) {
            relaySources = [...this.relays];
        }

        const normalised = relaySources
            .map((relay) => this.normaliseRelay(relay))
            .filter((relay): relay is string => Boolean(relay));

        return Array.from(new Set(normalised));
    }

    private normaliseRelay(relay: string): string | null {
        const trimmed = relay?.trim();
        if (!trimmed) {
            return null;
        }

        const withoutScheme = trimmed.replace(/^[a-z]+:\/\//i, '').replace(/^\/+/, '');
        if (!withoutScheme) {
            return null;
        }

        return `wss://${withoutScheme}`;
    }

    private buildBunkerUri(identifier: string, relays: string[], secret?: string): string {
        const fragments: string[] = [];

        for (const relay of relays) {
            const value = relay.trim();
            if (!value) {
                continue;
            }
            fragments.push(`relay=${encodeURIComponent(value)}`);
        }

        const query = fragments.length ? `?${fragments.join('&')}` : '';
        const secretFragment = secret ? `${query ? '&' : '?'}secret=${encodeURIComponent(secret)}` : '';
        return `bunker://${identifier}${query}${secretFragment}`;
    }
}
