import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  addServerToken,
  changePin,
  createVault,
  getUnlocked,
  hasVault,
  isUnlocked,
  lock,
  unlock,
} from './vault';

beforeEach(() => fakeBrowser.reset());

describe('vault', () => {
  it('creates and unlocks a vault round-trip', async () => {
    await createVault('123456', { tokens: { s1: 'tok' } });
    expect(await hasVault()).toBe(true);
    expect(await isUnlocked()).toBe(true);
    expect(await getUnlocked()).toEqual({ tokens: { s1: 'tok' } });

    await lock();
    expect(await isUnlocked()).toBe(false);

    const res = await unlock('123456');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.secrets).toEqual({ tokens: { s1: 'tok' } });
  });

  it('rejects a wrong PIN and counts down attempts', async () => {
    await createVault('123456', {});
    await lock();
    const res = await unlock('000000');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.wiped).toBe(false);
      expect(res.remaining).toBe(9);
    }
  });

  it('wipes everything after the max wrong attempts', async () => {
    await createVault('123456', { tokens: { s1: 'x' } });
    await lock();
    let last: Awaited<ReturnType<typeof unlock>> | undefined;
    for (let i = 0; i < 10; i++) last = await unlock('000000');
    expect(last && !last.ok && last.wiped).toBe(true);
    expect(await hasVault()).toBe(false);
  }, 60000);

  it('changePin re-encrypts so only the new PIN unlocks', async () => {
    await createVault('123456', { tokens: { s1: 'x' } });
    expect((await changePin('123456', '654321')).ok).toBe(true);
    await lock();
    expect((await unlock('123456')).ok).toBe(false);
    expect((await unlock('654321')).ok).toBe(true);
  });

  it('changePin rejects a wrong current PIN', async () => {
    await createVault('123456', {});
    expect((await changePin('999999', '654321')).ok).toBe(false);
  });

  it('addServerToken stores a token under a server id', async () => {
    await createVault('123456', { tokens: {} });
    expect((await addServerToken('123456', 'srv2', 'jwt')).ok).toBe(true);
    expect((await getUnlocked())?.tokens?.srv2).toBe('jwt');
  });

  it('migrates a legacy v1 (PBKDF2) vault to v2 (Argon2id) on unlock', async () => {
    const v1 = await makeV1Vault('123456', { tokens: {} });
    await fakeBrowser.storage.local.set({ vault: v1, vaultFailures: 0 });

    const res = await unlock('123456');
    expect(res.ok).toBe(true);

    const stored = (await fakeBrowser.storage.local.get('vault')).vault as { v: number; argon?: unknown };
    expect(stored.v).toBe(2);
    expect(stored.argon).toBeDefined();
  });
});

/** Recreates the pre-Argon2 PBKDF2-600k vault format for the migration test. */
async function makeV1Vault(pin: string, secrets: unknown) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, [
    'deriveKey',
  ]);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 600_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(secrets)),
  );
  const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');
  return { v: 1, iterations: 600_000, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ct)) };
}
