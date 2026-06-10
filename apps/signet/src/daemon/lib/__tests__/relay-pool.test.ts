import { describe, it, expect } from 'vitest';
import { isThrottleError } from '../relay-pool.js';

describe('isThrottleError', () => {
  it('flags rate-limit and timeout rejection reasons', () => {
    const throttling = [
      'rate-limited: too many events, slow down',
      'rate limited',
      'too many requests',
      'publish timed out',
      'Request timeout',
    ];
    for (const reason of throttling) {
      expect(isThrottleError(reason), reason).toBe(true);
    }
  });

  it('does not flag unrelated rejection reasons', () => {
    const other = [
      'blocked. NSFW reason: nudity',
      'invalid: bad signature',
      'connection refused',
      'pow: difficulty 20 required',
    ];
    for (const reason of other) {
      expect(isThrottleError(reason), reason).toBe(false);
    }
  });
});
