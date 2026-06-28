import { describe, it, expect, afterEach } from 'vitest';
import { isBlockedAddress, fetchAvatar, getAvatar, clearAvatarCache } from '../image-proxy.js';

describe('isBlockedAddress (SSRF gate)', () => {
    it('blocks IPv4 loopback, private, link-local, and metadata ranges', () => {
        const blocked = [
            '127.0.0.1',
            '127.5.5.5',
            '10.0.0.1',
            '10.255.255.255',
            '172.16.0.1',
            '172.31.255.255',
            '192.168.1.1',
            '169.254.169.254', // cloud metadata
            '0.0.0.0',
            '100.64.0.1', // CGNAT
            '198.18.0.1', // benchmarking
            '224.0.0.1', // multicast
            '255.255.255.255',
            '192.0.0.1',
        ];
        for (const ip of blocked) {
            expect(isBlockedAddress(ip), ip).toBe(true);
        }
    });

    it('allows ordinary public IPv4 addresses', () => {
        const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '192.167.1.1'];
        for (const ip of allowed) {
            expect(isBlockedAddress(ip), ip).toBe(false);
        }
    });

    it('blocks IPv6 loopback, unspecified, ULA, link-local, and multicast', () => {
        const blocked = ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1'];
        for (const ip of blocked) {
            expect(isBlockedAddress(ip), ip).toBe(true);
        }
    });

    it('allows public IPv6 and blocks IPv4-mapped private addresses', () => {
        expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false); // public (Cloudflare)
        expect(isBlockedAddress('::ffff:10.0.0.1')).toBe(true); // mapped private
        expect(isBlockedAddress('::ffff:8.8.8.8')).toBe(false); // mapped public
    });

    it('refuses anything that is not a parseable IP', () => {
        for (const v of ['', 'not-an-ip', 'localhost', '999.999.999.999', '12345']) {
            expect(isBlockedAddress(v), v).toBe(true);
        }
    });
});

describe('fetchAvatar scheme enforcement', () => {
    it('rejects non-https and malformed URLs without making a request', async () => {
        expect(await fetchAvatar('http://example.com/a.png')).toBeNull();
        expect(await fetchAvatar('ftp://example.com/a.png')).toBeNull();
        expect(await fetchAvatar('file:///etc/passwd')).toBeNull();
        expect(await fetchAvatar('not a url')).toBeNull();
    });
});

describe('getAvatar negative caching', () => {
    afterEach(() => clearAvatarCache());

    it('caches a rejected URL so it resolves null without refetching', async () => {
        // http:// fails the scheme gate synchronously; the cache should hold the null.
        const url = 'http://example.com/icon.png';
        expect(await getAvatar(url)).toBeNull();
        expect(await getAvatar(url)).toBeNull();
    });
});
