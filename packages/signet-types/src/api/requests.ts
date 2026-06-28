import type { ApprovalType } from './dashboard.js';

/**
 * Preview of an event being signed
 */
export interface EventPreview {
    kind: number;
    content: string;
    tags: string[][];
}

/**
 * A pending NIP-46 request waiting for authorization
 */
export interface PendingRequest {
    id: string;
    keyName: string | null;
    method: string;
    remotePubkey: string;
    params: string | null;
    eventPreview?: EventPreview | null;
    createdAt: string;
    expiresAt: string;
    ttlSeconds: number;
    requiresPassword: boolean;
    processedAt?: string | null;
    autoApproved: boolean;
    approvalType?: ApprovalType;
    /** App name from KeyUser.description, or the client-supplied metadata name on a connect request */
    appName?: string | null;
    /** App URL from client-supplied connect metadata (display hint only, never authorization) */
    appUrl?: string | null;
    /**
     * Permissions the client requested on a `connect` request (NIP-46 `optional_requested_perms`),
     * as raw `method[:params]` strings. Display/convenience hint only — not used for authorization.
     */
    requestedPerms?: string[] | null;
    /** Whether the request was allowed (true=approved, false=denied, null=pending/expired) */
    allowed?: boolean | null;
}

/**
 * Wire format for pending requests (before client-side normalization)
 */
export interface PendingRequestWire extends Omit<PendingRequest, 'requiresPassword'> {
    requiresPassword?: boolean;
}

/**
 * Filter for listing requests by status
 * 'admin' filter returns admin activity events (key locks, app suspends, etc.)
 */
export type RequestFilter = 'all' | 'pending' | 'approved' | 'denied' | 'expired' | 'admin';

/**
 * Display-ready request with computed fields
 */
export interface DisplayRequest extends PendingRequest {
    /** Seconds remaining until expiration */
    ttl: number;
    /** npub-encoded remote pubkey */
    npub: string;
    /** Human-readable creation time (e.g., "5m ago") */
    createdLabel: string;
    /** Current request state */
    state: 'pending' | 'expired' | 'approved' | 'denied';
    /** When the request was approved (if applicable) */
    approvedAt?: string;
}

/**
 * Request metadata for tracking UI state
 */
export type RequestMeta =
    | { state: 'idle' }
    | { state: 'approving' }
    | { state: 'success'; message: string }
    | { state: 'error'; message: string };
