/**
 * Per-key token-bucket rate limiter, keyed by a string (a connected app's
 * pubkey). Smooths or sheds bursts from a single client so one app can't
 * saturate the shared relays for every other app on the same signing key.
 *
 * Behaviour:
 *   - Up to `burst` requests are admitted instantly.
 *   - Beyond that, requests are admitted at `refillPerSec`; an over-budget
 *     request is *delayed* until a token is available...
 *   - ...unless that wait would exceed `maxDelayMs`, in which case the request
 *     is *shed* (tryAcquire returns false) so the caller drops it and the client
 *     is forced to back off, rather than queueing unbounded work.
 */
import { TTLCache } from './ttl-cache.js';

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface Bucket {
    /** Available tokens; may go briefly negative to reserve a queued slot. */
    tokens: number;
    /** Timestamp (ms) tokens were last refilled. */
    lastRefillMs: number;
}

export interface AppRateLimiterOptions {
    /** Sustained requests per second admitted per key. */
    refillPerSec: number;
    /** Instantaneous burst allowance per key. */
    burst: number;
    /** Max time to delay an over-budget request before shedding it. */
    maxDelayMs: number;
    /** Unique cache name (for the shared cache registry). */
    name?: string;
    /** How long an idle key's bucket is retained. */
    idleTtlMs?: number;
    /** Max number of distinct keys tracked. */
    maxKeys?: number;
}

export class AppRateLimiter {
    private readonly buckets: TTLCache<Bucket>;
    private readonly refillPerSec: number;
    private readonly burst: number;
    private readonly maxDelayMs: number;

    constructor(options: AppRateLimiterOptions) {
        this.refillPerSec = options.refillPerSec;
        this.burst = options.burst;
        this.maxDelayMs = options.maxDelayMs;
        this.buckets = new TTLCache<Bucket>(options.name ?? 'app-rate-limiter', {
            ttlMs: options.idleTtlMs ?? 5 * 60_000,
            maxSize: options.maxKeys ?? 5000,
        });
    }

    private refill(bucket: Bucket, now: number): void {
        const elapsedSec = Math.max(0, (now - bucket.lastRefillMs) / 1000);
        bucket.tokens = Math.min(this.burst, bucket.tokens + elapsedSec * this.refillPerSec);
        bucket.lastRefillMs = now;
    }

    /**
     * Returns true if the caller may proceed (possibly after an internal delay),
     * or false if the request is so far over budget that it should be shed.
     */
    async tryAcquire(key: string): Promise<boolean> {
        const now = Date.now();
        const bucket: Bucket = this.buckets.get(key) ?? { tokens: this.burst, lastRefillMs: now };
        this.refill(bucket, now);

        if (bucket.tokens >= 1) {
            bucket.tokens -= 1;
            this.buckets.set(key, bucket);
            return true;
        }

        // Out of tokens: how long until one is available?
        const deficit = 1 - bucket.tokens;
        const waitMs = (deficit / this.refillPerSec) * 1000;
        if (waitMs > this.maxDelayMs) {
            // Too far over budget — shed. Persist the refilled state so the next
            // request sees an accurate (still-empty) bucket.
            this.buckets.set(key, bucket);
            return false;
        }

        // Reserve a token (tokens may go negative; later requests wait longer,
        // which staggers a burst) and queue this request for `waitMs`.
        bucket.tokens -= 1;
        this.buckets.set(key, bucket);
        await sleep(waitMs);
        return true;
    }

    /** Drop all per-key state (e.g. when a key is locked). */
    clear(): void {
        this.buckets.clear();
    }

    /** Stop background cleanup and unregister from the cache registry. */
    destroy(): void {
        this.buckets.destroy();
    }
}
