/**
 * SSRF-guarded avatar proxy.
 *
 * Connected apps may supply an `image` URL in their NIP-46 connect metadata. That URL is
 * untrusted and unauthenticated, so the browser must NEVER fetch it directly (that would
 * leak the operator's IP / online status and trust an attacker-controlled origin). Instead
 * the daemon fetches it here, under tight constraints, caches the bytes, and serves them
 * from `GET /apps/:id/avatar`. The UI falls back to a deterministic identicon on any failure.
 *
 * Defenses:
 * - `https:` only (enforced again here, not just at parse time).
 * - DNS resolution is pinned via a custom `lookup`: the socket connects only to an address
 *   we validated as public, which closes the DNS-rebinding TOCTOU (the IP the kernel dials
 *   is the same one we vetted). TLS still uses the hostname, so cert validation is intact.
 * - Private / loopback / link-local / reserved IPs are rejected (blocks cloud metadata at
 *   169.254.169.254, internal services on RFC1918, etc.).
 * - No redirects (a 3xx is treated as failure, so it can't bounce us to an internal target).
 * - Hard timeout, response-size cap, and a raster-image content-type allowlist (no SVG —
 *   it can carry script/external refs).
 * - Positive + negative caching so we don't refetch (or re-probe a bad URL) on every render,
 *   which also bounds how often the app's server learns the daemon is online.
 */

import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import createDebug from 'debug';

const debug = createDebug('signet:image-proxy');

const MAX_BYTES = 512 * 1024; // 512 KB — generous for an avatar, cheap to cache.
const FETCH_TIMEOUT_MS = 5000;
const POSITIVE_TTL_MS = 60 * 60 * 1000; // 1 hour
const NEGATIVE_TTL_MS = 5 * 60 * 1000; // 5 minutes — don't hammer a broken/blocked URL.
const MAX_CACHE_ENTRIES = 256;

// Raster formats only. SVG is intentionally excluded (active content / external refs).
const ALLOWED_CONTENT_TYPES = new Set([
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'image/avif',
]);

export interface FetchedAvatar {
    contentType: string;
    body: Buffer;
}

/**
 * Is `ip` a private, loopback, link-local, or otherwise non-public address that the proxy
 * must refuse to connect to? Exported for unit testing — this is the core SSRF gate.
 */
export function isBlockedAddress(ip: string): boolean {
    const family = net.isIP(ip);
    if (family === 4) return isBlockedIpv4(ip);
    if (family === 6) return isBlockedIpv6(ip);
    return true; // not a parseable IP → refuse
}

function isBlockedIpv4(ip: string): boolean {
    const parts = ip.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
        return true;
    }
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
    if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved + 255.255.255.255
    return false;
}

function isBlockedIpv6(ip: string): boolean {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded IPv4.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedIpv4(mapped[1]);
    const head = lower.split(':')[0];
    if (head.startsWith('fc') || head.startsWith('fd')) return true; // fc00::/7 unique-local
    if (head.startsWith('fe8') || head.startsWith('fe9') || head.startsWith('fea') || head.startsWith('feb')) {
        return true; // fe80::/10 link-local
    }
    if (head.startsWith('ff')) return true; // ff00::/8 multicast
    return false;
}

/**
 * A DNS lookup that resolves the hostname and returns only an address we've validated as
 * public. Passed to `https.get` so the actual socket connects to a vetted IP (rebinding-safe).
 */
function pinnedLookup(
    hostname: string,
    options: dns.LookupOneOptions | dns.LookupAllOptions,
    callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
): void {
    dns.lookup(hostname, { all: true }, (err, addresses) => {
        if (err) {
            callback(err, '', 0);
            return;
        }
        const safe = addresses.find((a) => !isBlockedAddress(a.address));
        if (!safe) {
            callback(new Error(`blocked non-public address for ${hostname}`), '', 0);
            return;
        }
        if ((options as dns.LookupAllOptions).all) {
            callback(null, [safe]);
        } else {
            callback(null, safe.address, safe.family);
        }
    });
}

/**
 * Fetch an avatar with all SSRF defenses applied. Resolves to the image bytes + content-type,
 * or `null` on any rejection (bad scheme, blocked address, non-200, oversize, wrong type, timeout).
 */
export function fetchAvatar(rawUrl: string): Promise<FetchedAvatar | null> {
    return new Promise((resolve) => {
        let url: URL;
        try {
            url = new URL(rawUrl);
        } catch {
            resolve(null);
            return;
        }
        if (url.protocol !== 'https:') {
            resolve(null);
            return;
        }

        let settled = false;
        const done = (value: FetchedAvatar | null) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        const req = https.get(
            url,
            { lookup: pinnedLookup, timeout: FETCH_TIMEOUT_MS },
            (res) => {
                const status = res.statusCode ?? 0;
                // Any non-200 (including 3xx redirects) is a failure — we never follow.
                if (status !== 200) {
                    debug('avatar fetch non-200 (%d) for %s', status, url.hostname);
                    res.destroy();
                    done(null);
                    return;
                }
                const contentType = (res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
                if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
                    debug('avatar fetch disallowed content-type %s for %s', contentType, url.hostname);
                    res.destroy();
                    done(null);
                    return;
                }

                const chunks: Buffer[] = [];
                let total = 0;
                res.on('data', (chunk: Buffer) => {
                    total += chunk.length;
                    if (total > MAX_BYTES) {
                        debug('avatar fetch exceeded %d bytes for %s', MAX_BYTES, url.hostname);
                        res.destroy();
                        done(null);
                        return;
                    }
                    chunks.push(chunk);
                });
                res.on('end', () => done({ contentType, body: Buffer.concat(chunks) }));
                res.on('error', () => done(null));
            },
        );

        req.on('timeout', () => {
            debug('avatar fetch timeout for %s', url.hostname);
            req.destroy();
            done(null);
        });
        req.on('error', (err) => {
            debug('avatar fetch error for %s: %s', url.hostname, err.message);
            done(null);
        });
    });
}

interface CacheEntry {
    expires: number;
    value: FetchedAvatar | null; // null = negative cache (URL failed validation/fetch)
}

const cache = new Map<string, CacheEntry>();

function now(): number {
    return Date.now();
}

function evictIfNeeded(): void {
    if (cache.size <= MAX_CACHE_ENTRIES) return;
    // Cheap eviction: drop the oldest-inserted entry (Map preserves insertion order).
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
}

/**
 * Fetch-with-cache. Returns the avatar bytes for `url`, or null if it can't be served.
 * Successes are cached for an hour; failures for five minutes (so a hostile or dead URL
 * can't be used to make the daemon hammer a target, and the app's server only periodically
 * learns we're online).
 */
export async function getAvatar(url: string): Promise<FetchedAvatar | null> {
    const cached = cache.get(url);
    if (cached && cached.expires > now()) {
        return cached.value;
    }

    const value = await fetchAvatar(url);
    cache.set(url, {
        value,
        expires: now() + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
    });
    evictIfNeeded();
    return value;
}

/** Test/maintenance helper: drop all cached avatars. */
export function clearAvatarCache(): void {
    cache.clear();
}
