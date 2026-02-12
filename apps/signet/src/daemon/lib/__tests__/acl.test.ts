import { describe, it, expect } from 'vitest';
import {
    isKindSafe,
    getTrustLevelInfo,
    scopeToCondition,
    SAFE_KINDS,
    SENSITIVE_KINDS,
} from '../acl.js';

describe('isKindSafe', () => {
    it('should return true for safe kinds', () => {
        expect(isKindSafe(1)).toBe(true);   // Short text note
        expect(isKindSafe(6)).toBe(true);   // Repost
        expect(isKindSafe(7)).toBe(true);   // Reaction
        expect(isKindSafe(16)).toBe(true);  // Generic repost
        expect(isKindSafe(1111)).toBe(true); // Comment
        expect(isKindSafe(30023)).toBe(true); // Long-form article
        expect(isKindSafe(24242)).toBe(true); // Blossom auth
    });

    it('should return false for sensitive kinds', () => {
        expect(isKindSafe(0)).toBe(false);    // Profile metadata
        expect(isKindSafe(3)).toBe(false);    // Contact list
        expect(isKindSafe(4)).toBe(false);    // NIP-04 DM
        expect(isKindSafe(5)).toBe(false);    // Event deletion
        expect(isKindSafe(10002)).toBe(false); // Relay list
        expect(isKindSafe(22242)).toBe(false); // Client auth
        expect(isKindSafe(24133)).toBe(false); // NIP-46 request
        expect(isKindSafe(13194)).toBe(false); // Wallet info
    });

    it('should return false for unknown kinds (safe by default)', () => {
        expect(isKindSafe(99999)).toBe(false); // Unknown kind
        expect(isKindSafe(42)).toBe(false);    // Not in safe set
        expect(isKindSafe(-1)).toBe(false);    // Negative (unlikely but test it)
    });

    it('should have no overlap between SAFE_KINDS and SENSITIVE_KINDS', () => {
        for (const kind of SAFE_KINDS) {
            expect(SENSITIVE_KINDS.has(kind)).toBe(false);
        }
    });
});

describe('getTrustLevelInfo', () => {
    it('should return correct info for paranoid level', () => {
        const info = getTrustLevelInfo('paranoid');
        expect(info.label).toBe("I'm Paranoid");
        expect(info.description).toContain('manual approval');
        expect(info.icon).toBe('🔒');
    });

    it('should return correct info for reasonable level', () => {
        const info = getTrustLevelInfo('reasonable');
        expect(info.label).toBe("Let's Be Reasonable");
        expect(info.description).toContain('Auto-approve');
        expect(info.description).toContain('sensitive');
        expect(info.icon).toBe('⚖️');
    });

    it('should return correct info for full level', () => {
        const info = getTrustLevelInfo('full');
        expect(info.label).toBe('Full Trust');
        expect(info.description).toContain('everything');
        expect(info.icon).toBe('🤝');
    });
});

describe('scopeToCondition', () => {
    it('should return method only when no scope provided', () => {
        expect(scopeToCondition('sign_event')).toEqual({ method: 'sign_event' });
        expect(scopeToCondition('connect')).toEqual({ method: 'connect' });
    });

    it('should return method only when scope is empty', () => {
        expect(scopeToCondition('sign_event', {})).toEqual({ method: 'sign_event' });
    });

    it('should include kind when scope has numeric kind', () => {
        expect(scopeToCondition('sign_event', { kind: 1 })).toEqual({
            method: 'sign_event',
            kind: '1',
        });
        expect(scopeToCondition('sign_event', { kind: 30023 })).toEqual({
            method: 'sign_event',
            kind: '30023',
        });
    });

    it('should include "all" when scope has all kinds', () => {
        expect(scopeToCondition('sign_event', { kind: 'all' })).toEqual({
            method: 'sign_event',
            kind: 'all',
        });
    });

    it('should handle kind 0 correctly', () => {
        expect(scopeToCondition('sign_event', { kind: 0 })).toEqual({
            method: 'sign_event',
            kind: '0',
        });
    });
});

describe('SAFE_KINDS and SENSITIVE_KINDS sets', () => {
    it('should contain expected social kinds as safe', () => {
        // Common social actions
        expect(SAFE_KINDS.has(1)).toBe(true);   // Note
        expect(SAFE_KINDS.has(7)).toBe(true);   // Reaction
        expect(SAFE_KINDS.has(6)).toBe(true);   // Repost
    });

    it('should contain identity/privacy kinds as sensitive', () => {
        expect(SENSITIVE_KINDS.has(0)).toBe(true);  // Profile
        expect(SENSITIVE_KINDS.has(3)).toBe(true);  // Follow list
        expect(SENSITIVE_KINDS.has(4)).toBe(true);  // DM
    });

    it('should contain financial kinds as sensitive', () => {
        expect(SENSITIVE_KINDS.has(13194)).toBe(true); // Wallet info
        expect(SENSITIVE_KINDS.has(23194)).toBe(true); // Wallet request
        expect(SENSITIVE_KINDS.has(23195)).toBe(true); // Wallet response
    });
});
