/**
 * Input validation utilities for user-provided data.
 *
 * These utilities ensure inputs are within safe bounds before
 * processing, preventing abuse and ensuring data consistency.
 */

import {
    MAX_KEY_NAME_LENGTH,
    MAX_APP_NAME_LENGTH,
    MIN_PASSPHRASE_LENGTH,
    MAX_PASSPHRASE_LENGTH,
    MAX_URI_LENGTH,
    MAX_RELAYS_PER_CONNECTION,
} from '../constants.js';

export interface ValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * Validate a key name.
 * - Must not be empty after trimming
 * - Must not exceed max length
 * - Must contain only safe characters (alphanumeric, dash, underscore)
 */
export function validateKeyName(name: string | undefined | null): ValidationResult {
    if (!name || !name.trim()) {
        return { valid: false, error: 'Key name is required' };
    }

    const trimmed = name.trim();

    if (trimmed.length > MAX_KEY_NAME_LENGTH) {
        return { valid: false, error: `Key name must be at most ${MAX_KEY_NAME_LENGTH} characters` };
    }

    // Only allow safe characters for key names
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
        return { valid: false, error: 'Key name can only contain letters, numbers, dashes, and underscores' };
    }

    return { valid: true };
}

/**
 * Validate an app name/description.
 * - Optional (can be empty)
 * - Must not exceed max length
 */
export function validateAppName(name: string | undefined | null): ValidationResult {
    if (!name) {
        return { valid: true }; // App names are optional
    }

    const trimmed = name.trim();

    if (trimmed.length > MAX_APP_NAME_LENGTH) {
        return { valid: false, error: `App name must be at most ${MAX_APP_NAME_LENGTH} characters` };
    }

    return { valid: true };
}

/**
 * Validate a passphrase.
 * - Must meet minimum length for security (when provided)
 * - Must not exceed max length (to prevent DoS via expensive hashing)
 * - Empty is valid (means no encryption)
 */
export function validatePassphrase(passphrase: string | undefined | null): ValidationResult {
    if (!passphrase) {
        return { valid: true }; // No passphrase is valid (unencrypted key)
    }

    if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
        return { valid: false, error: `Passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters` };
    }

    if (passphrase.length > MAX_PASSPHRASE_LENGTH) {
        return { valid: false, error: `Passphrase must be at most ${MAX_PASSPHRASE_LENGTH} characters` };
    }

    return { valid: true };
}

/**
 * Validate a URI string (bunker:// or nostrconnect://).
 * - Must not exceed max length
 * - Must be a valid URI format (starts with scheme)
 */
export function validateUri(uri: string | undefined | null): ValidationResult {
    if (!uri || !uri.trim()) {
        return { valid: false, error: 'URI is required' };
    }

    const trimmed = uri.trim();

    if (trimmed.length > MAX_URI_LENGTH) {
        return { valid: false, error: `URI must be at most ${MAX_URI_LENGTH} characters` };
    }

    // Basic URI format check
    if (!/^[a-z]+:\/\//i.test(trimmed)) {
        return { valid: false, error: 'Invalid URI format' };
    }

    return { valid: true };
}

/**
 * Validate a relay list.
 * - Must not exceed max number of relays
 * - Each relay must be a valid wss:// or ws:// URL
 */
export function validateRelays(relays: string[] | undefined | null): ValidationResult {
    if (!relays || relays.length === 0) {
        return { valid: false, error: 'At least one relay is required' };
    }

    if (relays.length > MAX_RELAYS_PER_CONNECTION) {
        return { valid: false, error: `At most ${MAX_RELAYS_PER_CONNECTION} relays allowed` };
    }

    for (const relay of relays) {
        if (!/^wss?:\/\/.+/i.test(relay)) {
            return { valid: false, error: `Invalid relay URL: ${relay}` };
        }
    }

    return { valid: true };
}

/**
 * Sanitize a string for safe storage.
 * Trims whitespace and removes control characters.
 */
export function sanitizeString(input: string | undefined | null): string {
    if (!input) {
        return '';
    }
    // Remove control characters (except newlines/tabs in case of multi-line content)
    // eslint-disable-next-line no-control-regex
    return input.trim().replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}
