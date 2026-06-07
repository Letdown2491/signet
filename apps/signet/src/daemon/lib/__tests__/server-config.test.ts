import { describe, it, expect } from 'vitest';
import { resolveServerBinding } from '../server-config.js';

describe('resolveServerBinding', () => {
    it('lets the env host override the persisted config host (the Docker case)', () => {
        const result = resolveServerBinding(
            { authHost: '127.0.0.1', authPort: 3000, baseUrl: 'http://localhost:4174' },
            { SIGNET_HOST: '0.0.0.0' } as NodeJS.ProcessEnv,
        );
        expect(result.host).toBe('0.0.0.0');
    });

    it('falls back to the config host when no env var is set', () => {
        const result = resolveServerBinding({ authHost: '127.0.0.1', authPort: 3000 }, {} as NodeJS.ProcessEnv);
        expect(result.host).toBe('127.0.0.1');
    });

    it('defaults host to loopback when neither env nor config provide one', () => {
        const result = resolveServerBinding({ authPort: 3000 }, {} as NodeJS.ProcessEnv);
        expect(result.host).toBe('127.0.0.1');
    });

    it('treats a blank env var as unset', () => {
        const result = resolveServerBinding(
            { authHost: '127.0.0.1', authPort: 3000 },
            { SIGNET_HOST: '   ' } as NodeJS.ProcessEnv,
        );
        expect(result.host).toBe('127.0.0.1');
    });

    it('honours the legacy AUTH_HOST/BASE_URL names, current taking priority', () => {
        const result = resolveServerBinding(
            { authHost: 'config-host', baseUrl: 'config-url' },
            { AUTH_HOST: 'legacy-host', SIGNET_HOST: 'current-host', BASE_URL: 'legacy-url' } as NodeJS.ProcessEnv,
        );
        expect(result.host).toBe('current-host');
        expect(result.baseUrl).toBe('legacy-url');
    });

    it('lets the env port override config and parses it to a number', () => {
        const result = resolveServerBinding({ authPort: 3000 }, { SIGNET_PORT: '3100' } as NodeJS.ProcessEnv);
        expect(result.port).toBe(3100);
    });

    it('falls back to the config port when the env port is not a valid integer', () => {
        const result = resolveServerBinding({ authPort: 3000 }, { SIGNET_PORT: 'nope' } as NodeJS.ProcessEnv);
        expect(result.port).toBe(3000);
    });

    it('returns an undefined port when nothing configures one (HTTP server disabled)', () => {
        const result = resolveServerBinding({}, {} as NodeJS.ProcessEnv);
        expect(result.port).toBeUndefined();
    });

    it('lets EXTERNAL_URL override the persisted config baseUrl', () => {
        const result = resolveServerBinding(
            { baseUrl: 'http://localhost:4174' },
            { EXTERNAL_URL: 'http://signet.tailnet.ts.net:4174' } as NodeJS.ProcessEnv,
        );
        expect(result.baseUrl).toBe('http://signet.tailnet.ts.net:4174');
    });
});
