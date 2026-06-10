import { describe, it, expect, vi } from 'vitest';
import { AppRateLimiter } from '../app-rate-limiter.js';

describe('AppRateLimiter', () => {
  it('admits a burst instantly then sheds when over budget with no delay tolerance', async () => {
    const rl = new AppRateLimiter({ name: 'test-rl-burst', refillPerSec: 1, burst: 3, maxDelayMs: 0 });
    expect(await rl.tryAcquire('app')).toBe(true);
    expect(await rl.tryAcquire('app')).toBe(true);
    expect(await rl.tryAcquire('app')).toBe(true);
    // 4th request is over the burst; the wait exceeds maxDelayMs=0, so it is shed.
    expect(await rl.tryAcquire('app')).toBe(false);
    rl.destroy();
  });

  it('tracks each key independently', async () => {
    const rl = new AppRateLimiter({ name: 'test-rl-keys', refillPerSec: 1, burst: 1, maxDelayMs: 0 });
    expect(await rl.tryAcquire('a')).toBe(true);
    expect(await rl.tryAcquire('a')).toBe(false); // a is now empty
    expect(await rl.tryAcquire('b')).toBe(true); // b has its own bucket
    rl.destroy();
  });

  it('delays (rather than sheds) an over-budget request within maxDelay', async () => {
    // refill 1000/s => one token is ~1ms away, well under maxDelayMs.
    const rl = new AppRateLimiter({ name: 'test-rl-delay', refillPerSec: 1000, burst: 1, maxDelayMs: 100 });
    expect(await rl.tryAcquire('app')).toBe(true);
    const start = Date.now();
    expect(await rl.tryAcquire('app')).toBe(true); // queued briefly, then admitted
    expect(Date.now() - start).toBeLessThan(100);
    rl.destroy();
  });

  it('refills tokens over time', async () => {
    // Fake timers freeze the clock so no tokens refill between the first two acquires
    // (with refillPerSec=1000 that's 1 token/ms — real scheduling jitter under load
    // would otherwise refill a token and flake the "empty" assertion), then advance it
    // deterministically to prove refill.
    vi.useFakeTimers();
    try {
      const rl = new AppRateLimiter({ name: 'test-rl-refill', refillPerSec: 1000, burst: 1, maxDelayMs: 0 });
      expect(await rl.tryAcquire('app')).toBe(true);
      expect(await rl.tryAcquire('app')).toBe(false); // empty, no delay tolerance
      await vi.advanceTimersByTimeAsync(25); // ~25 tokens refill (capped at burst)
      expect(await rl.tryAcquire('app')).toBe(true);
      rl.destroy();
    } finally {
      vi.useRealTimers();
    }
  });
});
