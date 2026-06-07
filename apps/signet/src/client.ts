import 'websocket-polyfill';
import { SimplePool } from 'nostr-tools/pool';
import { finalizeEvent, generateSecretKey, getPublicKey, verifyEvent, type Event, type UnsignedEvent } from 'nostr-tools/pure';
import { npubEncode, nsecEncode, decode as nip19Decode } from 'nostr-tools/nip19';
import { encrypt as nip44Encrypt, decrypt as nip44Decrypt, getConversationKey } from 'nostr-tools/nip44';
import { type Filter } from 'nostr-tools/filter';
import fs from 'fs';
import path from 'path';

const argv = process.argv.slice(2);
const command = argv[0];
let remoteTarget = argv[1];
const payload = argv[2];

const dontPublish = process.argv.includes('--dont-publish');
const debug = process.argv.includes('--debug');

function extractRelays(): string[] {
    const index = process.argv.indexOf('--relays');
    if (index === -1 || !process.argv[index + 1]) {
        return [];
    }
    return process.argv[index + 1].split(',').map((relay) => relay.trim()).filter(Boolean);
}

const extraRelays = extractRelays();

if (!command || !remoteTarget) {
    console.log('Usage: node client sign <remote-npub-or-bunker-token> <content> [--dont-publish] [--debug] [--relays <relay1,relay2>]');
    console.log('');
    console.log('\tcontent: JSON event or text for kind 1');
    process.exit(1);
}

interface BunkerInfo {
    pubkey: string;
    relays: string[];
    secret?: string;
}

function parseBunkerToken(token: string): BunkerInfo {
    const parsed = new URL(token.trim());
    const pubkey = parsed.pathname.replace('//', '');
    const relays = parsed.searchParams.getAll('relay').map((relay) => decodeURIComponent(relay));
    const secret = parsed.searchParams.get('secret') ?? undefined;

    if (relays.length === 0) {
        throw new Error('No relays found in bunker token');
    }

    // Handle both hex pubkey and npub
    let resolvedPubkey = pubkey;
    if (pubkey.startsWith('npub1')) {
        const decoded = nip19Decode(pubkey);
        if (decoded.type !== 'npub') {
            throw new Error('Invalid npub in bunker token');
        }
        resolvedPubkey = decoded.data as string;
    }

    return { pubkey: resolvedPubkey, relays, secret };
}

function keyStorageDir(): string {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (!home) {
        throw new Error('Unable to locate HOME directory');
    }
    return path.join(home, '.signet-client-private.key');
}

function loadPrivateKey(): Uint8Array | undefined {
    try {
        const data = fs.readFileSync(path.join(keyStorageDir(), 'private.key'), 'utf8').trim();
        if (data.startsWith('nsec1')) {
            const decoded = nip19Decode(data);
            if (decoded.type !== 'nsec') {
                return undefined;
            }
            return decoded.data as Uint8Array;
        }
        // Assume hex
        return Buffer.from(data, 'hex');
    } catch {
        return undefined;
    }
}

function persistPrivateKey(key: Uint8Array): void {
    const dir = keyStorageDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'private.key'), nsecEncode(key));
}

function buildRelays(defaultsOverride: string[] = []): string[] {
    const defaults = defaultsOverride.length
        ? defaultsOverride
        : [
              'wss://relay.primal.net',
              'wss://nos.lol',
          ];
    return [...defaults, ...extraRelays];
}

interface Nip46Request {
    id: string;
    method: string;
    params: string[];
}

interface Nip46Response {
    id: string;
    result?: string;
    error?: string;
}

function generateRequestId(): string {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

class Nip46Client {
    private readonly pool: SimplePool;
    private readonly relays: string[];
    private readonly localSecretKey: Uint8Array;
    private readonly localPubkey: string;
    private readonly remotePubkey: string;
    private readonly secret?: string;
    private unsubscribe?: () => void;
    private pendingRequests: Map<string, {
        resolve: (result: string) => void;
        reject: (error: Error) => void;
    }> = new Map();

    constructor(
        pool: SimplePool,
        relays: string[],
        localSecretKey: Uint8Array,
        remotePubkey: string,
        secret?: string
    ) {
        this.pool = pool;
        this.relays = relays;
        this.localSecretKey = localSecretKey;
        this.localPubkey = getPublicKey(localSecretKey);
        this.remotePubkey = remotePubkey;
        this.secret = secret;
    }

    async connect(): Promise<string> {
        // Subscribe to responses
        this.subscribeToResponses();

        // Send connect request
        const params = [this.localPubkey];
        if (this.secret) {
            params.push(this.secret);
        }

        const result = await this.sendRequest('connect', params);

        if (result === 'auth_url') {
            throw new Error('Remote signer requires authorization - not implemented in this client');
        }

        return result;
    }

    async getPublicKey(): Promise<string> {
        return this.sendRequest('get_public_key', []);
    }

    async signEvent(event: UnsignedEvent): Promise<Event> {
        const result = await this.sendRequest('sign_event', [JSON.stringify(event)]);
        return JSON.parse(result) as Event;
    }

    private subscribeToResponses(): void {
        if (this.unsubscribe) {
            return;
        }

        const filter: Filter = {
            kinds: [24133],
            '#p': [this.localPubkey],
        };

        const sub = this.pool.subscribeMany(
            this.relays,
            filter,
            {
                onevent: (event) => {
                    this.handleResponse(event).catch((err) => {
                        if (debug) {
                            console.error('Error handling response:', err);
                        }
                    });
                },
            }
        );

        this.unsubscribe = () => sub.close();
    }

    private async handleResponse(event: Event): Promise<void> {
        if (!verifyEvent(event)) {
            if (debug) {
                console.log('Invalid signature on response');
            }
            return;
        }

        // Only accept responses from the remote signer
        if (event.pubkey !== this.remotePubkey) {
            return;
        }

        // Decrypt response
        let response: Nip46Response;
        try {
            const conversationKey = getConversationKey(this.localSecretKey, event.pubkey);
            const decrypted = nip44Decrypt(event.content, conversationKey);
            response = JSON.parse(decrypted) as Nip46Response;
        } catch (err) {
            if (debug) {
                console.log('Failed to decrypt response:', err);
            }
            return;
        }

        if (debug) {
            console.log('Received response:', response);
        }

        const pending = this.pendingRequests.get(response.id);
        if (!pending) {
            if (debug) {
                console.log('No pending request for response:', response.id);
            }
            return;
        }

        this.pendingRequests.delete(response.id);

        if (response.error && response.result !== 'auth_url') {
            pending.reject(new Error(response.error));
        } else {
            pending.resolve(response.result ?? '');
        }
    }

    private async sendRequest(method: string, params: string[]): Promise<string> {
        const id = generateRequestId();
        const request: Nip46Request = { id, method, params };

        // Encrypt request
        const conversationKey = getConversationKey(this.localSecretKey, this.remotePubkey);
        const encrypted = nip44Encrypt(JSON.stringify(request), conversationKey);

        // Create and sign event
        const event = finalizeEvent({
            kind: 24133,
            content: encrypted,
            tags: [['p', this.remotePubkey]],
            created_at: Math.floor(Date.now() / 1000),
        }, this.localSecretKey);

        if (debug) {
            console.log('Sending request:', { id, method });
        }

        // Create promise for response
        const responsePromise = new Promise<string>((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });

            // Timeout after 60 seconds
            setTimeout(() => {
                if (this.pendingRequests.has(id)) {
                    this.pendingRequests.delete(id);
                    reject(new Error('Request timed out'));
                }
            }, 60_000);
        });

        // Publish request
        await Promise.allSettled(this.pool.publish(this.relays, event));

        return responsePromise;
    }

    close(): void {
        this.unsubscribe?.();
        this.pool.close(this.relays);
    }
}

async function signCommand(client: Nip46Client, pool: SimplePool, relays: string[]): Promise<void> {
    if (debug) {
        console.log('Waiting for authorization...');
    }

    // Connect to remote signer
    await client.connect();

    const remotePubkey = await client.getPublicKey();
    if (debug) {
        console.log(`Remote pubkey: ${npubEncode(remotePubkey)}`);
    }

    // Build event to sign
    let eventToSign: UnsignedEvent;
    try {
        const parsed = JSON.parse(payload ?? '{}');
        if (!parsed.kind) {
            throw new Error('Event kind missing');
        }
        eventToSign = {
            kind: parsed.kind,
            content: parsed.content ?? '',
            tags: parsed.tags ?? [],
            created_at: parsed.created_at ?? Math.floor(Date.now() / 1000),
            pubkey: remotePubkey,
        };
    } catch {
        // Create a simple kind 1 note
        eventToSign = {
            kind: 1,
            content: payload ?? '',
            tags: [['client', 'signet-client']],
            created_at: Math.floor(Date.now() / 1000),
            pubkey: remotePubkey,
        };
    }

    // Sign the event
    const signedEvent = await client.signEvent(eventToSign);

    if (debug) {
        console.log(JSON.stringify(signedEvent, null, 2));
    } else {
        console.log(signedEvent.sig);
    }

    if (!dontPublish) {
        const results = await Promise.allSettled(pool.publish(relays, signedEvent));
        const successes = results.filter(r => r.status === 'fulfilled').length;
        if (debug) {
            console.log(`Published to ${successes}/${relays.length} relays`);
        }
    }
}

(async () => {
    try {
        // Parse bunker token or npub
        let bunkerInfo: BunkerInfo;
        if (remoteTarget.startsWith('bunker://')) {
            bunkerInfo = parseBunkerToken(remoteTarget);
        } else {
            // Assume npub
            let pubkey: string;
            if (remoteTarget.startsWith('npub1')) {
                const decoded = nip19Decode(remoteTarget);
                if (decoded.type !== 'npub') {
                    throw new Error('Invalid npub');
                }
                pubkey = decoded.data as string;
            } else {
                pubkey = remoteTarget;
            }
            bunkerInfo = {
                pubkey,
                relays: buildRelays(),
            };
        }

        const relays = buildRelays(bunkerInfo.relays);
        const pool = new SimplePool();

        // Load or generate local signer
        let localSecretKey: Uint8Array | undefined = loadPrivateKey();
        if (!localSecretKey) {
            localSecretKey = generateSecretKey();
            persistPrivateKey(localSecretKey);
        }

        // At this point localSecretKey is guaranteed to be defined
        const secretKey = localSecretKey;

        if (debug) {
            console.log(`Local signer: ${npubEncode(getPublicKey(secretKey))}`);
            console.log(`Remote signer: ${npubEncode(bunkerInfo.pubkey)}`);
            console.log(`Relays: ${relays.join(', ')}`);
        }

        const client = new Nip46Client(
            pool,
            relays,
            secretKey,
            bunkerInfo.pubkey,
            bunkerInfo.secret
        );

        if (command === 'sign') {
            await signCommand(client, pool, relays);
        } else {
            console.log(`Unknown command "${command}"`);
            process.exit(1);
        }

        client.close();
    } catch (error) {
        console.log(`Error: ${(error as Error).message}`);
        process.exit(1);
    }
})();
