/**
 * Parser and validator for nostrconnect:// URIs (NIP-46 client-initiated connections).
 *
 * URI format: nostrconnect://<client-pubkey>?relay=wss://...&secret=...&perms=...&name=...&url=...&image=...
 *
 * Required parameters:
 * - relay (one or more): Relay URLs where client listens for responses
 * - secret: Anti-spoofing token that must be returned in connect response
 *
 * Optional parameters:
 * - perms: Comma-separated permission list (e.g., "sign_event:1,nip44_encrypt")
 * - name: Client application name
 * - url: Client application URL
 * - image: Client application icon — kept only if it's a valid `https:` URL; served later
 *   via the SSRF-guarded avatar proxy, never fetched here.
 */

export interface NostrconnectPermission {
    method: string;
    kind?: number;  // For sign_event permissions
}

export interface ParsedNostrconnect {
    clientPubkey: string;
    relays: string[];
    secret: string;
    permissions: NostrconnectPermission[];
    name?: string;
    url?: string;
    /** Validated `https:` avatar URL, if supplied. Served only via the avatar proxy. */
    image?: string;
}

/** Accept an `image` param only if it is a well-formed `https:` URL (structural gate;
 *  the SSRF/size/content-type defenses live in the avatar proxy). */
function parseHttpsImage(raw: string | null): string | undefined {
    if (!raw) return undefined;
    try {
        const u = new URL(raw);
        return u.protocol === 'https:' ? u.toString() : undefined;
    } catch {
        return undefined;
    }
}

export type NostrconnectParseError =
    | { type: 'invalid_scheme'; message: string }
    | { type: 'missing_pubkey'; message: string }
    | { type: 'invalid_pubkey'; message: string }
    | { type: 'missing_relay'; message: string }
    | { type: 'invalid_relay'; message: string; relay: string }
    | { type: 'missing_secret'; message: string };

export type NostrconnectParseResult =
    | { success: true; data: ParsedNostrconnect }
    | { success: false; error: NostrconnectParseError };

const HEX_PUBKEY_REGEX = /^[0-9a-fA-F]{64}$/;
const WSS_RELAY_REGEX = /^wss?:\/\/.+/i;

/**
 * Parse a nostrconnect:// URI into its components.
 */
export function parseNostrconnectUri(uri: string): NostrconnectParseResult {
    const trimmed = uri.trim();

    // Check scheme
    if (!trimmed.startsWith('nostrconnect://')) {
        return {
            success: false,
            error: {
                type: 'invalid_scheme',
                message: 'URI must start with nostrconnect://',
            },
        };
    }

    // Extract the part after the scheme
    const withoutScheme = trimmed.slice('nostrconnect://'.length);

    // Check for missing pubkey (URI starts with ? or is empty)
    if (!withoutScheme || withoutScheme.startsWith('?')) {
        return {
            success: false,
            error: {
                type: 'missing_pubkey',
                message: 'Client pubkey is required',
            },
        };
    }

    // Parse the URI
    let parsed: URL;
    try {
        // URL parser doesn't handle nostrconnect:// well, convert to https temporarily
        parsed = new URL(trimmed.replace('nostrconnect://', 'https://'));
    } catch {
        return {
            success: false,
            error: {
                type: 'invalid_scheme',
                message: 'Invalid URI format',
            },
        };
    }

    // Extract client pubkey from hostname
    const clientPubkey = parsed.hostname.toLowerCase();

    if (!clientPubkey) {
        return {
            success: false,
            error: {
                type: 'missing_pubkey',
                message: 'Client pubkey is required',
            },
        };
    }

    if (!HEX_PUBKEY_REGEX.test(clientPubkey)) {
        return {
            success: false,
            error: {
                type: 'invalid_pubkey',
                message: 'Client pubkey must be 64 hex characters',
            },
        };
    }

    // Extract relays (required, can have multiple)
    const relays = parsed.searchParams.getAll('relay');
    if (relays.length === 0) {
        return {
            success: false,
            error: {
                type: 'missing_relay',
                message: 'At least one relay is required',
            },
        };
    }

    // Validate relay URLs
    const normalizedRelays: string[] = [];
    for (const relay of relays) {
        const normalized = normalizeRelayUrl(relay);
        if (!WSS_RELAY_REGEX.test(normalized)) {
            return {
                success: false,
                error: {
                    type: 'invalid_relay',
                    message: `Invalid relay URL: ${relay}`,
                    relay,
                },
            };
        }
        normalizedRelays.push(normalized);
    }

    // Extract secret (required per spec)
    const secret = parsed.searchParams.get('secret');
    if (!secret) {
        return {
            success: false,
            error: {
                type: 'missing_secret',
                message: 'Secret is required for secure connections',
            },
        };
    }

    // Extract optional parameters
    const name = parsed.searchParams.get('name') || undefined;
    const url = parsed.searchParams.get('url') || undefined;
    const image = parseHttpsImage(parsed.searchParams.get('image'));

    // Parse permissions
    const permsParam = parsed.searchParams.get('perms');
    const permissions = parsePermissions(permsParam);

    return {
        success: true,
        data: {
            clientPubkey,
            relays: normalizedRelays,
            secret,
            permissions,
            name,
            url,
            image,
        },
    };
}

/**
 * Parse the perms parameter into structured permissions.
 * Format: "method1,method2:kind,method3"
 * Example: "sign_event:1,nip44_encrypt,sign_event:7"
 */
function parsePermissions(permsParam: string | null): NostrconnectPermission[] {
    if (!permsParam) {
        return [];
    }

    const permissions: NostrconnectPermission[] = [];
    const parts = permsParam.split(',');

    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) continue;

        if (trimmed.includes(':')) {
            const [method, kindStr] = trimmed.split(':');
            const kind = parseInt(kindStr, 10);
            if (!isNaN(kind)) {
                permissions.push({ method: method.trim(), kind });
            } else {
                // Invalid kind, include method without kind
                permissions.push({ method: method.trim() });
            }
        } else {
            permissions.push({ method: trimmed });
        }
    }

    return permissions;
}

/**
 * Normalize a relay URL to ensure it has wss:// scheme.
 */
function normalizeRelayUrl(relay: string): string {
    const trimmed = relay.trim();
    if (!trimmed) return '';

    // Already has scheme
    if (trimmed.startsWith('wss://') || trimmed.startsWith('ws://')) {
        return trimmed;
    }

    // Add wss:// scheme
    return `wss://${trimmed}`;
}

/**
 * Validate a pubkey string (64 hex characters).
 */
export function isValidPubkey(pubkey: string): boolean {
    return HEX_PUBKEY_REGEX.test(pubkey);
}

/**
 * Format permissions for display in UI.
 * Returns human-readable strings like "Sign notes (kind 1)", "NIP-44 encryption"
 */
export function formatPermissionForDisplay(perm: NostrconnectPermission): string {
    const methodLabels: Record<string, string> = {
        'sign_event': 'Sign events',
        'nip04_encrypt': 'NIP-04 encryption',
        'nip04_decrypt': 'NIP-04 decryption',
        'nip44_encrypt': 'NIP-44 encryption',
        'nip44_decrypt': 'NIP-44 decryption',
        'get_public_key': 'Get public key',
        'ping': 'Ping',
    };

    const kindLabels: Record<number, string> = {
        0: 'profile metadata',
        1: 'notes',
        3: 'contact list',
        4: 'DMs (NIP-04)',
        6: 'reposts',
        7: 'reactions',
        9734: 'zap requests',
        9735: 'zap receipts',
        10002: 'relay list',
        30023: 'long-form content',
    };

    const baseLabel = methodLabels[perm.method] || perm.method;

    if (perm.method === 'sign_event' && perm.kind !== undefined) {
        const kindLabel = kindLabels[perm.kind] || `kind ${perm.kind}`;
        return `Sign ${kindLabel}`;
    }

    return baseLabel;
}
