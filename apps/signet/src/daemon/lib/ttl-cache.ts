/**
 * TTLCache - A generic cache with time-based expiration and optional size limits.
 *
 * Features:
 * - Automatic TTL-based expiration
 * - Optional max size with LRU eviction
 * - Background cleanup of expired entries
 * - Stats for monitoring (hits, misses, evictions)
 * - Graceful shutdown via destroy()
 *
 * Usage:
 *   const cache = new TTLCache<UserData>('users', { ttlMs: 30_000, maxSize: 1000 });
 *   cache.set('user123', userData);
 *   const data = cache.get('user123'); // undefined if expired
 *   cache.destroy(); // cleanup on shutdown
 */

import createDebug from 'debug';

const debug = createDebug('signet:ttl-cache');

export interface TTLCacheOptions {
    /** Time-to-live for entries in milliseconds */
    ttlMs: number;
    /** Maximum number of entries (LRU eviction when exceeded) */
    maxSize?: number;
    /** Background cleanup interval in milliseconds (default: ttlMs * 2, min: 10s) */
    cleanupIntervalMs?: number;
}

interface CacheEntry<V> {
    value: V;
    expiresAt: number;
}

export interface TTLCacheStats {
    size: number;
    hits: number;
    misses: number;
    evictions: number;
}

/** Registry of all active caches for global stats reporting */
const cacheRegistry = new Map<string, TTLCache<unknown>>();

/**
 * Get stats for all registered caches.
 * Useful for health endpoint reporting.
 */
export function getAllCacheStats(): Record<string, TTLCacheStats> {
    const stats: Record<string, TTLCacheStats> = {};
    for (const [name, cache] of cacheRegistry) {
        stats[name] = cache.stats;
    }
    return stats;
}

export class TTLCache<V> {
    private readonly name: string;
    private readonly ttlMs: number;
    private readonly maxSize: number | undefined;
    private readonly cache = new Map<string, CacheEntry<V>>();
    private cleanupTimer: ReturnType<typeof setInterval> | null = null;

    // Stats
    private _hits = 0;
    private _misses = 0;
    private _evictions = 0;

    constructor(name: string, options: TTLCacheOptions) {
        this.name = name;
        this.ttlMs = options.ttlMs;
        this.maxSize = options.maxSize;

        // Calculate cleanup interval (default: 2x TTL, minimum 10 seconds)
        const cleanupInterval = options.cleanupIntervalMs ??
            Math.max(10_000, this.ttlMs * 2);

        // Start background cleanup
        this.cleanupTimer = setInterval(() => {
            this.cleanup();
        }, cleanupInterval);

        // Don't keep process alive just for cache cleanup
        this.cleanupTimer.unref();

        // Register for global stats
        cacheRegistry.set(name, this as TTLCache<unknown>);

        debug('created cache %s (ttl=%dms, maxSize=%s, cleanup=%dms)',
            name, this.ttlMs, this.maxSize ?? 'unlimited', cleanupInterval);
    }

    /**
     * Set a value in the cache.
     * If maxSize is reached, the oldest entry is evicted.
     */
    set(key: string, value: V): void {
        // Enforce max size with LRU eviction (delete oldest first)
        if (this.maxSize !== undefined && this.cache.size >= this.maxSize) {
            // If key already exists, we'll replace it (no eviction needed)
            if (!this.cache.has(key)) {
                const oldestKey = this.cache.keys().next().value;
                if (oldestKey !== undefined) {
                    this.cache.delete(oldestKey);
                    this._evictions++;
                    debug('evicted oldest entry from %s (size limit)', this.name);
                }
            }
        }

        // Delete and re-add to maintain insertion order (LRU)
        this.cache.delete(key);
        this.cache.set(key, {
            value,
            expiresAt: Date.now() + this.ttlMs,
        });
    }

    /**
     * Get a value from the cache.
     * Returns undefined if not found or expired.
     */
    get(key: string): V | undefined {
        const entry = this.cache.get(key);

        if (!entry) {
            this._misses++;
            return undefined;
        }

        // Check expiration
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            this._misses++;
            return undefined;
        }

        this._hits++;
        return entry.value;
    }

    /**
     * Check if a key exists and is not expired.
     */
    has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) {
            return false;
        }
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }

    /**
     * Delete a specific key.
     */
    delete(key: string): boolean {
        return this.cache.delete(key);
    }

    /**
     * Clear all entries.
     */
    clear(): void {
        this.cache.clear();
    }

    /**
     * Get the number of entries (including possibly expired ones).
     */
    get size(): number {
        return this.cache.size;
    }

    /**
     * Get cache statistics.
     */
    get stats(): TTLCacheStats {
        return {
            size: this.cache.size,
            hits: this._hits,
            misses: this._misses,
            evictions: this._evictions,
        };
    }

    /**
     * Reset statistics counters.
     */
    resetStats(): void {
        this._hits = 0;
        this._misses = 0;
        this._evictions = 0;
    }

    /**
     * Run cleanup of expired entries.
     * Called automatically by background timer, but can be called manually.
     */
    cleanup(): void {
        const now = Date.now();

        // Collect expired keys first to avoid modifying Map while iterating
        const expiredKeys: string[] = [];
        for (const [key, entry] of this.cache) {
            if (now > entry.expiresAt) {
                expiredKeys.push(key);
            }
        }

        // Delete collected keys
        for (const key of expiredKeys) {
            this.cache.delete(key);
        }

        if (expiredKeys.length > 0) {
            debug('cleaned %d expired entries from %s', expiredKeys.length, this.name);
        }
    }

    /**
     * Stop background cleanup and unregister from global stats.
     * Call this when shutting down to prevent memory leaks.
     */
    destroy(): void {
        if (this.cleanupTimer) {
            clearInterval(this.cleanupTimer);
            this.cleanupTimer = null;
        }
        cacheRegistry.delete(this.name);
        this.cache.clear();
        debug('destroyed cache %s', this.name);
    }

    /**
     * Iterate over all non-expired entries.
     * Useful for operations that need to scan the cache.
     */
    *entries(): IterableIterator<[string, V]> {
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now <= entry.expiresAt) {
                yield [key, entry.value];
            }
        }
    }

    /**
     * Iterate over all non-expired keys.
     */
    *keys(): IterableIterator<string> {
        const now = Date.now();
        for (const [key, entry] of this.cache) {
            if (now <= entry.expiresAt) {
                yield key;
            }
        }
    }

    /**
     * Iterate over all non-expired values.
     */
    *values(): IterableIterator<V> {
        const now = Date.now();
        for (const [, entry] of this.cache) {
            if (now <= entry.expiresAt) {
                yield entry.value;
            }
        }
    }

    /**
     * Delete all entries matching a predicate.
     * Useful for invalidating related entries (e.g., by prefix).
     */
    deleteMatching(predicate: (key: string, value: V) => boolean): number {
        // Collect matching keys first to avoid modifying Map while iterating
        const keysToDelete: string[] = [];
        for (const [key, entry] of this.cache) {
            if (predicate(key, entry.value)) {
                keysToDelete.push(key);
            }
        }

        // Delete collected keys
        for (const key of keysToDelete) {
            this.cache.delete(key);
        }

        return keysToDelete.length;
    }
}
