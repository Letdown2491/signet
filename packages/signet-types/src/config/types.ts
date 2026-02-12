/**
 * Encryption format for stored keys
 */
export type EncryptionFormat = 'none' | 'legacy' | 'nip49';

/**
 * Encrypted or plain-text key storage format
 *
 * Detection logic:
 * - Has `ncryptsec` → NIP-49 encrypted
 * - Has `iv` + `data` → legacy encrypted (AES-256-GCM)
 * - Has `key` only → unencrypted
 */
export interface StoredKey {
    /** Initialization vector for legacy encrypted keys (hex) */
    iv?: string;
    /** Encrypted key data for legacy format (hex) */
    data?: string;
    /** Plain-text nsec (if not encrypted) */
    key?: string;
    /** NIP-49 encrypted key (ncryptsec bech32 string) */
    ncryptsec?: string;
}

/**
 * DM protocol type for kill switch commands
 */
export type KillSwitchDmType = 'NIP04' | 'NIP17';

/**
 * Kill switch configuration for remote admin commands via Nostr DMs
 */
export interface KillSwitchConfig {
    /** Admin npub authorized to send commands */
    adminNpub: string;
    /** Relay URLs to listen for admin DMs */
    adminRelays: string[];
    /** DM protocol type (NIP04 or NIP17) */
    dmType: KillSwitchDmType;
}

/**
 * Admin interface configuration
 */
export interface AdminConfig {
    /** Private key for bunker signer (hex) */
    key: string;
    /** Secret for bunker URI authentication */
    secret?: string;
}

/**
 * Nostr relay configuration
 */
export interface NostrConfig {
    relays: string[];
}

/**
 * Main Signet configuration file structure
 */
export interface ConfigFile {
    /** Nostr relay configuration */
    nostr: NostrConfig;
    /** Admin interface configuration */
    admin: AdminConfig;
    /** HTTP server port for REST API */
    authPort?: number;
    /** HTTP server host binding */
    authHost?: string;
    /** Public base URL for callbacks */
    baseUrl?: string;
    /** Database connection string */
    database?: string;
    /** Log file path */
    logs?: string;
    /** Stored keys (encrypted or plain) */
    keys: Record<string, StoredKey>;
    /** Enable verbose logging */
    verbose: boolean;
    /** Secret key for signing JWT tokens (auto-generated if not provided) */
    jwtSecret?: string;
    /** List of allowed CORS origins */
    allowedOrigins?: string[];
    /** Require authentication for API access (default: false for local use) */
    requireAuth?: boolean;
    /** Kill switch configuration for remote admin commands */
    killSwitch?: KillSwitchConfig;
}
