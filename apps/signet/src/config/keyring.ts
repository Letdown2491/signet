import crypto from 'crypto';

// Re-export NIP-49 functions for convenience
export { encryptNip49, decryptNip49, isNcryptsec } from '../daemon/lib/nip49.js';

// Current encryption settings (v2)
const ALGORITHM_GCM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12; // GCM uses 12-byte IV/nonce
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const PBKDF2_ITERATIONS = 600_000; // NIST recommended minimum as of 2023

// Legacy encryption settings (v1) for backwards compatibility
const ALGORITHM_CBC = 'aes-256-cbc';
const IV_LENGTH_CBC = 16;
const PBKDF2_ITERATIONS_LEGACY = 100_000;

// Version bytes
const VERSION_1_CBC = 0x01;
const VERSION_2_GCM = 0x02;

function deriveKey(passphrase: string, salt: Buffer, iterations: number): Buffer {
    return crypto.pbkdf2Sync(passphrase, salt, iterations, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt a secret using AES-256-GCM with authenticated encryption
 * Format: version(1) + salt(16) + iv(12) + authTag(16) + ciphertext
 */
export function encryptSecret(secret: string, passphrase: string): { iv: string; data: string } {
    const salt = crypto.randomBytes(SALT_LENGTH);
    const key = deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM_GCM, key, iv);
    const encrypted = Buffer.concat([
        cipher.update(secret, 'utf8'),
        cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    // Combine all components with version prefix
    const combined = Buffer.concat([
        Buffer.from([VERSION_2_GCM]),
        salt,
        iv,
        authTag,
        encrypted,
    ]);

    return {
        iv: iv.toString('hex'),
        data: combined.toString('hex'),
    };
}

/**
 * Decrypt a secret - supports both v2 (GCM) and v1 (CBC) formats
 */
export function decryptSecret(encrypted: { iv: string; data: string }, passphrase: string): string {
    const combined = Buffer.from(encrypted.data, 'hex');

    if (combined.length < 1) {
        throw new Error('Invalid encrypted data: too short');
    }

    const version = combined[0];

    if (version === VERSION_2_GCM) {
        return decryptSecretV2(combined, passphrase);
    } else if (version === VERSION_1_CBC || isLegacyFormat(combined, encrypted.iv)) {
        // v1 or legacy format (no version byte)
        return decryptSecretV1(encrypted, passphrase);
    } else {
        // Assume legacy format for older data without version byte
        return decryptSecretV1(encrypted, passphrase);
    }
}

/**
 * Decrypt v2 format (AES-256-GCM)
 * Format: version(1) + salt(16) + iv(12) + authTag(16) + ciphertext
 */
function decryptSecretV2(combined: Buffer, passphrase: string): string {
    const minLength = 1 + SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1;
    if (combined.length < minLength) {
        throw new Error('Invalid encrypted data: too short for v2 format');
    }

    let offset = 1; // Skip version byte

    const salt = combined.subarray(offset, offset + SALT_LENGTH);
    offset += SALT_LENGTH;

    const iv = combined.subarray(offset, offset + IV_LENGTH);
    offset += IV_LENGTH;

    const authTag = combined.subarray(offset, offset + AUTH_TAG_LENGTH);
    offset += AUTH_TAG_LENGTH;

    const ciphertext = combined.subarray(offset);

    const key = deriveKey(passphrase, salt, PBKDF2_ITERATIONS);

    const decipher = crypto.createDecipheriv(ALGORITHM_GCM, key, iv);
    decipher.setAuthTag(authTag);

    try {
        const decrypted = Buffer.concat([
            decipher.update(ciphertext),
            decipher.final(),
        ]);
        return decrypted.toString('utf8');
    } catch (error) {
        throw new Error('Decryption failed: invalid passphrase or corrupted data');
    }
}

/**
 * Check if data appears to be legacy format (no version byte)
 */
function isLegacyFormat(combined: Buffer, ivHex: string): boolean {
    // Legacy format starts with salt (random bytes), not a version byte
    // The version bytes we use (0x01, 0x02) are unlikely to appear as the first byte
    // of random salt data, but we also check if the IV is the expected CBC length
    const iv = Buffer.from(ivHex, 'hex');
    return iv.length === IV_LENGTH_CBC && combined[0] !== VERSION_2_GCM;
}

/**
 * Decrypt v1/legacy format (AES-256-CBC)
 * Legacy format: salt(16) + ciphertext (no version prefix)
 */
function decryptSecretV1(encrypted: { iv: string; data: string }, passphrase: string): string {
    const iv = Buffer.from(encrypted.iv, 'hex');
    let combined = Buffer.from(encrypted.data, 'hex');

    // Skip version byte if present (v1 explicit format)
    if (combined[0] === VERSION_1_CBC) {
        combined = combined.subarray(1);
    }

    if (combined.length < SALT_LENGTH + 1) {
        throw new Error('Invalid encrypted data: too short for v1 format');
    }

    // Extract salt and encrypted data
    const salt = combined.subarray(0, SALT_LENGTH);
    const encryptedData = combined.subarray(SALT_LENGTH);

    const key = deriveKey(passphrase, salt, PBKDF2_ITERATIONS_LEGACY);

    try {
        const decipher = crypto.createDecipheriv(ALGORITHM_CBC, key, iv);
        let decrypted = decipher.update(encryptedData.toString('hex'), 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        throw new Error('Decryption failed: invalid passphrase or corrupted data');
    }
}

/**
 * Re-encrypt a secret with the latest encryption format
 * Use this to upgrade legacy encrypted keys to the new format
 */
export function upgradeEncryption(
    oldEncrypted: { iv: string; data: string },
    passphrase: string
): { iv: string; data: string } {
    const plaintext = decryptSecret(oldEncrypted, passphrase);
    return encryptSecret(plaintext, passphrase);
}

/**
 * Check if encrypted data uses the legacy v1 format
 */
export function isLegacyEncryption(encrypted: { iv: string; data: string }): boolean {
    const combined = Buffer.from(encrypted.data, 'hex');
    return combined.length < 1 || combined[0] !== VERSION_2_GCM;
}
