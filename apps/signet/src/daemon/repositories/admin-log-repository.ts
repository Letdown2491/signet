import prisma from '../../db.js';

export type AdminEventType =
    | 'key_locked'
    | 'key_unlocked'
    | 'key_encrypted'
    | 'key_migrated'
    | 'key_exported'
    | 'auth_failed'
    | 'app_connected'
    | 'app_suspended'
    | 'app_unsuspended'
    | 'daemon_started'
    | 'status_checked'
    | 'command_executed'
    | 'panic_triggered'
    | 'deadman_reset';

export interface AdminLogEntry {
    id: number;
    timestamp: Date;
    eventType: string;
    keyName: string | null;
    appId: number | null;
    appName: string | null;
    clientName: string | null;
    clientVersion: string | null;
    ipAddress: string | null;
    command: string | null;
    commandResult: string | null;
}

export interface AdminActivityEntry {
    id: number;
    timestamp: string;
    category: 'admin';
    eventType: AdminEventType;
    keyName?: string;
    appId?: number;
    appName?: string;
    clientName?: string;
    clientVersion?: string;
    ipAddress?: string;
    command?: string;
    commandResult?: string;
}

export interface ClientInfo {
    clientName?: string;
    clientVersion?: string;
    ipAddress?: string;
}

export class AdminLogRepository {
    async create(data: {
        eventType: AdminEventType;
        keyName?: string;
        appId?: number;
        appName?: string;
        clientName?: string;
        clientVersion?: string;
        ipAddress?: string;
        command?: string;
        commandResult?: string;
    }): Promise<AdminLogEntry> {
        return prisma.adminLog.create({
            data: {
                timestamp: new Date(),
                eventType: data.eventType,
                keyName: data.keyName,
                appId: data.appId,
                appName: data.appName,
                clientName: data.clientName,
                clientVersion: data.clientVersion,
                ipAddress: data.ipAddress,
                command: data.command,
                commandResult: data.commandResult,
            },
        });
    }

    async findRecent(limit: number): Promise<AdminLogEntry[]> {
        return prisma.adminLog.findMany({
            take: limit,
            orderBy: { timestamp: 'desc' },
        });
    }

    async findAll(options: {
        limit?: number;
        offset?: number;
    } = {}): Promise<AdminLogEntry[]> {
        return prisma.adminLog.findMany({
            take: options.limit ?? 50,
            skip: options.offset ?? 0,
            orderBy: { timestamp: 'desc' },
        });
    }

    async countSince(since: Date): Promise<number> {
        return prisma.adminLog.count({
            where: { timestamp: { gte: since } },
        });
    }

    async cleanupExpired(maxAge: Date): Promise<number> {
        const result = await prisma.adminLog.deleteMany({
            where: { timestamp: { lt: maxAge } },
        });
        return result.count;
    }

    toActivityEntry(log: AdminLogEntry): AdminActivityEntry {
        return {
            id: log.id,
            timestamp: log.timestamp.toISOString(),
            category: 'admin',
            eventType: log.eventType as AdminEventType,
            keyName: log.keyName ?? undefined,
            appId: log.appId ?? undefined,
            appName: log.appName ?? undefined,
            clientName: log.clientName ?? undefined,
            clientVersion: log.clientVersion ?? undefined,
            ipAddress: log.ipAddress ?? undefined,
            command: log.command ?? undefined,
            commandResult: log.commandResult ?? undefined,
        };
    }
}

export const adminLogRepository = new AdminLogRepository();
