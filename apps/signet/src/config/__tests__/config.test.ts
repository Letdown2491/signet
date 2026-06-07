import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfig } from '../config.js';

const dir = mkdtempSync(join(tmpdir(), 'signet-config-test-'));

function writeConfig(relays: string[]): string {
    const path = join(dir, `signet-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(
        path,
        JSON.stringify({
            nostr: { relays },
            admin: { key: 'adminkey', secret: 'adminsecret' },
            keys: {},
            verbose: false,
            jwtSecret: 'jwtsecret',
            allowedOrigins: ['http://localhost:4174'],
            authPort: 3000,
            authHost: '127.0.0.1',
            baseUrl: 'http://localhost:4174',
            requireAuth: false,
        }),
    );
    return path;
}

describe('loadConfig — deprecated relay migration', () => {
    afterAll(() => {
        try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    });

    it('removes relay.damus.io and keeps the other relays', async () => {
        const path = writeConfig(['wss://relay.primal.net', 'wss://relay.damus.io', 'wss://nos.lol']);
        const config = await loadConfig(path);
        expect(config.nostr.relays).toEqual(['wss://relay.primal.net', 'wss://nos.lol']);
    });

    it('matches case-insensitively and ignores a trailing slash', async () => {
        const path = writeConfig(['wss://Relay.Damus.io/', 'wss://nos.lol']);
        const config = await loadConfig(path);
        expect(config.nostr.relays).toEqual(['wss://nos.lol']);
    });

    it('falls back to defaults when damus was the only relay', async () => {
        const path = writeConfig(['wss://relay.damus.io']);
        const config = await loadConfig(path);
        expect(config.nostr.relays.length).toBeGreaterThan(0);
        expect(config.nostr.relays.map((r) => r.toLowerCase())).not.toContain('wss://relay.damus.io');
    });

    it('leaves a config without damus unchanged', async () => {
        const relays = ['wss://relay.primal.net', 'wss://nos.lol'];
        const path = writeConfig(relays);
        const config = await loadConfig(path);
        expect(config.nostr.relays).toEqual(relays);
    });
});
