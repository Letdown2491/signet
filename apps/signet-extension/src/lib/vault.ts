import { browser } from '#imports';
import { argon2id } from 'hash-wasm';

/**
 * PIN-protected secret store.
 *
 * The vault holds whatever must not sit in plaintext — currently an optional
 * `requireAuth` JWT. It is encrypted at rest with AES-GCM under a key derived
 * from the PIN with Argon2id (memory-hard), and the GCM auth tag doubles as the
 * PIN verifier: a wrong PIN simply fails to decrypt.
 *
 * Honest scope: in the default `requireAuth: false` deployment there's no token,
 * so the vault encrypts an empty object — the PIN is then purely an access gate
 * (it stops a walk-up attacker from approving), not cryptographic protection of a
 * secret. When a token IS present, the PIN genuinely protects it at rest.
 *
 * Residual risk (PIN-only, by user's choice): a copied vault can be brute-forced
 * offline. Argon2id's memory cost makes that far harder than a plain hash, but a
 * short PIN is still the ceiling on strength.
 *
 * Migration: v1 vaults (PBKDF2-600k) still unlock and are transparently
 * re-encrypted as v2 (Argon2id) on the next successful unlock.
 */
export interface VaultSecrets {
  /** Per-server `requireAuth` tokens, keyed by server id. */
  tokens?: Record<string, string>;
  /** Legacy pre-switcher single token; read-only fallback for migrated vaults. */
  token?: string;
}

const VAULT_KEY = 'vault';
const FAILURES_KEY = 'vaultFailures';
const UNLOCK_KEY = 'unlocked';

/** Legacy v1 key-stretch cost (still accepted on unlock for migration). */
const PBKDF2_ITERATIONS = 600_000;
/** Argon2id parameters for v2 vaults. 64 MiB memory cost is the real hardness. */
const ARGON2_PARAMS: ArgonParams = { memKiB: 65_536, time: 3, parallelism: 1 };
const MAX_ATTEMPTS = 10;
/** Default auto-lock window (minutes) until the user picks one in Settings; 0 = never. */
const AUTO_LOCK_KEY = 'autoLockMinutes';
const DEFAULT_AUTO_LOCK_MIN = 15;
export const MIN_PIN_LENGTH = 6;

interface ArgonParams {
  memKiB: number;
  time: number;
  parallelism: number;
}

interface StoredVault {
  v: 1 | 2;
  iterations?: number; // v1 (PBKDF2)
  argon?: ArgonParams; // v2 (Argon2id)
  salt: string; // base64
  iv: string; // base64
  ct: string; // base64
}

interface UnlockedState {
  secrets: VaultSecrets;
  /** Idle clock: bumped on user activity (popup use), never by background polling. */
  lastActivityAt: number;
}

export type UnlockResult =
  | { ok: true; secrets: VaultSecrets }
  | { ok: false; remaining: number; wiped: boolean };

export async function hasVault(): Promise<boolean> {
  const res = await browser.storage.local.get(VAULT_KEY);
  return res[VAULT_KEY] != null;
}

/** Create the vault from a fresh PIN and immediately unlock it. */
export async function createVault(pin: string, secrets: VaultSecrets): Promise<void> {
  // Enforce the PIN floor at the crypto boundary, not just in the UI.
  if (pin.length < MIN_PIN_LENGTH) {
    throw new Error(`PIN must be at least ${MIN_PIN_LENGTH} characters.`);
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveArgon2(pin, salt, ARGON2_PARAMS);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(secrets)) as BufferSource,
  );
  const vault: StoredVault = {
    v: 2,
    argon: ARGON2_PARAMS,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
  };
  await browser.storage.local.set({ [VAULT_KEY]: vault, [FAILURES_KEY]: 0 });
  await setUnlocked(secrets);
}

/** Decrypt the vault's secrets with a PIN — throws on a wrong PIN (AES-GCM tag mismatch). */
async function decryptVault(pin: string, vault: StoredVault): Promise<VaultSecrets> {
  const key = await deriveVaultKey(pin, vault);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(vault.iv) },
    key,
    fromB64(vault.ct),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as VaultSecrets;
}

export async function unlock(pin: string): Promise<UnlockResult> {
  const res = await browser.storage.local.get(VAULT_KEY);
  const vault = res[VAULT_KEY] as StoredVault | undefined;
  if (!vault) return { ok: false, remaining: 0, wiped: false };

  let secrets: VaultSecrets;
  try {
    secrets = await decryptVault(pin, vault);
  } catch {
    // AES-GCM tag mismatch ⇒ wrong PIN. The attempt counter + wipe below only
    // deters a walk-up attacker poking the popup; it cannot stop an offline
    // brute-force by someone who can read the stored vault (Argon2id's memory
    // cost is the real ceiling there).
    const failuresRes = await browser.storage.local.get(FAILURES_KEY);
    const failures = ((failuresRes[FAILURES_KEY] as number | undefined) ?? 0) + 1;
    if (failures >= MAX_ATTEMPTS) {
      await wipe();
      return { ok: false, remaining: 0, wiped: true };
    }
    await browser.storage.local.set({ [FAILURES_KEY]: failures });
    return { ok: false, remaining: MAX_ATTEMPTS - failures, wiped: false };
  }

  await browser.storage.local.set({ [FAILURES_KEY]: 0 });
  if (vault.v !== 2) {
    // Transparent upgrade: re-encrypt a legacy PBKDF2 vault as Argon2id (this also
    // re-unlocks the session).
    await createVault(pin, secrets);
  } else {
    await setUnlocked(secrets);
  }
  return { ok: true, secrets };
}

/** Re-encrypt the vault under a new PIN, verifying the current one first. */
export async function changePin(
  currentPin: string,
  newPin: string,
): Promise<{ ok: boolean; error?: string }> {
  if (newPin.length < MIN_PIN_LENGTH) {
    return { ok: false, error: `PIN must be at least ${MIN_PIN_LENGTH} digits.` };
  }
  const res = await browser.storage.local.get(VAULT_KEY);
  const vault = res[VAULT_KEY] as StoredVault | undefined;
  if (!vault) return { ok: false, error: 'Nothing to change.' };

  let secrets: VaultSecrets;
  try {
    secrets = await decryptVault(currentPin, vault);
  } catch {
    return { ok: false, error: 'Current PIN is incorrect.' };
  }

  await createVault(newPin, secrets); // re-salts, re-encrypts as v2, and re-unlocks
  return { ok: true };
}

/**
 * Store a server's `requireAuth` token in the vault, verifying the PIN first
 * (re-encrypting the vault requires the PIN). Only needed for hardened servers;
 * token-less servers never call this.
 */
export async function addServerToken(
  pin: string,
  serverId: string,
  token: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await browser.storage.local.get(VAULT_KEY);
  const vault = res[VAULT_KEY] as StoredVault | undefined;
  if (!vault) return { ok: false, error: 'Set up a PIN first.' };

  let secrets: VaultSecrets;
  try {
    secrets = await decryptVault(pin, vault);
  } catch {
    return { ok: false, error: 'Incorrect PIN.' };
  }

  const tokens = { ...(secrets.tokens ?? {}), [serverId]: token };
  await createVault(pin, { ...secrets, tokens });
  return { ok: true };
}

/** Returns the decrypted secrets if currently unlocked (and not auto-locked). */
export async function getUnlocked(): Promise<VaultSecrets | null> {
  const res = await browser.storage.session.get(UNLOCK_KEY);
  const state = res[UNLOCK_KEY] as UnlockedState | undefined;
  if (!state) return null;
  const minutes = await getAutoLockMinutes();
  if (minutes > 0 && Date.now() - state.lastActivityAt > minutes * 60_000) {
    await lock();
    return null;
  }
  return state.secrets;
}

/**
 * Mark user activity so the idle auto-lock clock resets. Called only from the
 * popup (opening it / acting on it) — NOT from the background, so background
 * badge polling never keeps the session alive on its own.
 */
export async function touchActivity(): Promise<void> {
  const res = await browser.storage.session.get(UNLOCK_KEY);
  const state = res[UNLOCK_KEY] as UnlockedState | undefined;
  if (state) {
    await browser.storage.session.set({
      [UNLOCK_KEY]: { ...state, lastActivityAt: Date.now() },
    });
  }
}

export async function getAutoLockMinutes(): Promise<number> {
  const r = await browser.storage.local.get(AUTO_LOCK_KEY);
  const v = r[AUTO_LOCK_KEY];
  return typeof v === 'number' ? v : DEFAULT_AUTO_LOCK_MIN;
}

export async function setAutoLockMinutes(minutes: number): Promise<void> {
  await browser.storage.local.set({ [AUTO_LOCK_KEY]: minutes });
}

export async function isUnlocked(): Promise<boolean> {
  return (await getUnlocked()) != null;
}

export async function lock(): Promise<void> {
  await browser.storage.session.remove(UNLOCK_KEY);
}

/** Nuke everything — used on too-many-failures and on "forgot PIN" re-onboarding. */
export async function wipe(): Promise<void> {
  await browser.storage.local.clear();
  await browser.storage.session.clear();
}

async function setUnlocked(secrets: VaultSecrets): Promise<void> {
  const state: UnlockedState = { secrets, lastActivityAt: Date.now() };
  await browser.storage.session.set({ [UNLOCK_KEY]: state });
}

/** Derive the AES-GCM key for a vault, picking the KDF by its stored version. */
function deriveVaultKey(pin: string, vault: StoredVault): Promise<CryptoKey> {
  const salt = fromB64(vault.salt);
  return vault.v === 2 && vault.argon
    ? deriveArgon2(pin, salt, vault.argon)
    : derivePbkdf2(pin, salt, vault.iterations ?? PBKDF2_ITERATIONS);
}

async function deriveArgon2(
  pin: string,
  salt: Uint8Array,
  params: ArgonParams,
): Promise<CryptoKey> {
  const raw = await argon2id({
    password: pin,
    salt,
    parallelism: params.parallelism,
    iterations: params.time,
    memorySize: params.memKiB,
    hashLength: 32,
    outputType: 'binary',
  });
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

async function derivePbkdf2(
  pin: string,
  salt: BufferSource,
  iterations: number,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin) as BufferSource,
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
