/**
 * Safe parsing utilities for NIP-46 params.
 *
 * NIP-46 params can be stored in two formats:
 * - Array format: [{ kind: 1, content: "..." }] (from NIP-46 wire format)
 * - Object format: { kind: 1, content: "..." } (when extracted as primaryParam = params[0])
 *
 * These utilities handle both formats consistently.
 */

import type { EventPreview } from '@signet/types';

/**
 * Safely parse NIP-46 params and extract the first parameter.
 * Handles both array format [param] and direct object format.
 *
 * @param params - JSON string of params, or null/undefined
 * @returns The first parameter object, or null if parsing fails
 */
export function parseNip46Param(params: string | null | undefined): unknown {
    if (!params) return null;
    try {
        const parsed = JSON.parse(params);
        return Array.isArray(parsed) ? parsed[0] : parsed;
    } catch {
        return null;
    }
}

/**
 * Extract the event kind from sign_event params.
 *
 * @param params - JSON string of params, or null/undefined
 * @returns The event kind number, or undefined if not found/invalid
 */
export function extractEventKind(params: string | null | undefined): number | undefined {
    const event = parseNip46Param(params);
    if (event && typeof event === 'object' && 'kind' in event) {
        const kind = (event as { kind: unknown }).kind;
        if (typeof kind === 'number') {
            return kind;
        }
    }
    return undefined;
}

/**
 * Parse sign_event params into an EventPreview.
 *
 * @param params - JSON string of params, or null/undefined
 * @returns EventPreview object, or null if parsing fails or data is invalid
 */
export function parseEventPreview(params: string | null | undefined): EventPreview | null {
    const event = parseNip46Param(params);
    if (!event || typeof event !== 'object') {
        return null;
    }

    const obj = event as Record<string, unknown>;
    if (typeof obj.kind !== 'number') {
        return null;
    }

    return {
        kind: obj.kind,
        content: typeof obj.content === 'string' ? obj.content : '',
        tags: Array.isArray(obj.tags) ? obj.tags : [],
    };
}
