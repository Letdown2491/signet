import type { Event } from 'nostr-tools/pure';
import createDebug from 'debug';
import prisma from '../../db.js';
import { ACL_CACHE_TTL_MS, ACL_CACHE_MAX_SIZE } from '../constants.js';
import { TTLCache } from './ttl-cache.js';

const debug = createDebug('signet:acl');

export type RpcMethod =
    | 'connect'
    | 'sign_event'
    | 'get_public_key'
    | 'encrypt' | 'decrypt'  // Legacy generic names
    | 'nip04_encrypt' | 'nip04_decrypt'
    | 'nip44_encrypt' | 'nip44_decrypt'
    | 'ping';

/**
 * Cache entry for ACL decisions.
 * Uses TTLCache for automatic TTL expiration and periodic cleanup.
 */
interface CacheEntry {
    keyUser: {
        id: number;
        revokedAt: Date | null;
        suspendedAt: Date | null;
        suspendUntil: Date | null;
        trustLevel: string | null;
    };
    hasExplicitDeny: boolean;
}

/**
 * Check if an app is currently suspended.
 * Returns true if suspended and suspension hasn't expired yet.
 */
function isCurrentlySuspended(suspendedAt: Date | null, suspendUntil: Date | null): boolean {
    if (!suspendedAt) {
        return false;
    }
    // If no end time, suspended indefinitely
    if (!suspendUntil) {
        return true;
    }
    // If end time has passed, no longer suspended
    return suspendUntil.getTime() > Date.now();
}

/**
 * ACL cache using TTLCache for automatic expiration and periodic cleanup.
 * This prevents memory leaks from expired entries that are never accessed.
 */
const aclCache = new TTLCache<CacheEntry>('acl-cache', {
    ttlMs: ACL_CACHE_TTL_MS,
    maxSize: ACL_CACHE_MAX_SIZE,
});

function getCacheKey(keyName: string, remotePubkey: string): string {
    // Use null byte as delimiter to prevent collision attacks
    // (e.g., keyName="a:b" + pubkey="c" vs keyName="a" + pubkey="b:c")
    return `${keyName}\x00${remotePubkey}`;
}

function getCachedEntry(keyName: string, remotePubkey: string): CacheEntry | null {
    const key = getCacheKey(keyName, remotePubkey);
    // TTLCache.get() automatically returns undefined for expired entries
    return aclCache.get(key) ?? null;
}

function setCachedEntry(keyName: string, remotePubkey: string, entry: CacheEntry): void {
    const key = getCacheKey(keyName, remotePubkey);
    // TTLCache handles TTL and max size automatically
    aclCache.set(key, entry);
}

/**
 * Invalidate cache for a specific key/pubkey combination.
 * Call this when permissions change.
 */
export function invalidateAclCache(keyName: string, remotePubkey: string): void {
    aclCache.delete(getCacheKey(keyName, remotePubkey));
}

/**
 * Invalidate all cache entries for a key.
 * Call this when revoking all apps for a key.
 */
export function invalidateAclCacheForKey(keyName: string): void {
    const prefix = `${keyName}\x00`;
    aclCache.deleteMatching((key) => key.startsWith(prefix));
}

/**
 * Clear the entire ACL cache.
 */
export function clearAclCache(): void {
    aclCache.clear();
}

export type TrustLevel = 'paranoid' | 'reasonable' | 'full';

export type AllowScope = {
    kind?: number | 'all';
};

/**
 * Approval type for tracking how a request was approved
 */
export type ApprovalType = 'manual' | 'auto_trust' | 'auto_permission';

/**
 * Result of an ACL permission check.
 * - permitted: true (allowed), false (denied), undefined (needs manual approval)
 * - autoApproved: true if permitted automatically (for backwards compatibility)
 * - approvalType: distinguishes between trust level and explicit permission auto-approval
 * - keyUserId: the KeyUser id (for logging)
 */
export interface PermissionResult {
    permitted: boolean | undefined;
    autoApproved: boolean;
    approvalType?: ApprovalType;
    keyUserId?: number;
}

/**
 * Event kinds considered "safe" for auto-approval in "reasonable" trust level.
 * These are common social actions that are low-risk.
 */
export const SAFE_KINDS = new Set([
    1,      // Short text note
    6,      // Repost
    7,      // Reaction
    16,     // Generic repost
    1111,   // Comment
    30023,  // Long-form article
    30024,  // Draft long-form
    1808,   // Zap goal
    9735,   // Zap receipt (created by wallet, but harmless)
    10000,  // Mute list (user preference)
    10001,  // Pin list
    30000,  // Follow sets
    30001,  // Bookmark sets
    24242,  // Blossom authorization (file upload/delete auth)
]);

/**
 * Event kinds considered "sensitive" that require explicit approval even in "reasonable" mode.
 * These can change identity, leak data, or have security implications.
 */
export const SENSITIVE_KINDS = new Set([
    0,      // Profile metadata (identity)
    3,      // Contact/follow list (social graph)
    4,      // NIP-04 encrypted DM (privacy)
    5,      // Event deletion (irreversible)
    10002,  // Relay list (can affect connectivity)
    22242,  // Client authentication (security)
    24133,  // NIP-46 request (meta - signing for another signer)
    13194,  // Wallet info (financial)
    23194,  // Wallet request (financial)
    23195,  // Wallet response (financial)
]);

/**
 * Check if a kind is safe for auto-approval in "reasonable" mode.
 * Unknown kinds default to requiring approval (safe by default).
 */
export function isKindSafe(kind: number): boolean {
    if (SENSITIVE_KINDS.has(kind)) {
        return false;
    }
    // Only auto-approve explicitly safe kinds
    return SAFE_KINDS.has(kind);
}

/**
 * Get the trust level display info
 */
export function getTrustLevelInfo(level: TrustLevel): { label: string; description: string; icon: string } {
    switch (level) {
        case 'paranoid':
            return {
                label: "I'm Paranoid",
                description: 'Every action requires manual approval',
                icon: '🔒',
            };
        case 'reasonable':
            return {
                label: "Let's Be Reasonable",
                description: 'Auto-approve common actions, ask for sensitive ones',
                icon: '⚖️',
            };
        case 'full':
            return {
                label: 'Full Trust',
                description: 'Auto-approve everything',
                icon: '🤝',
            };
    }
}

type SigningConditionQuery = {
    method: string;
    kind?: string | { in: string[] };
};

function extractKind(payload?: string | Event): number | undefined {
    if (!payload) {
        return undefined;
    }

    if (typeof payload === 'string') {
        try {
            const parsed = JSON.parse(payload);
            if (typeof parsed?.kind === 'number') {
                return parsed.kind;
            }
        } catch {
            return undefined;
        }
        return undefined;
    }

    if ('kind' in payload && typeof payload.kind === 'number') {
        return payload.kind;
    }

    return undefined;
}

function buildConditionQuery(
    method: RpcMethod,
    payload?: string | Event
): SigningConditionQuery {
    if (method !== 'sign_event') {
        return { method };
    }

    const kind = extractKind(payload);
    const kinds = new Set<string>(['all']);
    if (typeof kind === 'number') {
        kinds.add(kind.toString());
    }

    return {
        method,
        kind: { in: Array.from(kinds) },
    };
}

/**
 * Check if a request should be auto-approved based on trust level.
 * This is called AFTER checking explicit SigningConditions.
 */
function shouldAutoApproveByTrustLevel(
    trustLevel: TrustLevel,
    method: RpcMethod,
    payload?: string | Event
): boolean {
    // Paranoid: never auto-approve anything
    if (trustLevel === 'paranoid') {
        return false;
    }

    // Full trust: approve everything
    if (trustLevel === 'full') {
        return true;
    }

    // Reasonable: approve based on method and kind
    switch (method) {
        case 'connect':
            // Reconnects from known apps are auto-approved at reasonable/full trust
            // (paranoid users already returned false above)
            return true;
        case 'ping':
        case 'get_public_key':
            // These are always safe - no signing involved
            return true;
        case 'nip44_encrypt':
        case 'nip44_decrypt':
            // NIP-44 is general-purpose encryption used for many things
            // (blossom file auth, general data encryption, etc.)
            // Safe to auto-approve at reasonable trust level
            return true;
        case 'encrypt':
        case 'decrypt':
        case 'nip04_encrypt':
        case 'nip04_decrypt':
            // NIP-04 is specifically for encrypted DMs (privacy sensitive)
            // Legacy generic names also treated as NIP-04 for safety
            return false;
        case 'sign_event':
            const kind = extractKind(payload);
            if (kind === undefined) {
                // Unknown kind, require approval
                return false;
            }
            return isKindSafe(kind);
        default:
            return false;
    }
}

/**
 * Check if a request is permitted with full result details.
 * Returns permission decision, whether it was auto-approved, and the keyUserId.
 */
export async function checkRequestPermission(
    keyName: string,
    remotePubkey: string,
    method: RpcMethod,
    payload?: string | Event
): Promise<PermissionResult> {
    // Try to get cached keyUser info
    let cached = getCachedEntry(keyName, remotePubkey);
    let keyUserId: number;
    let trustLevel: TrustLevel;

    if (cached) {
        // Use cached data for quick checks
        if (cached.keyUser.revokedAt) {
            return { permitted: false, autoApproved: false, keyUserId: cached.keyUser.id };
        }
        if (isCurrentlySuspended(cached.keyUser.suspendedAt, cached.keyUser.suspendUntil)) {
            return { permitted: false, autoApproved: false, keyUserId: cached.keyUser.id };
        }
        if (cached.hasExplicitDeny) {
            return { permitted: false, autoApproved: false, keyUserId: cached.keyUser.id };
        }
        keyUserId = cached.keyUser.id;
        trustLevel = (cached.keyUser.trustLevel as TrustLevel) ?? 'reasonable';
    } else {
        // Fetch from database and cache
        const keyUser = await prisma.keyUser.findUnique({
            where: { unique_key_user: { keyName, userPubkey: remotePubkey } },
            select: { id: true, revokedAt: true, suspendedAt: true, suspendUntil: true, trustLevel: true },
        });

        if (!keyUser) {
            // Unknown client - only allow 'connect' requests to proceed to authorization
            // All other requests from unknown clients are rejected immediately
            // This prevents request floods from clients that haven't connected yet
            if (method === 'connect') {
                return { permitted: undefined, autoApproved: false };
            }
            return { permitted: false, autoApproved: false };
        }

        // Check if user is revoked
        if (keyUser.revokedAt) {
            return { permitted: false, autoApproved: false, keyUserId: keyUser.id };
        }

        // Check if user is suspended (and suspension hasn't expired)
        if (isCurrentlySuspended(keyUser.suspendedAt, keyUser.suspendUntil)) {
            // Cache the suspended state
            setCachedEntry(keyName, remotePubkey, {
                keyUser,
                hasExplicitDeny: false,
            });
            return { permitted: false, autoApproved: false, keyUserId: keyUser.id };
        }

        // Check for explicit deny
        const explicitDeny = await prisma.signingCondition.findFirst({
            where: {
                keyUserId: keyUser.id,
                method: '*',
                allowed: false,
            },
        });

        // Cache the result
        setCachedEntry(keyName, remotePubkey, {
            keyUser,
            hasExplicitDeny: !!explicitDeny,
        });

        if (explicitDeny) {
            return { permitted: false, autoApproved: false, keyUserId: keyUser.id };
        }

        keyUserId = keyUser.id;
        trustLevel = (keyUser.trustLevel as TrustLevel) ?? 'reasonable';
    }

    // Check for explicit permission condition (not cached - method/kind specific)
    const query = buildConditionQuery(method, payload);
    const condition = await prisma.signingCondition.findFirst({
        where: {
            keyUserId,
            ...query,
        },
    });

    if (condition) {
        if (condition.allowed === true) {
            // Explicit permission grant - auto-approved via SigningCondition
            return { permitted: true, autoApproved: true, approvalType: 'auto_permission', keyUserId };
        }
        if (condition.allowed === false) {
            // Explicit deny - not auto-approved
            return { permitted: false, autoApproved: false, keyUserId };
        }
    }

    // No explicit condition - check trust level for auto-approval
    if (shouldAutoApproveByTrustLevel(trustLevel, method, payload)) {
        // Update lastUsedAt for tracking (fire and forget to avoid blocking)
        prisma.keyUser.update({
            where: { id: keyUserId },
            data: { lastUsedAt: new Date() },
        }).catch((error) => {
            // Log at debug level - this is non-critical but shouldn't be completely silent
            debug('Failed to update lastUsedAt for keyUser %d: %s', keyUserId, error?.message ?? error);
        });
        return { permitted: true, autoApproved: true, approvalType: 'auto_trust', keyUserId };
    }

    // No decision - will trigger approval request
    return { permitted: undefined, autoApproved: false, keyUserId };
}

/**
 * Check if a request is permitted (simple boolean result for backward compatibility).
 */
export async function isRequestPermitted(
    keyName: string,
    remotePubkey: string,
    method: RpcMethod,
    payload?: string | Event
): Promise<boolean | undefined> {
    const result = await checkRequestPermission(keyName, remotePubkey, method, payload);
    return result.permitted;
}

export function scopeToCondition(method: RpcMethod | string, scope?: AllowScope): SigningConditionQuery {
    if (!scope || scope.kind === undefined) {
        return { method };
    }

    return {
        method,
        kind: scope.kind.toString(),
    };
}

export async function permitAllRequests(
    remotePubkey: string,
    keyName: string,
    method: RpcMethod | string,
    description?: string,
    scope?: AllowScope
): Promise<void> {
    const keyUser = await prisma.keyUser.upsert({
        where: { unique_key_user: { keyName, userPubkey: remotePubkey } },
        update: {},
        create: { keyName, userPubkey: remotePubkey, description },
    });

    // Determine kind string from scope
    const kindValue = scope?.kind !== undefined ? scope.kind.toString() : undefined;

    await prisma.signingCondition.create({
        data: {
            keyUserId: keyUser.id,
            allowed: true,
            method,
            kind: kindValue,
        },
    });

    // Invalidate cache since permissions changed
    invalidateAclCache(keyName, remotePubkey);
}

export async function blockAllRequests(remotePubkey: string, keyName: string): Promise<void> {
    const keyUser = await prisma.keyUser.upsert({
        where: { unique_key_user: { keyName, userPubkey: remotePubkey } },
        update: {},
        create: { keyName, userPubkey: remotePubkey },
    });

    await prisma.signingCondition.create({
        data: {
            keyUserId: keyUser.id,
            allowed: false,
            method: '*',
        },
    });

    // Invalidate cache since permissions changed
    invalidateAclCache(keyName, remotePubkey);
}

/**
 * Grant permissions to an app based on trust level.
 * This is called when approving a connect request.
 * @returns The keyUser id for the granted app
 */
export async function grantPermissionsByTrustLevel(
    remotePubkey: string,
    keyName: string,
    trustLevel: TrustLevel,
    description?: string
): Promise<number> {
    // Create or update KeyUser with trust level
    const keyUser = await prisma.keyUser.upsert({
        where: { unique_key_user: { keyName, userPubkey: remotePubkey } },
        update: { trustLevel, description: description ?? undefined },
        create: { keyName, userPubkey: remotePubkey, trustLevel, description },
    });

    // Always grant connect permission explicitly
    await prisma.signingCondition.create({
        data: {
            keyUserId: keyUser.id,
            allowed: true,
            method: 'connect',
        },
    });

    // For 'full' trust, also grant explicit permissions for sensitive operations
    // (sign_event and ping will be auto-approved by trust level check anyway)
    if (trustLevel === 'full') {
        await prisma.signingCondition.createMany({
            data: [
                { keyUserId: keyUser.id, allowed: true, method: 'nip04_encrypt' },
                { keyUserId: keyUser.id, allowed: true, method: 'nip04_decrypt' },
                { keyUserId: keyUser.id, allowed: true, method: 'nip44_encrypt' },
                { keyUserId: keyUser.id, allowed: true, method: 'nip44_decrypt' },
                { keyUserId: keyUser.id, allowed: true, method: 'sign_event', kind: 'all' },
            ],
        });
    }

    // Invalidate cache since permissions changed
    invalidateAclCache(keyName, remotePubkey);

    return keyUser.id;
}

/**
 * Update the trust level for an existing app.
 */
export async function updateTrustLevel(
    keyUserId: number,
    trustLevel: TrustLevel
): Promise<void> {
    const keyUser = await prisma.keyUser.update({
        where: { id: keyUserId },
        data: { trustLevel },
        select: { keyName: true, userPubkey: true },
    });

    // When downgrading from full trust, remove explicit permissions that were
    // auto-granted. These would otherwise bypass trust level checks.
    if (trustLevel === 'paranoid' || trustLevel === 'reasonable') {
        // Remove sign_event with kind 'all' (granted at full trust)
        await prisma.signingCondition.deleteMany({
            where: {
                keyUserId,
                method: 'sign_event',
                kind: 'all',
                allowed: true,
            },
        });
    }

    if (trustLevel === 'paranoid') {
        // Also remove NIP-04/NIP-44 encrypt/decrypt permissions (granted at full trust)
        await prisma.signingCondition.deleteMany({
            where: {
                keyUserId,
                method: {
                    in: ['nip04_encrypt', 'nip04_decrypt', 'nip44_encrypt', 'nip44_decrypt'],
                },
                allowed: true,
            },
        });
    }

    // If upgrading to full trust, add encrypt/decrypt permissions for NIP-04
    // (NIP-44 is already auto-approved at reasonable trust)
    if (trustLevel === 'full') {
        const existingEncrypt = await prisma.signingCondition.findFirst({
            where: { keyUserId, method: 'nip04_encrypt', allowed: true },
        });
        if (!existingEncrypt) {
            await prisma.signingCondition.createMany({
                data: [
                    { keyUserId, allowed: true, method: 'nip04_encrypt' },
                    { keyUserId, allowed: true, method: 'nip04_decrypt' },
                    { keyUserId, allowed: true, method: 'nip44_encrypt' },
                    { keyUserId, allowed: true, method: 'nip44_decrypt' },
                    { keyUserId, allowed: true, method: 'sign_event', kind: 'all' },
                ],
            });
        }
    }

    // Invalidate cache since trust level changed
    invalidateAclCache(keyUser.keyName, keyUser.userPubkey);
}

/**
 * Get trust level for an app.
 */
export async function getTrustLevel(keyUserId: number): Promise<TrustLevel> {
    const keyUser = await prisma.keyUser.findUnique({
        where: { id: keyUserId },
        select: { trustLevel: true },
    });
    return (keyUser?.trustLevel as TrustLevel) ?? 'reasonable';
}
