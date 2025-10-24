import { readFileSync, writeFileSync } from 'fs';
import { NDKPrivateKeySigner, type NDKRpcRequest, type NDKUserProfile } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import AdminInterface from '../index.js';
import { loadConfig, saveConfig } from '../../../config/config.js';
import type { ConfigFile, DomainConfig } from '../../../config/types.js';
import { createSkeletonProfile } from '../../lib/profile.js';
import { createWalletForUser } from './account/wallet.js';
import prisma from '../../../db.js';
import { permitAllRequests } from '../../lib/acl.js';
import { requestAuthorization } from '../../authorize.js';

const RESERVED_USERNAMES = new Set(['admin', 'root', '_', 'administrator', '__']);

type Nip05Directory = {
    names: Record<string, string>;
    relays?: Record<string, string[]>;
    nip46?: Record<string, string[]>;
};

async function ensureUsernameAvailable(config: ConfigFile, domain: string, username: string): Promise<void> {
    const nip05Path = config.domains?.[domain]?.nip05;
    if (!nip05Path) {
        throw new Error(`Domain ${domain} is missing nip05 configuration`);
    }

    const directory = loadNip05Directory(nip05Path);
    if (directory.names[username]) {
        throw new Error('Username already exists for this domain');
    }
}

function loadNip05Directory(path: string): Nip05Directory {
    try {
        const contents = readFileSync(path, 'utf8');
        return JSON.parse(contents) as Nip05Directory;
    } catch {
        return { names: {}, relays: {}, nip46: {} };
    }
}

function updateNip05Directory(
    path: string,
    directory: Nip05Directory,
    username: string,
    pubkey: string,
    relays: string[]
): void {
    directory.names[username] = pubkey;
    directory.relays ??= {};
    directory.nip46 ??= {};
    directory.relays[username] = relays;
    directory.nip46[pubkey] = relays;

    writeFileSync(path, JSON.stringify(directory, null, 2));
}

function selectDomain(config: ConfigFile, requested?: string): string {
    const domains = config.domains ? Object.keys(config.domains) : [];
    if (!domains.length) {
        throw new Error('No domains configured for account creation');
    }

    if (!requested) {
        return domains[0];
    }

    if (!config.domains?.[requested]) {
        throw new Error(`Domain ${requested} is not available`);
    }

    return requested;
}

function sanitizeUsername(username?: string): string {
    const candidate = username && username.trim().length > 0
        ? username.trim()
        : Math.random().toString(36).slice(2, 12);

    if (RESERVED_USERNAMES.has(candidate)) {
        throw new Error('Username is reserved');
    }

    return candidate;
}

function buildProfile(domainConfig: DomainConfig, nip05: string): NDKUserProfile {
    const profile: NDKUserProfile = {
        display_name: nip05.split('@')[0],
        name: nip05.split('@')[0],
        nip05,
        ...(domainConfig.defaultProfile ?? {}),
    };

    return profile;
}

async function grantDefaultPermissions(remotePubkey: string, keyName: string): Promise<void> {
    await permitAllRequests(remotePubkey, keyName, 'connect');
    await permitAllRequests(remotePubkey, keyName, 'sign_event', undefined, { kind: 'all' });
    await permitAllRequests(remotePubkey, keyName, 'encrypt');
    await permitAllRequests(remotePubkey, keyName, 'decrypt');
}

export default async function createAccount(admin: AdminInterface, req: NDKRpcRequest): Promise<void> {
    const [rawUsername, rawDomain, email] = req.params as [string | undefined, string | undefined, string | undefined];
    const config = await admin.config();

    const domain = selectDomain(config, rawDomain);
    const domainConfig = config.domains?.[domain];
    if (!domainConfig) {
        throw new Error(`Domain ${domain} is not configured`);
    }

    let username: string;
    try {
        username = sanitizeUsername(rawUsername);
    } catch (error) {
        admin.rpc.sendResponse(
            req.id,
            req.pubkey,
            JSON.stringify(['error', (error as Error).message]),
            24134
        );
        return;
    }

    const nip05 = `${username}@${domain}`;
    const payloadForApproval = JSON.stringify([username, domain, email ?? '']);

    const approvalPayload = await requestAuthorization(
        admin,
        nip05,
        req.pubkey,
        req.id,
        req.method,
        payloadForApproval
    );

    if (!approvalPayload) {
        return;
    }

    const [approvedUsername, approvedDomain, approvedEmail] = JSON.parse(approvalPayload) as [
        string,
        string,
        string?
    ];

    const finalDomain = approvedDomain ?? domain;
    const finalUsername = approvedUsername ?? username;
    const updatedConfig = await admin.config();

    const finalDomainConfig = updatedConfig.domains?.[finalDomain];
    if (!finalDomainConfig) {
        throw new Error(`Domain ${finalDomain} is not configured`);
    }

    await ensureUsernameAvailable(updatedConfig, finalDomain, finalUsername);

    const signer = NDKPrivateKeySigner.generate();
    const user = await signer.user();

    const nip05File = finalDomainConfig.nip05;
    const directory = loadNip05Directory(nip05File);
    updateNip05Directory(
        nip05File,
        directory,
        finalUsername,
        user.pubkey,
        updatedConfig.nostr.relays
    );

    const profile = buildProfile(finalDomainConfig, `${finalUsername}@${finalDomain}`);

    if (finalDomainConfig.wallet) {
        try {
            const lnAddress = await createWalletForUser(
                finalDomainConfig.wallet,
                finalUsername,
                finalDomain,
                user.npub
            );
            if (lnAddress) {
                profile.lud16 = lnAddress;
            }
        } catch (walletError) {
            console.log(`⚠️ Wallet provisioning failed: ${(walletError as Error).message}`);
        }
    }

    await createSkeletonProfile(signer, profile, approvedEmail ?? undefined);

    const nsec = nip19.nsecEncode(signer.privateKey!);

    const configToSave = await loadConfig(admin.configFile);
    configToSave.keys[`${finalUsername}@${finalDomain}`] = { key: signer.privateKey };
    await saveConfig(admin.configFile, configToSave);

    admin.loadKeyMaterial?.(`${finalUsername}@${finalDomain}`, nsec);

    await prisma.key.create({
        data: {
            keyName: `${finalUsername}@${finalDomain}`,
            pubkey: user.pubkey,
        },
    });

    await grantDefaultPermissions(req.pubkey, `${finalUsername}@${finalDomain}`);

    admin.rpc.sendResponse(req.id, req.pubkey, user.pubkey, 24134);
}
