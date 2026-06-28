/**
 * Trust level for an app - determines auto-approval behavior
 */
export type TrustLevel = 'paranoid' | 'reasonable' | 'full';

/**
 * Method usage counts for an app
 */
export interface MethodBreakdown {
    sign_event: number;
    nip04_encrypt: number;
    nip04_decrypt: number;
    nip44_encrypt: number;
    nip44_decrypt: number;
    get_public_key: number;
    other: number;
}

/**
 * A connected application/client with access to a key
 */
export interface ConnectedApp {
    id: number;
    keyName: string;
    userPubkey: string;
    description?: string;
    /**
     * True when the app supplied a (validated, https) image URL at connect time.
     * The image itself is served via the daemon's avatar proxy (GET /apps/:id/avatar),
     * never fetched directly by the browser. The UI falls back to the pubkey identicon
     * when this is false or the proxy fails.
     */
    hasImage?: boolean;
    trustLevel: TrustLevel;
    permissions: string[];
    connectedAt: string;
    lastUsedAt: string | null;
    suspendedAt: string | null;
    suspendUntil: string | null;
    requestCount: number;
    methodBreakdown: MethodBreakdown;
}

/**
 * Permission risk level for display
 */
export type PermissionRisk = 'high' | 'medium' | 'low';

/**
 * Request body for updating an app
 */
export interface UpdateAppRequest {
    description?: string;
    trustLevel?: TrustLevel;
}

/**
 * Response from app operations
 */
export interface AppOperationResponse {
    ok: boolean;
    error?: string;
}
