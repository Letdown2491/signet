import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing';

// WxtVitest wires up the `#imports` alias and points `browser` at the in-memory
// fakeBrowser, so we can unit-test the vault/storage logic in a node env.
export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Argon2id derivations are intentionally slow (~0.5-1s each).
    testTimeout: 30000,
  },
});
