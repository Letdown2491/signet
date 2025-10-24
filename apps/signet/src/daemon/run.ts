import NDK, {
    NDKPrivateKeySigner,
    Nip46PermitCallback,
    type Nip46PermitCallbackParams,
    type NDKRpcRequest,
} from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import Fastify from 'fastify';
import FastifyFormBody from '@fastify/formbody';
import FastifyView from '@fastify/view';
import Handlebars from 'handlebars';
import { BunkerBackend } from './backend.js';
import AdminInterface, { type KeySummary, type KeyUserSummary } from './admin/index.js';
import prisma from '../db.js';
import { requestAuthorization } from './authorize.js';
import { decryptSecret, encryptSecret } from '../config/keyring.js';
import { loadConfig, saveConfig } from '../config/config.js';
import type { DaemonBootstrapConfig } from './types.js';
import { isRequestPermitted, type RpcMethod } from './lib/acl.js';
import {
    authorizeRequestWebHandler,
    processRegistrationWebHandler,
    processRequestWebHandler,
} from './web/authorize.js';
import { createSkeletonProfile } from './lib/profile.js';

type ActiveKeyMap = Record<string, string>;

function buildAuthorizationCallback(
    keyName: string,
    admin: AdminInterface
): Nip46PermitCallback {
    return async ({ id, method, pubkey, params }: Nip46PermitCallbackParams): Promise<boolean> => {
        const humanPubkey = nip19.npubEncode(pubkey);
        console.log(`🔐 Request ${id} from ${humanPubkey} to ${method} using key ${keyName}`);

        const primaryParam = Array.isArray(params) ? params[0] : undefined;
        const existingDecision = await isRequestPermitted(
            keyName,
            pubkey,
            method as RpcMethod,
            primaryParam
        );

        if (existingDecision !== undefined) {
            console.log(
                `🔎 Access ${existingDecision ? 'granted' : 'denied'} via ACL for ${humanPubkey}`
            );
            return existingDecision;
        }

        try {
            await requestAuthorization(admin, keyName, pubkey, id, method, primaryParam);
            return true;
        } catch (error) {
            console.log(`❌ Authorization rejected: ${(error as Error).message}`);
            return false;
        }
    };
}

async function describeKeys(config: DaemonBootstrapConfig, activeKeys: ActiveKeyMap): Promise<KeySummary[]> {
    const keys: KeySummary[] = [];
    const remaining = new Set(Object.keys(config.allKeys));

    for (const [name, secret] of Object.entries(activeKeys)) {
        try {
            const signer = new NDKPrivateKeySigner(secret);
            const user = await signer.user();
            const userCount = await prisma.keyUser.count({
                where: { keyName: name, revokedAt: null }
            });
            const tokenCount = await prisma.token.count({ where: { keyName: name } });
            keys.push({
                name,
                npub: user.npub,
                userCount,
                tokenCount,
            });
        } catch (error) {
            console.log(`⚠️ Unable to describe key ${name}: ${(error as Error).message}`);
        }

        remaining.delete(name);
    }

    for (const name of remaining) {
        keys.push({
            name,
            userCount: await prisma.keyUser.count({
                where: { keyName: name, revokedAt: null }
            }),
            tokenCount: await prisma.token.count({ where: { keyName: name } }),
        });
    }

    return keys;
}

async function listKeyUsers(req: NDKRpcRequest): Promise<KeyUserSummary[]> {
    const keyName = req.params[0] as string;
    const users = await prisma.keyUser.findMany({
        where: { keyName },
        include: { signingConditions: true },
    });

    return users.map((user) => ({
        id: user.id,
        name: user.keyName,
        pubkey: user.userPubkey,
        description: user.description ?? undefined,
        createdAt: user.createdAt,
        lastUsedAt: user.lastUsedAt ?? undefined,
        revokedAt: user.revokedAt ?? undefined,
        signingConditions: user.signingConditions,
    }));
}

export async function runDaemon(config: DaemonBootstrapConfig): Promise<void> {
    const daemon = new Daemon(config);
    await daemon.start();
}

class Daemon {
    private readonly config: DaemonBootstrapConfig;
    private readonly ndk: NDK;
    private readonly admin: AdminInterface;
    private readonly fastify = Fastify({ logger: { level: 'warn' } });
    private activeKeys: ActiveKeyMap;

    constructor(config: DaemonBootstrapConfig) {
        this.config = config;
        this.activeKeys = { ...config.keys };

        this.ndk = new NDK({
            explicitRelayUrls: config.nostr.relays,
        });

        this.ndk.pool.on('relay:connect', (relay) =>
            console.log(`✅ Connected to ${relay.url}`)
        );
        this.ndk.pool.on('relay:disconnect', (relay) =>
            console.log(`🚫 Disconnected from ${relay.url}`)
        );
        this.ndk.pool.on('relay:notice', (notice, relay) =>
            console.log(`👀 Notice from ${relay.url}:`, notice)
        );

        this.admin = new AdminInterface(config.admin, config.configFile);
        this.admin.getKeys = () => describeKeys(this.config, this.activeKeys);
        this.admin.getKeyUsers = listKeyUsers;
        this.admin.unlockKey = this.unlockKey.bind(this);
        this.admin.loadKeyMaterial = this.loadKeyMaterial.bind(this);

        this.fastify.register(FastifyFormBody);
    }

    public async start(): Promise<void> {
        await this.ndk.connect(5_000);
        await this.startWebAuth();
        await this.startConfiguredKeys();
        await this.loadPlainKeys();
        console.log('✅ Signet ready to serve requests.');
    }

    private async startConfiguredKeys(): Promise<void> {
        const names = Object.keys(this.activeKeys);
        console.log('🔑 Starting keys:', names.join(', ') || '(none)');

        for (const [name, secret] of Object.entries(this.activeKeys)) {
            await this.startKey(name, secret);
        }
    }

    private async loadPlainKeys(): Promise<void> {
        for (const [name, entry] of Object.entries(this.config.allKeys)) {
            if (!entry?.key) {
                continue;
            }

            const nsec = entry.key.startsWith('nsec1')
                ? entry.key
                : nip19.nsecEncode(Buffer.from(entry.key, 'hex'));
            this.loadKeyMaterial(name, nsec);
        }
    }

    private async startKey(name: string, secret: string): Promise<void> {
        try {
            const signer = secret.startsWith('nsec1')
                ? new NDKPrivateKeySigner(secret)
                : new NDKPrivateKeySigner(secret);
            const hexSecret = signer.privateKey!;

            const backend = new BunkerBackend(
                this.ndk,
                this.fastify,
                hexSecret,
                buildAuthorizationCallback(name, this.admin),
                this.config.baseUrl
            );

            await backend.start();
            console.log(`🔑 Key "${name}" online.`);
        } catch (error) {
            console.log(`❌ Failed to start key ${name}: ${(error as Error).message}`);
        }
    }

    private async startWebAuth(): Promise<void> {
        if (!this.config.authPort) {
            return;
        }

        const urlPrefix = this.config.baseUrl
            ? new URL(this.config.baseUrl).pathname.replace(/\/+$/, '')
            : '';

        this.fastify.addHook('onRequest', async (request, reply) => {
            const origin = request.headers.origin ?? '*';
            reply.header('Access-Control-Allow-Origin', origin);
            reply.header('Vary', 'Origin');
            reply.header('Access-Control-Allow-Credentials', 'true');
            const requestedHeaders = request.headers['access-control-request-headers'];
            const allowHeaders = Array.isArray(requestedHeaders)
                ? requestedHeaders.join(', ')
                : requestedHeaders ?? 'content-type';
            reply.header('Access-Control-Allow-Headers', allowHeaders);
            reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

            if (request.method === 'OPTIONS') {
                reply.status(204);
                return reply.send();
            }
        });

        await this.fastify.register(FastifyView, {
            engine: { handlebars: Handlebars },
            defaultContext: { urlPrefix },
        });

        this.fastify.get('/connection', async (_request, reply) => {
            await this.admin.waitUntilReady();
            const info = this.admin.getConnectionInfo();

            if (!info) {
                return reply.code(503).send({ error: 'connection info unavailable' });
            }

            return reply.send({
                npub: info.npub,
                pubkey: info.pubkey,
                npubUri: info.npubUri,
                hexUri: info.hexUri,
                relays: info.relays,
                nostrRelays: this.config.nostr.relays,
            });
        });

        this.fastify.get('/requests', async (request, reply) => {
            await this.admin.waitUntilReady();

            const query = (request.query ?? {}) as Record<string, string | undefined>;
            const limitParam = query.limit;
            const requestedLimit = limitParam ? Number.parseInt(limitParam, 10) : NaN;
            const limit = Number.isFinite(requestedLimit)
                ? Math.min(50, Math.max(1, requestedLimit))
                : 10;

            const offsetParam = query.offset;
            const requestedOffset = offsetParam ? Number.parseInt(offsetParam, 10) : NaN;
            const offset = Number.isFinite(requestedOffset) && requestedOffset >= 0
                ? requestedOffset
                : 0;

            const status = query.status || 'pending';
            const now = new Date();
            const sixtySecondsAgo = new Date(now.getTime() - 60_000);

            // Build where clause based on status filter
            let where: any;
            if (status === 'approved') {
                where = { allowed: true };
            } else if (status === 'expired') {
                // Expired: allowed is null and created more than 60 seconds ago
                where = {
                    allowed: null,
                    createdAt: { lt: sixtySecondsAgo },
                };
            } else {
                // Pending (default): allowed is null and created within last 60 seconds
                where = {
                    allowed: null,
                    createdAt: { gte: sixtySecondsAgo },
                };
            }

            const records = await prisma.request.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: offset,
                take: limit,
            });

            const nowMillis = Date.now();
            const payload = records.map((record) => {
                const entry = record.keyName ? this.config.allKeys[record.keyName] : undefined;
                const requiresPassword = record.keyName ? !entry?.key : false;
                const expiresAt = record.createdAt.getTime() + 60_000;

                // Parse event details for sign_event requests
                let eventPreview: any = null;
                if (record.method === 'sign_event' && record.params) {
                    try {
                        const params = JSON.parse(record.params);
                        if (Array.isArray(params) && params[0]) {
                            const event = params[0];
                            eventPreview = {
                                kind: event.kind,
                                content: event.content,
                                tags: event.tags || [],
                            };
                        }
                    } catch (error) {
                        // Ignore parse errors
                    }
                }

                return {
                    id: record.id,
                    keyName: record.keyName ?? null,
                    method: record.method,
                    remotePubkey: record.remotePubkey,
                    params: record.params ?? null,
                    eventPreview,
                    createdAt: record.createdAt.toISOString(),
                    expiresAt: new Date(expiresAt).toISOString(),
                    ttlSeconds: Math.max(0, Math.round((expiresAt - nowMillis) / 1_000)),
                    requiresPassword,
                    processedAt: record.processedAt?.toISOString() ?? null,
                };
            });

            return reply.send({ requests: payload });
        });

        this.fastify.get('/keys', async (_request, reply) => {
            await this.admin.waitUntilReady();

            const keys = [];
            for (const [name, entry] of Object.entries(this.config.allKeys)) {
                const isOnline = !!this.activeKeys[name];
                const isEncrypted = !!(entry?.iv && entry?.data);
                const status = isOnline ? 'online' : isEncrypted ? 'locked' : 'offline';

                let npub: string | undefined;
                let bunkerUri: string | undefined;

                if (isOnline) {
                    try {
                        const signer = new NDKPrivateKeySigner(this.activeKeys[name]);
                        const user = await signer.user();
                        npub = user.npub;

                        const relayParams = this.config.nostr.relays
                            .map(relay => `relay=${encodeURIComponent(relay)}`)
                            .join('&');
                        bunkerUri = `bunker://${user.pubkey}?${relayParams}`;
                    } catch (error) {
                        console.log(`⚠️ Unable to get info for key ${name}: ${(error as Error).message}`);
                    }
                } else if (entry?.key) {
                    try {
                        const nsec = entry.key.startsWith('nsec1')
                            ? entry.key
                            : nip19.nsecEncode(Buffer.from(entry.key, 'hex'));
                        const signer = new NDKPrivateKeySigner(nsec);
                        const user = await signer.user();
                        npub = user.npub;

                        const relayParams = this.config.nostr.relays
                            .map(relay => `relay=${encodeURIComponent(relay)}`)
                            .join('&');
                        bunkerUri = `bunker://${user.pubkey}?${relayParams}`;
                    } catch (error) {
                        console.log(`⚠️ Unable to get info for key ${name}: ${(error as Error).message}`);
                    }
                }

                const userCount = await prisma.keyUser.count({
                    where: { keyName: name, revokedAt: null }
                });
                const tokenCount = await prisma.token.count({ where: { keyName: name } });

                keys.push({
                    name,
                    npub,
                    bunkerUri,
                    status,
                    userCount,
                    tokenCount,
                });
            }

            return reply.send({ keys });
        });

        this.fastify.post('/keys', async (request, reply) => {
            await this.admin.waitUntilReady();

            const body = request.body as { keyName?: string; passphrase?: string; nsec?: string };

            if (!body.keyName) {
                return reply.code(400).send({ error: 'keyName is required' });
            }

            // Check if key already exists
            if (this.config.allKeys[body.keyName]) {
                return reply.code(409).send({ error: 'A key with this name already exists' });
            }

            try {
                let signer: NDKPrivateKeySigner;

                if (body.nsec) {
                    // Import existing key
                    const decoded = nip19.decode(body.nsec);
                    if (decoded.type !== 'nsec') {
                        return reply.code(400).send({ error: 'Provided secret is not a valid nsec' });
                    }
                    signer = new NDKPrivateKeySigner(decoded.data as string);
                } else {
                    // Generate new key
                    signer = NDKPrivateKeySigner.generate();
                    try {
                        await createSkeletonProfile(signer);
                    } catch (error) {
                        console.log(`⚠️ Failed to create skeleton profile: ${(error as Error).message}`);
                        // Continue anyway - profile creation is optional
                    }
                }

                const nsec = nip19.nsecEncode(signer.privateKey!);

                // Save to config
                const config = await loadConfig(this.config.configFile);

                // Store encrypted if passphrase provided, otherwise store in plain text
                if (body.passphrase && body.passphrase.trim()) {
                    config.keys[body.keyName] = encryptSecret(nsec, body.passphrase);
                } else {
                    config.keys[body.keyName] = { key: nsec };
                }

                await saveConfig(this.config.configFile, config);

                // Load the key into active memory
                this.loadKeyMaterial(body.keyName, nsec);

                // Get user info
                const user = await signer.user();
                const relayParams = this.config.nostr.relays
                    .map(relay => `relay=${encodeURIComponent(relay)}`)
                    .join('&');
                const bunkerUri = `bunker://${user.pubkey}?${relayParams}`;

                return reply.send({
                    ok: true,
                    key: {
                        name: body.keyName,
                        npub: user.npub,
                        bunkerUri,
                        status: 'online',
                    }
                });
            } catch (error) {
                console.error('Error creating key:', error);
                return reply.code(500).send({ error: (error as Error).message });
            }
        });

        this.fastify.get('/apps', async (_request, reply) => {
            await this.admin.waitUntilReady();

            const keyUsers = await prisma.keyUser.findMany({
                where: { revokedAt: null },
                include: { signingConditions: true },
                orderBy: { lastUsedAt: 'desc' },
            });

            const apps = await Promise.all(
                keyUsers.map(async (keyUser) => {
                    const permissions: string[] = [];
                    for (const condition of keyUser.signingConditions) {
                        if (condition.allowed) {
                            if (condition.method === 'connect') continue;
                            if (condition.kind) {
                                permissions.push(`${condition.method} (kind ${condition.kind})`);
                            } else {
                                permissions.push(condition.method);
                            }
                        }
                    }

                    // Get request count from logs
                    const requestCount = await prisma.log.count({
                        where: { keyUserId: keyUser.id },
                    });

                    return {
                        id: keyUser.id,
                        keyName: keyUser.keyName,
                        userPubkey: keyUser.userPubkey,
                        description: keyUser.description ?? undefined,
                        permissions: permissions.length > 0 ? permissions : ['All methods'],
                        connectedAt: keyUser.createdAt.toISOString(),
                        lastUsedAt: keyUser.lastUsedAt?.toISOString() ?? null,
                        requestCount,
                    };
                })
            );

            return reply.send({ apps });
        });

        this.fastify.post('/apps/:id/revoke', async (request, reply) => {
            const params = request.params as { id: string };
            const appId = Number(params.id);

            if (!Number.isFinite(appId)) {
                return reply.code(400).send({ error: 'Invalid app ID' });
            }

            const keyUser = await prisma.keyUser.findUnique({
                where: { id: appId },
            });

            if (!keyUser) {
                return reply.code(404).send({ error: 'App not found' });
            }

            await prisma.keyUser.update({
                where: { id: appId },
                data: { revokedAt: new Date() },
            });

            return reply.send({ ok: true });
        });

        this.fastify.patch('/apps/:id', async (request, reply) => {
            const params = request.params as { id: string };
            const appId = Number(params.id);

            if (!Number.isFinite(appId)) {
                return reply.code(400).send({ error: 'Invalid app ID' });
            }

            const body = request.body as { description?: string };
            const description = body?.description?.trim();

            if (!description) {
                return reply.code(400).send({ error: 'Description is required' });
            }

            const keyUser = await prisma.keyUser.findUnique({
                where: { id: appId },
            });

            if (!keyUser) {
                return reply.code(404).send({ error: 'App not found' });
            }

            await prisma.keyUser.update({
                where: { id: appId },
                data: { description },
            });

            return reply.send({ ok: true });
        });

        this.fastify.get('/dashboard', async (_request, reply) => {
            await this.admin.waitUntilReady();

            // Get stats
            const totalKeys = Object.keys(this.config.allKeys).length;
            const activeKeys = Object.keys(this.activeKeys).length;
            const connectedApps = await prisma.keyUser.count({
                where: { revokedAt: null },
            });
            const pendingRequests = await prisma.request.count({
                where: { allowed: null },
            });

            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const recentActivity24h = await prisma.log.count({
                where: { timestamp: { gte: yesterday } },
            });

            // Get hourly activity data for the last 24 hours
            const hourlyActivity = await prisma.$queryRaw<Array<{ hour: number; type: string; count: number }>>`
                SELECT
                    CAST(strftime('%H', timestamp) AS INTEGER) as hour,
                    type,
                    COUNT(*) as count
                FROM Log
                WHERE timestamp >= datetime('now', '-24 hours')
                GROUP BY hour, type
                ORDER BY hour ASC
            `;

            // Get recent activity
            const recentLogs = await prisma.log.findMany({
                take: 5,
                orderBy: { timestamp: 'desc' },
                include: { KeyUser: true },
            });

            const activity = recentLogs.map((log) => ({
                id: log.id,
                timestamp: log.timestamp.toISOString(),
                type: log.type,
                method: log.method ?? undefined,
                keyName: log.KeyUser?.keyName ?? undefined,
                userPubkey: log.KeyUser?.userPubkey ?? undefined,
                appName: log.KeyUser?.description ?? undefined,
            }));

            return reply.send({
                stats: {
                    totalKeys,
                    activeKeys,
                    connectedApps,
                    pendingRequests,
                    recentActivity24h,
                },
                activity,
                hourlyActivity,
            });
        });

        this.fastify.get('/requests/:id', authorizeRequestWebHandler);
        this.fastify.post('/requests/:id', async (request, reply) => {
            return processRequestWebHandler(request, reply, this.config.allKeys);
        });
        this.fastify.post('/register/:id', processRegistrationWebHandler);

        await this.fastify.listen({
            port: this.config.authPort,
            host: this.config.authHost ?? '0.0.0.0',
        });
    }

    private async unlockKey(keyName: string, passphrase: string): Promise<boolean> {
        const record = this.config.allKeys[keyName];
        if (!record?.iv || !record?.data) {
            throw new Error('No encrypted key material found');
        }

        const decrypted = decryptSecret(
            { iv: record.iv, data: record.data },
            passphrase
        );

        this.activeKeys[keyName] = decrypted;
        await this.startKey(keyName, decrypted);
        return true;
    }

    private loadKeyMaterial(keyName: string, nsec: string): void {
        this.activeKeys[keyName] = nsec;
        this.startKey(keyName, nsec).catch((error) => {
            console.log(`❌ Failed to start key ${keyName}: ${(error as Error).message}`);
        });
    }
}
