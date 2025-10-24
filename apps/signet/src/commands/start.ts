import readline from 'readline';
import { fork } from 'child_process';
import { existsSync } from 'fs';
import { resolve } from 'path';
import NDK, {
    NDKAppHandlerEvent,
    NDKKind,
    NDKPrivateKeySigner,
    NDKUser,
    NostrEvent,
} from '@nostr-dev-kit/ndk';
import { loadConfig, saveConfig } from '../config/config.js';
import type { ConfigFile, DomainConfig, StoredKey } from '../config/types.js';
import { decryptSecret } from '../config/keyring.js';
import type { DaemonBootstrapConfig } from '../daemon/types.js';

export type StartOptions = {
    configPath: string;
    keyNames?: string[];
    verbose: boolean;
    adminNpubs?: string[];
};

function ask(prompt: string, rl: readline.Interface): Promise<string> {
    return new Promise((resolve) => rl.question(prompt, resolve));
}

async function unlockKeyInteractively(name: string, entry: StoredKey, verbose: boolean): Promise<string | undefined> {
    if (entry.iv && entry.data) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        try {
            const passphrase = await ask(`Passphrase for ${name}: `, rl);
            const decrypted = decryptSecret({ iv: entry.iv, data: entry.data }, passphrase);
            if (verbose) {
                console.log(`Key "${name}" decrypted.`);
            }
            return decrypted;
        } catch (error) {
            console.error(`Unable to decrypt key "${name}": ${(error as Error).message}`);
            process.exit(1);
        } finally {
            rl.close();
        }
    }

    if (entry.key) {
        if (verbose) {
            console.log(`Using plain key material for "${name}".`);
        }
        return entry.key;
    }

    console.warn(`No stored data for key "${name}".`);
    return undefined;
}

async function announceDomain(
    domainName: string,
    domainConfig: DomainConfig,
    adminSigner: NDKPrivateKeySigner
): Promise<void> {
    const nip89 = domainConfig.nip89;
    if (!nip89) {
        return;
    }

    if (!nip89.relays || nip89.relays.length === 0) {
        console.log(`❌ No relays configured for NIP-89 announcement on ${domainName}`);
        return;
    }

    const ndk = new NDK({ explicitRelayUrls: nip89.relays });
    ndk.signer = adminSigner;

    try {
        await ndk.connect(5_000);
        const adminUser = await adminSigner.user();
        const nip05Identifier = `_@${domainName}`;
        const nip05User = await NDKUser.fromNip05(nip05Identifier, ndk);

        if (!nip05User) {
            console.log(`❌ ${nip05Identifier} could not be resolved when preparing NIP-89 announcement.`);
            return;
        }

        if (nip05User.pubkey !== adminUser.pubkey) {
            console.log(
                `❌ ${nip05Identifier} resolves to ${nip05User.pubkey}, expected ${adminUser.pubkey}.`
            );
            return;
        }

        const announcement = new NDKAppHandlerEvent(ndk, {
            tags: [
                ['alt', `Signet announcement for ${domainName}`],
                ['k', NDKKind.NostrConnect.toString()],
            ],
        } as NostrEvent);

        const existing = await ndk.fetchEvent({
            authors: [adminUser.pubkey],
            kinds: [NDKKind.AppHandler],
            '#k': [NDKKind.NostrConnect.toString()],
        });

        const deterministicTag =
            existing?.tagValue('d') ?? NDKKind.NostrConnect.toString();

        announcement.tags.push(['d', deterministicTag]);

        if (nip89.operator) {
            try {
                const operator = new NDKUser({ npub: nip89.operator });
                announcement.tags.push(['p', operator.pubkey]);
            } catch (error) {
                console.log(
                    `⚠️ Skipping operator tag for ${domainName}: ${(error as Error).message}`
                );
            }
        }

        if (domainConfig.wallet?.lnbits?.nostdressUrl) {
            announcement.tags.push(['f', 'wallet'], ['f', 'zaps']);
        }

        const profile = { ...nip89.profile, nip05: nip05Identifier };
        announcement.content = JSON.stringify(profile);

        await announcement.publish();
        console.log(`✅ NIP-89 announcement published for ${domainName}`);
    } catch (error) {
        console.log(
            `❌ Failed to publish NIP-89 announcement for ${domainName}: ${(error as Error).message}`
        );
    } finally {
        ndk.pool?.disconnect();
    }
}

async function publishNip89Announcements(config: ConfigFile): Promise<void> {
    if (!config.domains || Object.keys(config.domains).length === 0) {
        return;
    }

    const signer = new NDKPrivateKeySigner(config.admin.key);

    for (const [domainName, domainConfig] of Object.entries(config.domains)) {
        if (domainConfig.nip89) {
            await announceDomain(domainName, domainConfig, signer);
        }
    }
}

function resolveDaemonEntry(cwd: string): string | undefined {
    const candidates = [
        resolve(cwd, 'dist/daemon/index.js'),
        resolve(cwd, 'src/daemon/index.ts'),
    ];

    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }

    return undefined;
}

export async function runStart(options: StartOptions): Promise<void> {
    const config = await loadConfig(options.configPath);

    if (options.adminNpubs && options.adminNpubs.length > 0) {
        const deduped = Array.from(new Set(options.adminNpubs));
        config.admin.npubs = deduped;
        console.log(`✅ Admin npubs configured: ${deduped.join(', ')}`);
    } else {
        if (config.admin.npubs.length === 0) {
            console.log('❌ No admin npubs defined. Add at least one to control the bunker.');
        }
    }

    if (options.verbose) {
        config.verbose = true;
    }

    await saveConfig(options.configPath, config);
    await publishNip89Announcements(config);

    const keysToStart = options.keyNames ?? [];
    const activeKeys: Record<string, string> = {};

    for (const keyName of keysToStart) {
        const entry = config.keys[keyName];
        if (!entry) {
            console.log(`⚠️ Key "${keyName}" not found in configuration.`);
            continue;
        }

        const unlocked = await unlockKeyInteractively(keyName, entry, config.verbose);
        if (unlocked) {
            activeKeys[keyName] = unlocked;
        }
    }

    const daemonEntry = resolveDaemonEntry(process.cwd());
    if (!daemonEntry) {
        console.error('❌ Unable to locate daemon entry point. Run the build step first.');
        process.exit(1);
    }

    const daemon = fork(daemonEntry);
    const { keys: storedKeys, ...restConfig } = config;
    const payload: DaemonBootstrapConfig = {
        ...restConfig,
        keys: activeKeys,
        configFile: options.configPath,
        allKeys: { ...storedKeys },
    };

    daemon.send(payload);
}
