import type { EncryptionFormat } from '../config/types.js';

/**
 * Key status indicating availability
 */
export type KeyStatus = 'online' | 'locked' | 'offline';

// Re-export EncryptionFormat for convenience
export type { EncryptionFormat };

/**
 * Summary of a key for listing
 */
export interface KeySummary {
    name: string;
    npub?: string;
    userCount: number;
    tokenCount: number;
}

/**
 * Full key information for the UI
 */
export interface KeyInfo {
    name: string;
    pubkey?: string;
    npub?: string;
    bunkerUri?: string;
    status: KeyStatus;
    isEncrypted: boolean;
    /** Encryption format: 'none', 'legacy' (AES-256-GCM), or 'nip49' (ncryptsec) */
    encryptionFormat: EncryptionFormat;
    userCount: number;
    tokenCount: number;
    requestCount: number;
    lastUsedAt: string | null;
}

/**
 * Summary of a key user (connected app/client)
 */
export interface KeyUserSummary {
    id: number;
    name: string;
    pubkey: string;
    description?: string;
    createdAt: Date | string;
    lastUsedAt?: Date | string | null;
    revokedAt?: Date | string | null;
    signingConditions?: unknown;
}

/**
 * Request body for creating a new key
 */
export interface CreateKeyRequest {
    keyName: string;
    /** The secret to import (nsec1... or ncryptsec1...) */
    nsec?: string;
    /** Encryption format to use: 'none', 'legacy', or 'nip49' */
    encryption?: EncryptionFormat;
    /** Passphrase for encryption (required if encryption is not 'none') */
    passphrase?: string;
    /** Passphrase confirmation (server validates match) */
    confirmPassphrase?: string;
}

/**
 * Response from key creation
 */
export interface CreateKeyResponse {
    ok: boolean;
    key?: KeyInfo;
    error?: string;
}

/**
 * Response from generating a one-time connection token
 */
export interface GenerateConnectionTokenResponse {
    ok: boolean;
    bunkerUri?: string;
    expiresAt?: string;
    error?: string;
}
