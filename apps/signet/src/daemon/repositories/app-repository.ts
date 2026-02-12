import prisma from '../../db.js';
import { invalidateAclCache, invalidateAclCacheForKey, clearAclCache } from '../lib/acl.js';

export interface AppRecord {
    id: number;
    keyName: string;
    userPubkey: string;
    description: string | null;
    trustLevel: string | null;
    createdAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
    suspendedAt: Date | null;
    suspendUntil: Date | null;
    signingConditions: Array<{
        id: number;
        method: string | null;
        kind: string | null;
        content: string | null;
        allowed: boolean | null;
        keyUserId: number | null;
        keyUserKeyName: string | null;
    }>;
}

export class AppRepository {
    async findAll(): Promise<AppRecord[]> {
        return prisma.keyUser.findMany({
            where: { revokedAt: null },
            include: { signingConditions: true },
            orderBy: { lastUsedAt: 'desc' },
        });
    }

    async findById(id: number): Promise<AppRecord | null> {
        return prisma.keyUser.findUnique({
            where: { id },
            include: { signingConditions: true },
        });
    }

    /**
     * Find a keyUser by id with signing conditions, for building ConnectedApp.
     * Returns null if not found or revoked.
     */
    async findByIdWithConditions(id: number): Promise<{
        id: number;
        keyName: string;
        userPubkey: string;
        description: string | null;
        trustLevel: string | null;
        createdAt: Date;
        lastUsedAt: Date | null;
        signingConditions: { method: string | null; kind: string | null; allowed: boolean | null }[];
    } | null> {
        return prisma.keyUser.findUnique({
            where: { id, revokedAt: null },
            include: { signingConditions: { select: { method: true, kind: true, allowed: true } } },
        });
    }

    async findByKeyAndPubkey(keyName: string, userPubkey: string): Promise<AppRecord | null> {
        return prisma.keyUser.findUnique({
            where: {
                unique_key_user: { keyName, userPubkey },
            },
            include: { signingConditions: true },
        });
    }

    async countActive(): Promise<number> {
        return prisma.keyUser.count({ where: { revokedAt: null } });
    }

    async revoke(id: number): Promise<void> {
        const keyUser = await prisma.keyUser.update({
            where: { id },
            data: { revokedAt: new Date() },
            select: { keyName: true, userPubkey: true },
        });
        invalidateAclCache(keyUser.keyName, keyUser.userPubkey);
    }

    async updateDescription(id: number, description: string): Promise<void> {
        await prisma.keyUser.update({
            where: { id },
            data: { description },
        });
    }

    async getRequestCount(keyUserId: number): Promise<number> {
        return prisma.log.count({ where: { keyUserId } });
    }

    /**
     * Get request counts for multiple keyUsers in a single query
     */
    async getRequestCountsBatch(keyUserIds: number[]): Promise<Map<number, number>> {
        if (keyUserIds.length === 0) {
            return new Map();
        }

        const counts = await prisma.log.groupBy({
            by: ['keyUserId'],
            where: { keyUserId: { in: keyUserIds } },
            _count: { keyUserId: true },
        });

        const result = new Map<number, number>();
        for (const id of keyUserIds) {
            result.set(id, 0);
        }
        for (const entry of counts) {
            if (entry.keyUserId !== null) {
                result.set(entry.keyUserId, entry._count.keyUserId);
            }
        }
        return result;
    }

    async getMethodBreakdown(keyUserId: number): Promise<Record<string, number>> {
        const logs = await prisma.log.groupBy({
            by: ['method'],
            where: { keyUserId },
            _count: { method: true },
        });

        const breakdown: Record<string, number> = {
            sign_event: 0,
            nip04_encrypt: 0,
            nip04_decrypt: 0,
            nip44_encrypt: 0,
            nip44_decrypt: 0,
            get_public_key: 0,
            other: 0,
        };

        for (const entry of logs) {
            const method = entry.method ?? 'other';
            if (method in breakdown) {
                breakdown[method] = entry._count.method;
            } else {
                breakdown.other += entry._count.method;
            }
        }

        return breakdown;
    }

    /**
     * Get method breakdowns for multiple keyUsers in a single query
     */
    async getMethodBreakdownsBatch(keyUserIds: number[]): Promise<Map<number, Record<string, number>>> {
        if (keyUserIds.length === 0) {
            return new Map();
        }

        const logs = await prisma.log.groupBy({
            by: ['keyUserId', 'method'],
            where: { keyUserId: { in: keyUserIds } },
            _count: { method: true },
        });

        const result = new Map<number, Record<string, number>>();

        // Initialize all with empty breakdown
        for (const id of keyUserIds) {
            result.set(id, {
                sign_event: 0,
                nip04_encrypt: 0,
                nip04_decrypt: 0,
                nip44_encrypt: 0,
                nip44_decrypt: 0,
                get_public_key: 0,
                other: 0,
            });
        }

        // Fill in actual counts
        for (const entry of logs) {
            if (entry.keyUserId === null) continue;

            const breakdown = result.get(entry.keyUserId);
            if (!breakdown) continue;

            const method = entry.method ?? 'other';
            if (method in breakdown) {
                breakdown[method] = entry._count.method;
            } else {
                breakdown.other += entry._count.method;
            }
        }

        return result;
    }

    async updateLastUsed(id: number): Promise<void> {
        await prisma.keyUser.update({
            where: { id },
            data: { lastUsedAt: new Date() },
        });
    }

    async revokeByKeyName(keyName: string): Promise<number> {
        const result = await prisma.keyUser.updateMany({
            where: { keyName, revokedAt: null },
            data: { revokedAt: new Date() },
        });
        // Invalidate all cache entries for this key
        invalidateAclCacheForKey(keyName);
        return result.count;
    }

    /**
     * Suspend an app, preventing all requests until unsuspended.
     * @param id - The app ID
     * @param until - Optional date when suspension should automatically end
     */
    async suspend(id: number, until?: Date): Promise<void> {
        const keyUser = await prisma.keyUser.update({
            where: { id },
            data: {
                suspendedAt: new Date(),
                suspendUntil: until ?? null,
            },
            select: { keyName: true, userPubkey: true },
        });
        invalidateAclCache(keyUser.keyName, keyUser.userPubkey);
    }

    /**
     * Unsuspend an app, allowing requests again.
     */
    async unsuspend(id: number): Promise<void> {
        const keyUser = await prisma.keyUser.update({
            where: { id },
            data: {
                suspendedAt: null,
                suspendUntil: null,
            },
            select: { keyName: true, userPubkey: true },
        });
        invalidateAclCache(keyUser.keyName, keyUser.userPubkey);
    }

    /**
     * Suspend all active (non-revoked, non-suspended) apps.
     * Used by the kill switch and bulk suspend.
     * @param until - Optional date when suspension should automatically end
     * Returns the count of apps that were suspended.
     */
    async suspendAll(until?: Date): Promise<number> {
        const result = await prisma.keyUser.updateMany({
            where: {
                revokedAt: null,
                suspendedAt: null,
            },
            data: {
                suspendedAt: new Date(),
                suspendUntil: until ?? null,
            },
        });
        // Clear entire ACL cache since we suspended many apps
        clearAclCache();
        return result.count;
    }

    /**
     * Unsuspend all suspended apps.
     * Used by bulk resume.
     * Returns the count of apps that were unsuspended.
     */
    async unsuspendAll(): Promise<number> {
        const result = await prisma.keyUser.updateMany({
            where: {
                revokedAt: null,
                suspendedAt: { not: null },
            },
            data: {
                suspendedAt: null,
                suspendUntil: null,
            },
        });
        // Clear entire ACL cache since we unsuspended many apps
        clearAclCache();
        return result.count;
    }
}

export const appRepository = new AppRepository();
