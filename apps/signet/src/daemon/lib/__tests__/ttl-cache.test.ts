import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TTLCache, getAllCacheStats } from '../ttl-cache.js';

describe('TTLCache', () => {
    let cache: TTLCache<string>;

    afterEach(() => {
        cache?.destroy();
    });

    describe('basic operations', () => {
        beforeEach(() => {
            cache = new TTLCache('test', { ttlMs: 1000 });
        });

        it('should set and get values', () => {
            cache.set('key1', 'value1');
            expect(cache.get('key1')).toBe('value1');
        });

        it('should return undefined for missing keys', () => {
            expect(cache.get('nonexistent')).toBeUndefined();
        });

        it('should check existence with has()', () => {
            cache.set('key1', 'value1');
            expect(cache.has('key1')).toBe(true);
            expect(cache.has('nonexistent')).toBe(false);
        });

        it('should delete keys', () => {
            cache.set('key1', 'value1');
            expect(cache.delete('key1')).toBe(true);
            expect(cache.get('key1')).toBeUndefined();
            expect(cache.delete('key1')).toBe(false);
        });

        it('should clear all entries', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.clear();
            expect(cache.size).toBe(0);
            expect(cache.get('key1')).toBeUndefined();
        });

        it('should report size', () => {
            expect(cache.size).toBe(0);
            cache.set('key1', 'value1');
            expect(cache.size).toBe(1);
            cache.set('key2', 'value2');
            expect(cache.size).toBe(2);
        });
    });

    describe('TTL expiration', () => {
        beforeEach(() => {
            vi.useFakeTimers();
            cache = new TTLCache('test-ttl', { ttlMs: 100 });
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should return value before TTL expires', () => {
            cache.set('key1', 'value1');
            vi.advanceTimersByTime(50);
            expect(cache.get('key1')).toBe('value1');
        });

        it('should return undefined after TTL expires', () => {
            cache.set('key1', 'value1');
            vi.advanceTimersByTime(150);
            expect(cache.get('key1')).toBeUndefined();
        });

        it('should not find expired keys with has()', () => {
            cache.set('key1', 'value1');
            vi.advanceTimersByTime(150);
            expect(cache.has('key1')).toBe(false);
        });

        it('should refresh TTL on set', () => {
            cache.set('key1', 'value1');
            vi.advanceTimersByTime(80);
            cache.set('key1', 'value2');
            vi.advanceTimersByTime(80);
            expect(cache.get('key1')).toBe('value2');
        });
    });

    describe('max size with LRU eviction', () => {
        beforeEach(() => {
            cache = new TTLCache('test-lru', { ttlMs: 10000, maxSize: 3 });
        });

        it('should evict oldest entry when max size exceeded', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key3', 'value3');
            cache.set('key4', 'value4');

            expect(cache.size).toBe(3);
            expect(cache.get('key1')).toBeUndefined(); // evicted
            expect(cache.get('key2')).toBe('value2');
            expect(cache.get('key3')).toBe('value3');
            expect(cache.get('key4')).toBe('value4');
        });

        it('should not evict when updating existing key', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key3', 'value3');
            cache.set('key1', 'updated'); // update, not insert

            expect(cache.size).toBe(3);
            expect(cache.get('key1')).toBe('updated');
            expect(cache.get('key2')).toBe('value2');
            expect(cache.get('key3')).toBe('value3');
        });

        it('should track eviction count in stats', () => {
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key3', 'value3');
            cache.set('key4', 'value4');
            cache.set('key5', 'value5');

            expect(cache.stats.evictions).toBe(2);
        });
    });

    describe('statistics', () => {
        beforeEach(() => {
            cache = new TTLCache('test-stats', { ttlMs: 10000 });
        });

        it('should track hits and misses', () => {
            cache.set('key1', 'value1');

            cache.get('key1'); // hit
            cache.get('key1'); // hit
            cache.get('nonexistent'); // miss
            cache.get('also-missing'); // miss

            const stats = cache.stats;
            expect(stats.hits).toBe(2);
            expect(stats.misses).toBe(2);
        });

        it('should count expired access as miss', () => {
            vi.useFakeTimers();
            cache = new TTLCache('test-expire-stats', { ttlMs: 100 });

            cache.set('key1', 'value1');
            cache.get('key1'); // hit
            vi.advanceTimersByTime(150);
            cache.get('key1'); // miss (expired)

            expect(cache.stats.hits).toBe(1);
            expect(cache.stats.misses).toBe(1);

            vi.useRealTimers();
        });

        it('should reset stats', () => {
            cache.set('key1', 'value1');
            cache.get('key1');
            cache.get('missing');

            cache.resetStats();

            expect(cache.stats.hits).toBe(0);
            expect(cache.stats.misses).toBe(0);
            expect(cache.stats.evictions).toBe(0);
        });
    });

    describe('cleanup', () => {
        beforeEach(() => {
            vi.useFakeTimers();
        });

        afterEach(() => {
            vi.useRealTimers();
        });

        it('should clean expired entries on manual cleanup', () => {
            cache = new TTLCache('test-cleanup', { ttlMs: 100 });
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');

            vi.advanceTimersByTime(150);
            cache.cleanup();

            expect(cache.size).toBe(0);
        });

        it('should run automatic background cleanup', () => {
            cache = new TTLCache('test-auto-cleanup', {
                ttlMs: 100,
                cleanupIntervalMs: 200,
            });
            cache.set('key1', 'value1');

            vi.advanceTimersByTime(250);

            expect(cache.size).toBe(0);
        });
    });

    describe('iteration', () => {
        beforeEach(() => {
            cache = new TTLCache('test-iter', { ttlMs: 10000 });
            cache.set('key1', 'value1');
            cache.set('key2', 'value2');
            cache.set('key3', 'value3');
        });

        it('should iterate over entries', () => {
            const entries = Array.from(cache.entries());
            expect(entries).toEqual([
                ['key1', 'value1'],
                ['key2', 'value2'],
                ['key3', 'value3'],
            ]);
        });

        it('should iterate over keys', () => {
            const keys = Array.from(cache.keys());
            expect(keys).toEqual(['key1', 'key2', 'key3']);
        });

        it('should iterate over values', () => {
            const values = Array.from(cache.values());
            expect(values).toEqual(['value1', 'value2', 'value3']);
        });

        it('should skip expired entries during iteration', () => {
            vi.useFakeTimers();
            cache = new TTLCache('test-iter-expire', { ttlMs: 100 });
            cache.set('key1', 'value1');

            vi.advanceTimersByTime(50);
            cache.set('key2', 'value2');

            vi.advanceTimersByTime(75);
            // key1 expired, key2 still valid

            const entries = Array.from(cache.entries());
            expect(entries).toEqual([['key2', 'value2']]);

            vi.useRealTimers();
        });
    });

    describe('deleteMatching', () => {
        beforeEach(() => {
            cache = new TTLCache('test-match', { ttlMs: 10000 });
        });

        it('should delete entries matching predicate', () => {
            cache.set('user:1', 'alice');
            cache.set('user:2', 'bob');
            cache.set('session:1', 'abc');
            cache.set('session:2', 'def');

            const deleted = cache.deleteMatching((key) => key.startsWith('user:'));

            expect(deleted).toBe(2);
            expect(cache.size).toBe(2);
            expect(cache.has('user:1')).toBe(false);
            expect(cache.has('session:1')).toBe(true);
        });

        it('should delete entries matching by value', () => {
            cache.set('key1', 'keep');
            cache.set('key2', 'delete');
            cache.set('key3', 'delete');

            const deleted = cache.deleteMatching((_, value) => value === 'delete');

            expect(deleted).toBe(2);
            expect(cache.get('key1')).toBe('keep');
        });
    });

    describe('global registry', () => {
        it('should register caches for global stats', () => {
            const cache1 = new TTLCache<number>('registry-test-1', { ttlMs: 1000 });
            const cache2 = new TTLCache<number>('registry-test-2', { ttlMs: 1000 });

            cache1.set('a', 1);
            cache2.set('b', 2);
            cache2.set('c', 3);

            const stats = getAllCacheStats();

            expect(stats['registry-test-1'].size).toBe(1);
            expect(stats['registry-test-2'].size).toBe(2);

            cache1.destroy();
            cache2.destroy();

            const statsAfter = getAllCacheStats();
            expect(statsAfter['registry-test-1']).toBeUndefined();
            expect(statsAfter['registry-test-2']).toBeUndefined();
        });
    });

    describe('destroy', () => {
        it('should stop cleanup timer and clear cache', () => {
            vi.useFakeTimers();
            cache = new TTLCache('test-destroy', {
                ttlMs: 100,
                cleanupIntervalMs: 50,
            });
            cache.set('key1', 'value1');

            cache.destroy();

            expect(cache.size).toBe(0);

            // Verify timer is stopped (no errors advancing time)
            vi.advanceTimersByTime(200);

            vi.useRealTimers();
        });
    });
});
