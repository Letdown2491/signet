/**
 * Parser for the `connect` RPC's optional client-supplied fields (NIP-46).
 *
 * The `connect` params are positional:
 *   [<remote-signer-pubkey>, <optional_secret>, <optional_requested_perms>, <optional_client_metadata>]
 *
 * - `optional_requested_perms` (params[2]) is a comma-separated `method[:params]` list,
 *   e.g. "sign_event:1,nip44_encrypt". Per the spec, to send metadata without requesting
 *   permissions an empty string is passed here so metadata still occupies the fourth position.
 * - `optional_client_metadata` (params[3]) is a JSON-stringified `{name, url, image}` object.
 *   `name` and `url` are surfaced as text. `image` is captured only as an `https:` URL and is
 *   NEVER fetched here — the daemon serves it later through an SSRF-guarded, size-capped proxy
 *   (`GET /apps/:id/avatar`) and the UI falls back to a deterministic identicon. It remains an
 *   untrusted display hint and MUST NOT influence authorization.
 *
 * This information is most useful for the `bunker://` flow, where — unlike `nostrconnect://` —
 * the remote-signer has no other source for the connecting app's identity.
 *
 * IMPORTANT: per NIP-46 this is client-supplied and unauthenticated. It is a display/convenience
 * hint only and MUST NOT influence authorization decisions.
 */

import { sanitizeString } from './validation.js';

export interface ConnectClientMetadata {
    name?: string;
    url?: string;
    /** Validated `https:` avatar URL. Never fetched at parse time — proxied later. */
    image?: string;
    /** Raw requested-permission strings, e.g. "sign_event:1", "nip44_encrypt". */
    perms?: string[];
}

// Bounds so a malicious/oversized connect payload can't bloat the stored row or the UI.
const MAX_FIELD_LEN = 256;
const MAX_PERMS = 64;
// A URL can legitimately run longer than a display field (query params, signed CDN URLs).
const MAX_URL_LEN = 2048;

function sanitizeField(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const cleaned = sanitizeString(value).slice(0, MAX_FIELD_LEN);
    return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Accept a value only if it is a well-formed, length-bounded `https:` URL. This is a
 * cheap structural gate at parse time; the network-level SSRF defenses (DNS resolution,
 * private-IP blocking, redirect/size/content-type limits) live in the avatar proxy.
 * `http:` is rejected so we never request an avatar over cleartext.
 */
function sanitizeImageUrl(value: unknown): string | undefined {
    if (typeof value !== 'string') return undefined;
    const cleaned = sanitizeString(value).slice(0, MAX_URL_LEN);
    if (!cleaned) return undefined;
    let parsed: URL;
    try {
        parsed = new URL(cleaned);
    } catch {
        return undefined;
    }
    if (parsed.protocol !== 'https:') return undefined;
    return parsed.toString();
}

function parsePerms(raw: unknown): string[] {
    if (typeof raw !== 'string' || !raw.trim()) return [];
    return raw
        .split(',')
        .map(p => sanitizeString(p).slice(0, MAX_FIELD_LEN))
        .filter(Boolean)
        .slice(0, MAX_PERMS);
}

/**
 * Extract client metadata + requested perms from a raw `connect` params array.
 * Returns undefined when nothing usable was supplied.
 */
export function parseConnectMetadata(params: string[] | undefined): ConnectClientMetadata | undefined {
    if (!Array.isArray(params)) return undefined;

    const perms = parsePerms(params[2]);

    let name: string | undefined;
    let url: string | undefined;
    let image: string | undefined;

    const rawMeta = params[3];
    if (typeof rawMeta === 'string' && rawMeta.trim()) {
        try {
            const obj = JSON.parse(rawMeta) as Record<string, unknown>;
            if (obj && typeof obj === 'object') {
                name = sanitizeField(obj.name);
                url = sanitizeField(obj.url);
                image = sanitizeImageUrl(obj.image);
            }
        } catch {
            // Malformed metadata is a display hint only — ignore it rather than failing the connect.
        }
    }

    if (!name && !url && !image && perms.length === 0) return undefined;
    return {
        name,
        url,
        image,
        perms: perms.length > 0 ? perms : undefined,
    };
}

/**
 * Round-trip the metadata we persist on a connect `Request.params`. Legacy connect rows stored
 * the target signer pubkey there, which is not valid JSON for our shape — those decode to undefined.
 */
export function decodeConnectMetadata(params: string | null | undefined): ConnectClientMetadata | undefined {
    if (!params) return undefined;
    try {
        const obj = JSON.parse(params) as ConnectClientMetadata;
        if (obj && typeof obj === 'object' && (obj.name || obj.url || obj.image || obj.perms)) {
            return obj;
        }
    } catch {
        // Not a metadata blob (legacy connect stored the target pubkey here) — ignore.
    }
    return undefined;
}
