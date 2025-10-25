import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { ConfigFile } from './types.js';

export async function loadConfig(configPath: string): Promise<ConfigFile> {
    if (!existsSync(configPath)) {
        // Return default config if file doesn't exist
        return {
            nostr: {
                relays: ['wss://relay.damus.io', 'wss://relay.primal.net', 'wss://nos.lol'],
            },
            admin: {
                npubs: [],
                adminRelays: ['wss://relay.nsec.app'],
                key: '',
                notifyAdminsOnBoot: false,
            },
            database: 'sqlite://signet.db',
            logs: './signet.log',
            keys: {},
            verbose: false,
        };
    }

    const contents = readFileSync(configPath, 'utf8');
    const config = JSON.parse(contents) as ConfigFile;

    // Ensure required fields exist with defaults
    config.nostr ??= { relays: ['wss://relay.damus.io'] };
    config.admin ??= { npubs: [], adminRelays: ['wss://relay.nsec.app'], key: '' };
    config.keys ??= {};
    config.verbose ??= false;

    return config;
}

export async function saveConfig(configPath: string, config: ConfigFile): Promise<void> {
    const dir = dirname(configPath);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }

    const contents = JSON.stringify(config, null, 2);
    writeFileSync(configPath, contents + '\n', 'utf8');
}
