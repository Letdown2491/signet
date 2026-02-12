import prisma from '../../db.js';
import type { Prisma } from '@prisma/client';
import type { ApprovalType } from '../lib/acl.js';

export type RequestStatus = 'all' | 'pending' | 'approved' | 'denied' | 'expired';

export interface RequestQueryOptions {
    status: RequestStatus;
    limit: number;
    offset: number;
}

export interface RequestRecord {
    id: string;
    keyName: string | null;
    method: string;
    remotePubkey: string;
    params: string | null;
    allowed: boolean | null;
    createdAt: Date;
    processedAt: Date | null;
    autoApproved: boolean;
    approvalType: string | null;
    keyUserId: number | null;
    KeyUser?: {
        keyName: string;
        userPubkey: string;
        description: string | null;
    } | null;
}

export class RequestRepository {
    private readonly REQUEST_TTL_MS = 60_000;

    async findById(id: string): Promise<RequestRecord | null> {
        return prisma.request.findUnique({
            where: { id },
            include: { KeyUser: true },
        });
    }

    async findPending(id: string): Promise<RequestRecord | null> {
        const record = await prisma.request.findUnique({
            where: { id },
            include: { KeyUser: true },
        });
        if (!record || record.allowed !== null) {
            return null;
        }
        return record;
    }

    async findMany(options: RequestQueryOptions): Promise<RequestRecord[]> {
        const now = new Date();
        const expiryThreshold = new Date(now.getTime() - this.REQUEST_TTL_MS);

        let where: Prisma.RequestWhereInput;
        switch (options.status) {
            case 'pending':
                where = {
                    allowed: null,
                    createdAt: { gte: expiryThreshold },
                };
                break;
            case 'approved':
                where = { allowed: true };
                break;
            case 'denied':
                where = { allowed: false };
                break;
            case 'expired':
                where = {
                    allowed: null,
                    createdAt: { lt: expiryThreshold },
                };
                break;
            case 'all':
            default:
                // All processed requests (approved, denied, or expired) - excluding pending
                where = {
                    OR: [
                        { allowed: true },
                        { allowed: false },
                        { allowed: null, createdAt: { lt: expiryThreshold } },
                    ],
                };
                break;
        }

        return prisma.request.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            skip: options.offset,
            take: options.limit,
            include: { KeyUser: true },
        });
    }

    async countPending(): Promise<number> {
        const expiryThreshold = new Date(Date.now() - this.REQUEST_TTL_MS);
        return prisma.request.count({
            where: {
                allowed: null,
                createdAt: { gte: expiryThreshold },
            },
        });
    }

    async approve(id: string, approvalType?: ApprovalType): Promise<void> {
        await prisma.request.update({
            where: { id },
            data: {
                allowed: true,
                processedAt: new Date(),
                approvalType: approvalType ?? 'manual',
            },
        });
    }

    async deny(id: string): Promise<void> {
        await prisma.request.update({
            where: { id },
            data: {
                allowed: false,
                processedAt: new Date(),
            },
        });
    }

    async create(data: {
        id: string;
        requestId: string;
        keyName: string;
        method: string;
        remotePubkey: string;
        params?: string;
        keyUserId?: number;
    }): Promise<RequestRecord> {
        return prisma.request.create({
            data,
            include: { KeyUser: true },
        });
    }

    async createAutoApproved(data: {
        requestId: string;
        keyName: string;
        method: string;
        remotePubkey: string;
        params?: string;
        keyUserId?: number;
        approvalType?: ApprovalType;
    }): Promise<RequestRecord> {
        return prisma.request.create({
            data: {
                ...data,
                allowed: true,
                autoApproved: true,
                approvalType: data.approvalType,
                processedAt: new Date(),
            },
            include: { KeyUser: true },
        });
    }

    async cleanupExpired(maxAge: Date): Promise<number> {
        const result = await prisma.request.deleteMany({
            where: {
                allowed: null,
                createdAt: { lt: maxAge },
            },
        });
        return result.count;
    }

    /**
     * Look up keyUserId for a given keyName and remotePubkey.
     * Used to link requests to their KeyUser (app).
     */
    async findKeyUserId(keyName: string, remotePubkey: string): Promise<number | null> {
        const keyUser = await prisma.keyUser.findUnique({
            where: {
                unique_key_user: { keyName, userPubkey: remotePubkey },
            },
            select: { id: true },
        });
        return keyUser?.id ?? null;
    }
}

export const requestRepository = new RequestRepository();
