import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from 'fs';
import { dirname } from 'path';
import crypto from 'crypto';
import type { ConfigFile } from './types.js';

/**
 * Generate a cryptographically secure secret
 */
function generateSecret(bytes: number = 32): string {
    return crypto.randomBytes(bytes).toString('hex');
}

/** Default NIP-46 relay set used for fresh installs. */
const DEFAULT_RELAYS = [
    'wss://relay.nip46.com',
    'wss://relay.primal.net',
    'wss://theforest.nostr1.com',
    'wss://nostr.oxtr.dev',
];

/**
 * Relays removed from existing configs on load. relay.damus.io rejects NIP-46
 * (kind 24133) events, so connections through it never complete.
 */
const DEPRECATED_RELAYS = ['wss://relay.damus.io'];

function normalizeRelayUrl(url: string): string {
    return url.trim().replace(/\/+$/, '').toLowerCase();
}

export async function loadConfig(configPath: string): Promise<ConfigFile> {
    let config: ConfigFile;
    let needsSave = false;

    if (!existsSync(configPath)) {
        // Create default config on first boot
        config = {
            nostr: {
                relays: [...DEFAULT_RELAYS],
            },
            admin: {
                key: generateSecret(32),
                secret: generateSecret(32),
            },
            database: 'sqlite://signet.db',
            logs: './signet.log',
            keys: {},
            verbose: false,
            jwtSecret: generateSecret(32),
            allowedOrigins: [
                'http://localhost:4174',
                'http://localhost:3000',
                'http://127.0.0.1:4174',
                'http://127.0.0.1:3000',
            ],
            authPort: 3000,
            authHost: '127.0.0.1',
            baseUrl: 'http://localhost:4174',
            requireAuth: false,
        };
        needsSave = true;
    } else {
        const contents = readFileSync(configPath, 'utf8');
        config = JSON.parse(contents) as ConfigFile;

        // Ensure required fields exist with defaults
        config.nostr ??= { relays: ['wss://relay.primal.net'] };
        config.admin ??= { key: '' };
        config.keys ??= {};
        config.verbose ??= false;

        // Auto-generate admin key if not present
        if (!config.admin.key) {
            config.admin.key = generateSecret(32);
            needsSave = true;
        }

        // Auto-generate admin secret (for bunker URI) if not present
        if (!config.admin.secret) {
            config.admin.secret = generateSecret(32);
            needsSave = true;
        }

        // Generate JWT secret if not present
        if (!config.jwtSecret) {
            config.jwtSecret = generateSecret(32);
            needsSave = true;
        }

        // Set default allowed origins if not present
        if (!config.allowedOrigins) {
            config.allowedOrigins = [
                'http://localhost:4174',
                'http://localhost:3000',
                'http://127.0.0.1:4174',
                'http://127.0.0.1:3000',
            ];
            needsSave = true;
        }

        // Set default authPort if not present (enables HTTP server)
        if (config.authPort === undefined) {
            config.authPort = 3000;
            needsSave = true;
        }

        // Set default authHost if not present
        if (config.authHost === undefined) {
            config.authHost = '127.0.0.1';
            needsSave = true;
        }

        // Set default baseUrl if not present (for authorization redirects)
        if (config.baseUrl === undefined) {
            config.baseUrl = 'http://localhost:4174';
            needsSave = true;
        }

        // Set default requireAuth if not present
        if (config.requireAuth === undefined) {
            config.requireAuth = false;
            needsSave = true;
        }
    }

    // One-time migration: strip deprecated relays from existing configs.
    if (config.nostr?.relays?.length) {
        const cleaned = config.nostr.relays.filter(
            (relay) => !DEPRECATED_RELAYS.includes(normalizeRelayUrl(relay))
        );
        if (cleaned.length !== config.nostr.relays.length) {
            // Never leave the signer with zero relays.
            config.nostr.relays = cleaned.length > 0 ? cleaned : [...DEFAULT_RELAYS];
            needsSave = true;
        }
    }

    // Persist auto-generated config/secrets
    if (needsSave) {
        await saveConfig(configPath, config);
    }

    return config;
}

export async function saveConfig(configPath: string, config: ConfigFile): Promise<void> {
    const dir = dirname(configPath);
    if (!existsSync(dir)) {
        // Owner-only directory; the config holds secrets (jwtSecret, admin secret,
        // and possibly unencrypted keys).
        mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    const contents = JSON.stringify(config, null, 2);
    // Create the file owner-only from the start (mode applies on creation) so the
    // secrets are never briefly readable at the process umask.
    writeFileSync(configPath, contents + '\n', { encoding: 'utf8', mode: 0o600 });

    // Re-assert permissions in case the file pre-existed with looser modes.
    // On POSIX a chmod failure here means we cannot guarantee secrecy, so surface
    // it instead of silently continuing. Windows (EPERM/ENOTSUP) is tolerated.
    try {
        chmodSync(configPath, 0o600);
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (process.platform !== 'win32' && code !== 'ENOTSUP' && code !== 'EPERM') {
            throw new Error(`Failed to restrict permissions on ${configPath}: ${(error as Error).message}`);
        }
    }
}
