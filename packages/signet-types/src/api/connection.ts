/**
 * Bunker connection information returned by GET /connection
 */
export interface ConnectionInfo {
    /** npub-encoded admin public key */
    npub: string;
    /** Hex-encoded admin public key */
    pubkey: string;
    /** Bunker URI using npub */
    npubUri: string;
    /** Bunker URI using hex pubkey */
    hexUri: string;
    /** Admin relay URLs for NIP-46 RPC */
    relays: string[];
    /** Admin secret for authentication (optional) */
    secret?: string | null;
    /** Nostr relays for NIP-46 requests */
    nostrRelays?: string[];
}

/**
 * Status of a single relay connection
 */
export interface RelayStatus {
    /** Relay URL */
    url: string;
    /** Whether the relay is currently connected */
    connected: boolean;
    /** When the relay was last connected */
    lastConnected: string | null;
    /** When the relay was last disconnected */
    lastDisconnected: string | null;
    /** Trust score from trustedrelays.xyz (0-100, null if unavailable) */
    trustScore: number | null;
}

/**
 * Relay status summary returned by GET /relays
 */
export interface RelayStatusResponse {
    /** Number of relays currently connected */
    connected: number;
    /** Total number of configured relays */
    total: number;
    /** Status of each individual relay */
    relays: RelayStatus[];
}

/**
 * Response from POST /relays/trust-scores for on-demand trust score lookup
 */
export interface RelayTrustScoreResponse {
    /** Map of relay URL to trust score (null if unavailable) */
    scores: Record<string, number | null>;
}
