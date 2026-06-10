import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock prisma so the DB-backed authorization logic can be driven deterministically.
// `h.prisma` is the mock client; the `keyUser`/`explicitDeny`/`condition` knobs are what
// its query mocks return (wired up in each suite's beforeEach). `$transaction` runs its
// callback against the same mock client, so writes inside a transaction are observable.
const h = vi.hoisted(() => {
  const prisma = {
    keyUser: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    signingCondition: {
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  return {
    prisma,
    keyUser: null as null | Record<string, unknown>,
    explicitDeny: null as null | Record<string, unknown>,
    condition: null as null | Record<string, unknown>,
  };
});

vi.mock('../../../db.js', () => ({ default: h.prisma }));

import {
    isKindSafe,
    getTrustLevelInfo,
    scopeToCondition,
    SAFE_KINDS,
    SENSITIVE_KINDS,
    checkRequestPermission,
    updateTrustLevel,
    clearAclCache,
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

describe('checkRequestPermission (authorization gate)', () => {
    const KEY = 'test-key';
    const PUBKEY = 'client-pubkey';
    const signEvent = (kind: number) => JSON.stringify({ kind });
    const activeUser = (trustLevel: string) => ({
        id: 42, revokedAt: null, suspendedAt: null, suspendUntil: null, trustLevel,
    });

    beforeEach(() => {
        vi.clearAllMocks();
        clearAclCache();
        h.keyUser = null;
        h.explicitDeny = null;
        h.condition = null;
        h.prisma.keyUser.findUnique.mockImplementation(async () => h.keyUser);
        h.prisma.keyUser.update.mockResolvedValue({ keyName: KEY, userPubkey: PUBKEY });
        h.prisma.signingCondition.findFirst.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
            const where = args?.where ?? {};
            if (where.method === '*' && where.allowed === false) return h.explicitDeny;
            return h.condition;
        });
    });

    it('denies an unknown client for non-connect methods', async () => {
        const r = await checkRequestPermission(KEY, PUBKEY, 'sign_event', signEvent(1));
        expect(r.permitted).toBe(false);
        expect(r.keyUserId).toBeUndefined();
    });

    it('routes an unknown client\'s connect to manual approval (permitted=undefined)', async () => {
        const r = await checkRequestPermission(KEY, PUBKEY, 'connect');
        expect(r.permitted).toBeUndefined();
    });

    it('denies a revoked app even at full trust', async () => {
        h.keyUser = { ...activeUser('full'), revokedAt: new Date() };
        const r = await checkRequestPermission(KEY, PUBKEY, 'sign_event', signEvent(1));
        expect(r.permitted).toBe(false);
    });

    it('denies a currently-suspended app even at full trust', async () => {
        h.keyUser = { ...activeUser('full'), suspendedAt: new Date(), suspendUntil: null };
        const r = await checkRequestPermission(KEY, PUBKEY, 'sign_event', signEvent(1));
        expect(r.permitted).toBe(false);
    });

    it('does not deny once a suspension has expired', async () => {
        const past = new Date(Date.now() - 60_000);
        h.keyUser = { ...activeUser('full'), suspendedAt: past, suspendUntil: past };
        const r = await checkRequestPermission(KEY, PUBKEY, 'sign_event', signEvent(1));
        expect(r.permitted).toBe(true); // falls through to full-trust auto-approve
    });

    it('honors an explicit blanket deny (method "*") over trust level', async () => {
        h.keyUser = activeUser('full');
        h.explicitDeny = { allowed: false };
        const r = await checkRequestPermission(KEY, PUBKEY, 'sign_event', signEvent(1));
        expect(r.permitted).toBe(false);
    });

    it('lets an explicit allow condition override a paranoid trust level', async () => {
        h.keyUser = activeUser('paranoid');
        h.condition = { allowed: true };
        const r = await checkRequestPermission(KEY, PUBKEY, 'nip04_decrypt');
        expect(r.permitted).toBe(true);
        expect(r.approvalType).toBe('auto_permission');
    });

    it('honors an explicit per-method deny even at full trust', async () => {
        h.keyUser = activeUser('full');
        h.condition = { allowed: false };
        const r = await checkRequestPermission(KEY, PUBKEY, 'sign_event', signEvent(1));
        expect(r.permitted).toBe(false);
    });

    describe('trust-level auto-approval (no explicit conditions)', () => {
        it('full trust auto-approves any sign_event', async () => {
            h.keyUser = activeUser('full');
            const r = await checkRequestPermission(KEY, PUBKEY, 'sign_event', signEvent(9999));
            expect(r.permitted).toBe(true);
            expect(r.approvalType).toBe('auto_trust');
        });

        it('paranoid trust never auto-approves (routes to manual)', async () => {
            h.keyUser = activeUser('paranoid');
            const r = await checkRequestPermission(KEY, PUBKEY, 'sign_event', signEvent(1));
            expect(r.permitted).toBeUndefined();
        });

        it('reasonable trust auto-approves a safe-kind sign_event', async () => {
            h.keyUser = activeUser('reasonable');
            const r = await checkRequestPermission(KEY, PUBKEY, 'sign_event', signEvent(1)); // kind 1 = safe
            expect(r.permitted).toBe(true);
            expect(r.approvalType).toBe('auto_trust');
        });

        it('reasonable trust routes a sensitive-kind sign_event to manual', async () => {
            h.keyUser = activeUser('reasonable');
            const r = await checkRequestPermission(KEY, PUBKEY, 'sign_event', signEvent(4)); // kind 4 = DM
            expect(r.permitted).toBeUndefined();
        });

        it('reasonable trust routes nip04_decrypt to manual', async () => {
            h.keyUser = activeUser('reasonable');
            const r = await checkRequestPermission(KEY, PUBKEY, 'nip04_decrypt');
            expect(r.permitted).toBeUndefined();
        });

        it('reasonable trust auto-approves nip44_decrypt', async () => {
            h.keyUser = activeUser('reasonable');
            const r = await checkRequestPermission(KEY, PUBKEY, 'nip44_decrypt');
            expect(r.permitted).toBe(true);
            expect(r.approvalType).toBe('auto_trust');
        });
    });
});

describe('updateTrustLevel (trust-level reconciliation)', () => {
    const ID = 42;

    beforeEach(() => {
        vi.clearAllMocks();
        clearAclCache();
        h.condition = null;
        h.prisma.keyUser.update.mockResolvedValue({ keyName: 'k', userPubkey: 'pk' });
        h.prisma.signingCondition.findFirst.mockImplementation(async () => h.condition);
        h.prisma.signingCondition.deleteMany.mockResolvedValue({ count: 0 });
        h.prisma.signingCondition.createMany.mockResolvedValue({ count: 0 });
        h.prisma.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(h.prisma));
    });

    const deleteWheres = (): Array<Record<string, unknown>> =>
        h.prisma.signingCondition.deleteMany.mock.calls.map(
            (c: unknown[]) => (c[0] as { where: Record<string, unknown> }).where,
        );

    it('runs inside a transaction and updates the trust level', async () => {
        await updateTrustLevel(ID, 'reasonable');
        expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(h.prisma.keyUser.update).toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: ID }, data: { trustLevel: 'reasonable' } }),
        );
    });

    it('downgrade to paranoid removes the full-trust sign_event AND nip04/44 conditions', async () => {
        await updateTrustLevel(ID, 'paranoid');
        const wheres = deleteWheres();
        // The full-trust sign_event/kind:'all' grant is removed...
        expect(wheres).toContainEqual(
            expect.objectContaining({ keyUserId: ID, method: 'sign_event', kind: 'all', allowed: true }),
        );
        // ...and the NIP-04/44 encrypt/decrypt grants are removed (method: { in: [...] }).
        const hasInClause = wheres.some(
            (w) => typeof w.method === 'object' && Array.isArray((w.method as { in?: unknown[] }).in)
                && (w.method as { in: string[] }).in.includes('nip04_decrypt'),
        );
        expect(hasInClause).toBe(true);
        expect(h.prisma.signingCondition.createMany).not.toHaveBeenCalled();
    });

    it('downgrade to reasonable removes only the full-trust sign_event condition', async () => {
        await updateTrustLevel(ID, 'reasonable');
        const wheres = deleteWheres();
        expect(wheres).toContainEqual(
            expect.objectContaining({ keyUserId: ID, method: 'sign_event', kind: 'all', allowed: true }),
        );
        // The NIP-04/44 bulk-delete is paranoid-only and must NOT run here.
        expect(wheres.some((w) => typeof w.method === 'object')).toBe(false);
        expect(h.prisma.signingCondition.createMany).not.toHaveBeenCalled();
    });

    it('upgrade to full grants the encrypt/sign conditions when absent', async () => {
        h.condition = null; // existingEncrypt lookup finds nothing
        await updateTrustLevel(ID, 'full');
        expect(h.prisma.signingCondition.createMany).toHaveBeenCalledTimes(1);
        const data = h.prisma.signingCondition.createMany.mock.calls[0][0].data as Array<Record<string, unknown>>;
        expect(data).toContainEqual(expect.objectContaining({ method: 'sign_event', kind: 'all', allowed: true }));
        expect(h.prisma.signingCondition.deleteMany).not.toHaveBeenCalled();
    });

    it('upgrade to full is idempotent when the grants already exist', async () => {
        h.condition = { allowed: true }; // existingEncrypt found
        await updateTrustLevel(ID, 'full');
        expect(h.prisma.signingCondition.createMany).not.toHaveBeenCalled();
    });
});
