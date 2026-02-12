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

export async function loadConfig(configPath: string): Promise<ConfigFile> {
    let config: ConfigFile;
    let needsSave = false;

    if (!existsSync(configPath)) {
        // Create default config on first boot
        config = {
            nostr: {
                relays: [
                    'wss://relay.nip46.com',
                    'wss://relay.primal.net',
                    'wss://relay.damus.io',
                    'wss://theforest.nostr1.com',
                    'wss://nostr.oxtr.dev',
                ],
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

    // Persist auto-generated config/secrets
    if (needsSave) {
        await saveConfig(configPath, config);
    }

    return config;
}

export async function saveConfig(configPath: string, config: ConfigFile): Promise<void> {
    const dir = dirname(configPath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    const contents = JSON.stringify(config, null, 2);
    writeFileSync(configPath, contents + '\n', 'utf8');

    // Restrict permissions to owner only (contains secrets)
    try {
        chmodSync(configPath, 0o600);
    } catch {
        // chmod may fail on Windows - permissions handled differently there
    }
}
