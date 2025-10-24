import 'websocket-polyfill';
import NDK, {
    NDKEvent,
    NDKKind,
    NDKNostrRpc,
    NDKPrivateKeySigner,
    NDKRpcRequest,
    NDKRpcResponse,
    NDKUser,
} from '@nostr-dev-kit/ndk';
import createDebug from 'debug';
import fs from 'fs';
import path from 'path';
import type { AdminConfig, ConfigFile } from '../../config/types.js';
import { loadConfig } from '../../config/config.js';
import prisma from '../../db.js';
import { dmUser } from '../../utils/dm-user.js';
import { validateAdminRequest } from './validations/request-from-admin.js';
import createAccount from './commands/create_account.js';
import createNewKey from './commands/create_new_key.js';
import createNewPolicy from './commands/create_new_policy.js';
import createNewToken from './commands/create_new_token.js';
import renameKeyUser from './commands/rename_key_user.js';
import revokeUser from './commands/revoke_user.js';
import unlockKey from './commands/unlock_key.js';
import ping from './commands/ping.js';
import type { AllowScope, RpcMethod } from '../lib/acl.js';
import { permitAllRequests, blockAllRequests } from '../lib/acl.js';

const debug = createDebug('signet:admin');

export type ConnectionInfo = {
    npub: string;
    pubkey: string;
    npubUri: string;
    hexUri: string;
    relays: string[];
    secret?: string;
};

export type KeySummary = {
    name: string;
    npub?: string;
    userCount: number;
    tokenCount: number;
};

export type KeyUserSummary = {
    id: number;
    name: string;
    pubkey: string;
    description?: string;
    createdAt: Date;
    lastUsedAt?: Date;
    revokedAt?: Date;
    signingConditions?: unknown;
};

export default class AdminInterface {
    public readonly configFile: string;
    public rpc: NDKNostrRpc;
    public getKeys?: () => Promise<KeySummary[]>;
    public getKeyUsers?: (req: NDKRpcRequest) => Promise<KeyUserSummary[]>;
    public unlockKey?: (keyName: string, passphrase: string) => Promise<boolean>;
    public loadKeyMaterial?: (keyName: string, nsec: string) => void;

    private readonly adminConfig: AdminConfig;
    private readonly ndk: NDK;
    private signerUser?: NDKUser;
    private connectionInfo?: ConnectionInfo;
    private readyResolver?: () => void;
    private readonly readyPromise: Promise<void>;

    constructor(adminConfig: AdminConfig, configFile: string) {
        this.adminConfig = adminConfig;
        this.configFile = configFile;

        this.ndk = new NDK({
            explicitRelayUrls: adminConfig.adminRelays,
            signer: new NDKPrivateKeySigner(adminConfig.key),
        });
        this.rpc = new NDKNostrRpc(this.ndk, this.ndk.signer!, debug);

        this.readyPromise = new Promise((resolve) => {
            this.readyResolver = resolve;
        });

        this.initialize();
    }

    private async initialize(): Promise<void> {
        try {
            this.signerUser = await this.ndk.signer?.user();
            if (!this.signerUser) {
                throw new Error('Unable to derive admin signer user');
            }

            this.writeConnectionStrings(this.signerUser);
            await this.maybeNotifyAdmins(this.signerUser);

            if (this.adminConfig.npubs.length === 0) {
                console.log('❌ Admin interface disabled: no admin npubs configured');
                return;
            }

            await this.ndk.connect(2_500);
            this.registerRpcHandlers();
            this.startHeartbeat();
        } catch (error) {
            console.log(`❌ Failed to start admin interface: ${(error as Error).message}`);
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

    private writeConnectionStrings(user: NDKUser): void {
        const relays = this.resolveConnectionRelays();
        const secret = this.adminConfig.secret?.trim().toLowerCase() || undefined;

        const hexUri = this.buildBunkerUri(user.pubkey, relays, secret);
        const npubUri = this.buildBunkerUri(user.npub, relays, secret);

        console.log(`\nConnection URI (hex): ${hexUri}\n`);

        const folder = path.dirname(this.configFile);
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(path.join(folder, 'connection.txt'), `${hexUri}\n`);

        this.connectionInfo = {
            npub: user.npub,
            pubkey: user.pubkey,
            npubUri,
            hexUri,
            relays,
            secret,
        };

        this.readyResolver?.();
        this.readyResolver = undefined;
    }

    private async maybeNotifyAdmins(user: NDKUser): Promise<void> {
        if (!this.adminConfig.notifyAdminsOnBoot || this.adminConfig.npubs.length === 0) {
            return;
        }

        const relayUrls = this.adminConfig.adminRelays.length
            ? this.adminConfig.adminRelays
            : ['wss://relay.nostr.band'];

        const announcer = new NDK({
            explicitRelayUrls: relayUrls,
            signer: this.ndk.signer,
        });

        await announcer.connect(2_500);
        const relays = this.connectionInfo?.relays ?? this.resolveConnectionRelays();
        const secret = (this.connectionInfo?.secret ?? this.adminConfig.secret)?.trim().toLowerCase();
        const npubUri = this.buildBunkerUri(user.npub, relays, secret);
        const hexUri = this.buildBunkerUri(user.pubkey, relays, secret);
        for (const npub of this.adminConfig.npubs) {
            const message = `Signet is ready.\nnpub URI: ${npubUri}\nhex URI: ${hexUri}`;
            await dmUser(announcer, npub, message);
        }
        const maybeDisconnect = (announcer as unknown as { disconnect?: () => Promise<void> | void }).disconnect;
        if (typeof maybeDisconnect === 'function') {
            await maybeDisconnect.call(announcer);
        }
    }

    private registerRpcHandlers(): void {
        if (!this.signerUser) {
            return;
        }

        this.ndk.pool.on('relay:connect', () => console.log('✅ Admin interface connected'));
        this.ndk.pool.on('relay:disconnect', () => console.log('❌ Admin interface disconnected'));

        this.rpc.subscribe({
            kinds: [NDKKind.NostrConnect, 24134 as number],
            '#p': [this.signerUser.pubkey],
        });

        this.rpc.on('request', (req: NDKRpcRequest) => {
            this.handleRpcRequest(req).catch((error) => {
                debug(`Error processing admin request ${req.method}:`, error);
            });
        });

        this.rpc.on('notice', (notice) => {
            console.log('📡 admin notice', notice);
        });

    }

    private async handleRpcRequest(req: NDKRpcRequest): Promise<void> {
        if (req.method !== 'create_account') {
            const allowed = await validateAdminRequest(req, this.adminConfig.npubs);
            if (!allowed) {
                throw new Error('You are not authorised to perform this action');
            }
        }

        switch (req.method) {
            case 'get_keys':
                await this.replyWithKeys(req);
                break;
            case 'get_key_users':
                await this.replyWithKeyUsers(req);
                break;
            case 'rename_key_user':
                await renameKeyUser(this, req);
                break;
            case 'get_key_tokens':
                await this.replyWithTokens(req);
                break;
            case 'revoke_user':
                await revokeUser(this, req);
                break;
            case 'create_new_key':
                await createNewKey(this, req);
                break;
            case 'create_account':
                await createAccount(this, req);
                break;
            case 'ping':
                await ping(this, req);
                break;
            case 'unlock_key':
                await unlockKey(this, req);
                break;
            case 'create_new_policy':
                await createNewPolicy(this, req);
                break;
            case 'get_policies':
                await this.replyWithPolicies(req);
                break;
            case 'create_new_token':
                await createNewToken(this, req);
                break;
            default:
                this.rpc.sendResponse(
                    req.id,
                    req.pubkey,
                    JSON.stringify(['error', `Unknown method ${req.method}`]),
                    req.event.kind ?? NDKKind.NostrConnectAdmin
                );
        }
    }

    private async replyWithKeys(req: NDKRpcRequest): Promise<void> {
        if (!this.getKeys) {
            throw new Error('getKeys handler not configured');
        }

        const keys = await this.getKeys();
        this.rpc.sendResponse(req.id, req.pubkey, JSON.stringify(keys), 24134);
    }

    private async replyWithKeyUsers(req: NDKRpcRequest): Promise<void> {
        if (!this.getKeyUsers) {
            throw new Error('getKeyUsers handler not configured');
        }

        const users = await this.getKeyUsers(req);
        this.rpc.sendResponse(req.id, req.pubkey, JSON.stringify(users), 24134);
    }

    private async replyWithTokens(req: NDKRpcRequest): Promise<void> {
        const keyName = req.params[0] as string;
        const tokens = await prisma.token.findMany({
            where: { keyName },
            include: {
                policy: { include: { rules: true } },
                KeyUser: true,
            },
        });

        const keys = this.getKeys ? await this.getKeys() : [];
        const key = keys.find((k) => k.name === keyName);
        const npub = key?.npub ?? '';

        const payload = tokens.map((token) => ({
            id: token.id,
            key_name: token.keyName,
            client_name: token.clientName,
            token: npub ? `${npub}#${token.token}` : token.token,
            policy_id: token.policyId,
            policy_name: token.policy?.name,
            created_at: token.createdAt,
            updated_at: token.updatedAt,
            expires_at: token.expiresAt,
            redeemed_at: token.redeemedAt,
            redeemed_by: token.KeyUser?.description,
            time_until_expiration: token.expiresAt
                ? (token.expiresAt.getTime() - Date.now()) / 1_000
                : null,
        }));

        this.rpc.sendResponse(req.id, req.pubkey, JSON.stringify(payload), 24134);
    }

    private async replyWithPolicies(req: NDKRpcRequest): Promise<void> {
        const policies = await prisma.policy.findMany({
            include: { rules: true },
        });

        const payload = policies.map((policy) => ({
            id: policy.id,
            name: policy.name,
            description: policy.description,
            created_at: policy.createdAt,
            updated_at: policy.updatedAt,
            expires_at: policy.expiresAt,
            rules: policy.rules.map((rule) => ({
                method: rule.method,
                kind: rule.kind,
                max_usage_count: rule.maxUsageCount,
                current_usage_count: rule.currentUsageCount,
            })),
        }));

        this.rpc.sendResponse(req.id, req.pubkey, JSON.stringify(payload), 24134);
    }

    private startHeartbeat(): void {
        if (!this.signerUser) {
            return;
        }

        const subscriber = this.ndk.subscribe({
            authors: [this.signerUser.pubkey],
            kinds: [NDKKind.NostrConnect],
            '#p': [this.signerUser.pubkey],
        });

        let timeout: NodeJS.Timeout | undefined;
        const schedule = () => {
            if (timeout) clearTimeout(timeout);
            timeout = setTimeout(() => {
                console.log('❌ No admin ping received in 50 seconds. Exiting.');
                process.exit(1);
            }, 50_000);
        };

        subscriber.on('event', (event: NDKEvent) => {
            debug('Received admin ping at', event.created_at);
            schedule();
        });

        subscriber.start();
        schedule();

        setInterval(() => {
            const pingEvent = new NDKEvent(this.ndk, {
                kind: NDKKind.NostrConnect,
                tags: [['p', this.signerUser!.pubkey]],
                content: 'ping',
            });

            pingEvent.publish().catch((error) => {
                console.log(`❌ Failed to publish admin ping: ${(error as Error).message}`);
            });
        }, 20_000);
    }

    public async requestPermission(
        keyName: string | undefined,
        remotePubkey: string,
        method: string,
        param?: string | NDKEvent
    ): Promise<boolean | undefined> {
        if (!this.signerUser || this.adminConfig.npubs.length === 0) {
            return undefined;
        }

        const keyUser = keyName
            ? await prisma.keyUser.findUnique({
                  where: { unique_key_user: { keyName, userPubkey: remotePubkey } },
              })
            : null;

        const serializedParam =
            param instanceof NDKEvent ? JSON.stringify(param.rawEvent()) : param ?? null;

        const payload = JSON.stringify({
            keyName,
            remotePubkey,
            method,
            param: serializedParam,
            description: keyUser?.description,
        });

        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(undefined), 10_000);

            for (const npub of this.adminConfig.npubs) {
                try {
                    const adminUser = new NDKUser({ npub });
                    this.rpc.sendRequest(
                        adminUser.pubkey,
                        'acl',
                        [payload],
                        24134,
                        async (response: NDKRpcResponse) => {
                            clearTimeout(timer);
                            const decision = await this.handlePermissionResponse(
                                remotePubkey,
                                keyName,
                                method,
                                serializedParam,
                                response
                            );
                            resolve(decision);
                        }
                    );
                } catch (error) {
                    debug(`Unable to request permission from ${npub}:`, error);
                }
            }
        });
    }

    private async handlePermissionResponse(
        remotePubkey: string,
        keyName: string | undefined,
        method: string,
        param: string | null,
        response: NDKRpcResponse
    ): Promise<boolean | undefined> {
        if (!keyName) {
            return undefined;
        }

        try {
            const parsed = JSON.parse(response.result as string);
            const decision = parsed[0] as string;
            const description = parsed[1] as string | undefined;
            const scope = parsed[2] as AllowScope | undefined;

            switch (decision) {
                case 'always':
                    await permitAllRequests(remotePubkey, keyName, method as RpcMethod, description, scope);
                    return true;
                case 'never':
                    await blockAllRequests(remotePubkey, keyName);
                    return false;
                case 'allow':
                case true:
                    return true;
                case 'deny':
                case false:
                    return false;
                default:
                    return undefined;
            }
        } catch (error) {
            debug('Failed to process permission response', error, response);
        }

        return undefined;
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
            relaySources = [...this.adminConfig.adminRelays];
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
