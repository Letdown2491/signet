import type { ConnectedApp, TrustLevel, MethodBreakdown } from '@signet/types';
import { appRepository } from '../repositories/index.js';
import { updateTrustLevel as updateTrustLevelAcl } from '../lib/acl.js';
import { VALID_TRUST_LEVELS } from '../constants.js';
import { getEventService } from './event-service.js';
import { getNostrconnectService } from './nostrconnect-service.js';

export class AppService {
    /**
     * Build a ConnectedApp object from a keyUser record
     */
    private buildConnectedApp(
        keyUser: {
            id: number;
            keyName: string;
            userPubkey: string;
            description: string | null;
            trustLevel: string | null;
            createdAt: Date;
            lastUsedAt: Date | null;
            suspendedAt?: Date | null;
            suspendUntil?: Date | null;
            signingConditions: { method: string | null; kind: string | null; allowed: boolean | null }[];
        },
        requestCount: number,
        methodBreakdownRaw: Record<string, number>
    ): ConnectedApp {
        const permissions: string[] = [];
        for (const condition of keyUser.signingConditions) {
            if (condition.allowed && condition.method) {
                if (condition.method === 'connect') continue;
                if (condition.kind) {
                    permissions.push(`${condition.method} (kind ${condition.kind})`);
                } else {
                    permissions.push(condition.method);
                }
            }
        }

        const methodBreakdown: MethodBreakdown = {
            sign_event: methodBreakdownRaw.sign_event ?? 0,
            nip04_encrypt: methodBreakdownRaw.nip04_encrypt ?? 0,
            nip04_decrypt: methodBreakdownRaw.nip04_decrypt ?? 0,
            nip44_encrypt: methodBreakdownRaw.nip44_encrypt ?? 0,
            nip44_decrypt: methodBreakdownRaw.nip44_decrypt ?? 0,
            get_public_key: methodBreakdownRaw.get_public_key ?? 0,
            other: methodBreakdownRaw.other ?? 0,
        };

        return {
            id: keyUser.id,
            keyName: keyUser.keyName,
            userPubkey: keyUser.userPubkey,
            description: keyUser.description ?? undefined,
            trustLevel: (keyUser.trustLevel as TrustLevel) ?? 'reasonable',
            permissions: permissions.length > 0 ? permissions : ['All methods'],
            connectedAt: keyUser.createdAt.toISOString(),
            lastUsedAt: keyUser.lastUsedAt?.toISOString() ?? null,
            suspendedAt: keyUser.suspendedAt?.toISOString() ?? null,
            suspendUntil: keyUser.suspendUntil?.toISOString() ?? null,
            requestCount,
            methodBreakdown,
        };
    }

    async listApps(): Promise<ConnectedApp[]> {
        const keyUsers = await appRepository.findAll();

        if (keyUsers.length === 0) {
            return [];
        }

        // Batch fetch all request counts and method breakdowns in 2 queries instead of 2N
        const keyUserIds = keyUsers.map((ku) => ku.id);
        const [requestCounts, methodBreakdowns] = await Promise.all([
            appRepository.getRequestCountsBatch(keyUserIds),
            appRepository.getMethodBreakdownsBatch(keyUserIds),
        ]);

        return keyUsers.map((keyUser) => {
            const requestCount = requestCounts.get(keyUser.id) ?? 0;
            const methodBreakdownRaw = methodBreakdowns.get(keyUser.id) ?? {};
            return this.buildConnectedApp(keyUser, requestCount, methodBreakdownRaw);
        });
    }

    /**
     * Get a single app by id with full details
     */
    async getAppById(appId: number): Promise<ConnectedApp | null> {
        const keyUser = await appRepository.findByIdWithConditions(appId);
        if (!keyUser) {
            return null;
        }

        const [requestCounts, methodBreakdowns] = await Promise.all([
            appRepository.getRequestCountsBatch([appId]),
            appRepository.getMethodBreakdownsBatch([appId]),
        ]);

        return this.buildConnectedApp(
            keyUser,
            requestCounts.get(appId) ?? 0,
            methodBreakdowns.get(appId) ?? {}
        );
    }

    async revokeApp(appId: number): Promise<void> {
        const app = await appRepository.findById(appId);
        if (!app) {
            throw new Error('App not found');
        }

        await appRepository.revoke(appId);

        // Clean up per-app relay subscription (if any)
        try {
            const nostrconnectService = getNostrconnectService();
            nostrconnectService.notifyAppRevoked(app.keyName, appId);
        } catch {
            // NostrconnectService may not be initialized yet (e.g., during tests)
        }

        // Emit event for real-time updates
        getEventService().emitAppRevoked(appId);
    }

    async updateDescription(appId: number, description: string): Promise<void> {
        const app = await appRepository.findById(appId);
        if (!app) {
            throw new Error('App not found');
        }

        await appRepository.updateDescription(appId, description);

        // Emit event for real-time updates
        const updatedApp = await this.getAppById(appId);
        if (updatedApp) {
            getEventService().emitAppUpdated(updatedApp);
        }
    }

    async countActive(): Promise<number> {
        return appRepository.countActive();
    }

    async updateTrustLevel(appId: number, trustLevel: TrustLevel): Promise<void> {
        if (!VALID_TRUST_LEVELS.includes(trustLevel)) {
            throw new Error('Invalid trust level');
        }

        const app = await appRepository.findById(appId);
        if (!app) {
            throw new Error('App not found');
        }

        await updateTrustLevelAcl(appId, trustLevel);

        // Emit event for real-time updates
        const updatedApp = await this.getAppById(appId);
        if (updatedApp) {
            getEventService().emitAppUpdated(updatedApp);
        }
    }

    /**
     * Suspend an app, preventing all requests until unsuspended.
     * @param appId - The app ID
     * @param until - Optional date when suspension should automatically end
     */
    async suspendApp(appId: number, until?: Date): Promise<void> {
        const app = await appRepository.findById(appId);
        if (!app) {
            throw new Error('App not found');
        }
        if (app.suspendedAt) {
            throw new Error('App is already suspended');
        }

        await appRepository.suspend(appId, until);

        // Emit event for real-time updates
        const updatedApp = await this.getAppById(appId);
        if (updatedApp) {
            getEventService().emitAppUpdated(updatedApp);
        }
    }

    /**
     * Unsuspend an app, allowing requests again.
     */
    async unsuspendApp(appId: number): Promise<void> {
        const app = await appRepository.findById(appId);
        if (!app) {
            throw new Error('App not found');
        }
        if (!app.suspendedAt) {
            throw new Error('App is not suspended');
        }

        await appRepository.unsuspend(appId);

        // Emit event for real-time updates
        const updatedApp = await this.getAppById(appId);
        if (updatedApp) {
            getEventService().emitAppUpdated(updatedApp);
        }
    }

    /**
     * Suspend all active apps.
     * Used by the kill switch and bulk suspend.
     * @param until - Optional date when suspension should automatically end
     * Returns the count of apps that were suspended.
     */
    async suspendAllApps(until?: Date): Promise<number> {
        const count = await appRepository.suspendAll(until);

        // Emit event for real-time updates
        // We emit a generic "apps updated" event since many apps changed
        getEventService().emitAppsUpdated();

        return count;
    }

    /**
     * Unsuspend all suspended apps.
     * Used by bulk resume.
     * Returns the count of apps that were unsuspended.
     */
    async unsuspendAllApps(): Promise<number> {
        const count = await appRepository.unsuspendAll();

        // Emit event for real-time updates
        getEventService().emitAppsUpdated();

        return count;
    }
}

export const appService = new AppService();
