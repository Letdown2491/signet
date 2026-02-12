import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AppService } from '../../services/index.js';
import { emitCurrentStats, getEventService } from '../../services/index.js';
import type { TrustLevel } from '@signet/types';
import type { PreHandlerAuthCsrf } from '../types.js';
import { sendError } from '../../lib/route-errors.js';
import { adminLogRepository } from '../../repositories/admin-log-repository.js';
import { getClientInfo } from '../../lib/client-info.js';

export interface AppsRouteConfig {
    appService: AppService;
}

export function registerAppsRoutes(
    fastify: FastifyInstance,
    config: AppsRouteConfig,
    preHandler: PreHandlerAuthCsrf
): void {
    // List all connected apps (GET - no CSRF needed)
    fastify.get('/apps', { preHandler: preHandler.auth }, async (_request: FastifyRequest, reply: FastifyReply) => {
        const apps = await config.appService.listApps();
        return reply.send({ apps });
    });

    // Revoke app access (POST - needs CSRF)
    fastify.post('/apps/:id/revoke', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const params = request.params as { id: string };
        const appId = Number(params.id);

        if (!Number.isFinite(appId)) {
            return reply.code(400).send({ error: 'Invalid app ID' });
        }

        try {
            await config.appService.revokeApp(appId);

            // Emit stats update (app count changed)
            await emitCurrentStats();

            return reply.send({ ok: true });
        } catch (error) {
            return sendError(reply, error);
        }
    });

    // Update app (description and/or trust level) (PATCH - needs CSRF)
    fastify.patch('/apps/:id', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const params = request.params as { id: string };
        const appId = Number(params.id);

        if (!Number.isFinite(appId)) {
            return reply.code(400).send({ error: 'Invalid app ID' });
        }

        const body = request.body as { description?: string; trustLevel?: TrustLevel };
        const description = body?.description?.trim();
        const trustLevel = body?.trustLevel;

        if (!description && !trustLevel) {
            return reply.code(400).send({ error: 'Nothing to update' });
        }

        try {
            if (description) {
                await config.appService.updateDescription(appId, description);
            }
            if (trustLevel) {
                await config.appService.updateTrustLevel(appId, trustLevel);
            }
            return reply.send({ ok: true });
        } catch (error) {
            return sendError(reply, error);
        }
    });

    // Suspend an app (POST - needs CSRF)
    fastify.post('/apps/:id/suspend', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const params = request.params as { id: string };
        const appId = Number(params.id);

        if (!Number.isFinite(appId)) {
            return reply.code(400).send({ error: 'Invalid app ID' });
        }

        const body = request.body as { until?: string } | undefined;
        let until: Date | undefined;

        if (body?.until) {
            const parsed = new Date(body.until);
            if (isNaN(parsed.getTime())) {
                return reply.code(400).send({ error: 'Invalid date format for "until"' });
            }
            if (parsed.getTime() <= Date.now()) {
                return reply.code(400).send({ error: '"until" must be in the future' });
            }
            until = parsed;
        }

        try {
            // Get app info before suspending for logging
            const apps = await config.appService.listApps();
            const app = apps.find(a => a.id === appId);

            await config.appService.suspendApp(appId, until);

            // Log admin event
            const clientInfo = getClientInfo(request);
            const adminLog = await adminLogRepository.create({
                eventType: 'app_suspended',
                appId,
                appName: app?.description || app?.userPubkey.slice(0, 12),
                ...clientInfo,
            });

            // Emit admin event for real-time updates
            getEventService().emitAdminEvent(adminLogRepository.toActivityEntry(adminLog));

            return reply.send({ ok: true });
        } catch (error) {
            return sendError(reply, error);
        }
    });

    // Suspend all active apps (POST - needs CSRF)
    fastify.post('/apps/suspend-all', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { until?: string } | undefined;
        let until: Date | undefined;

        if (body?.until) {
            const parsed = new Date(body.until);
            if (isNaN(parsed.getTime())) {
                return reply.code(400).send({ error: 'Invalid date format for "until"' });
            }
            if (parsed.getTime() <= Date.now()) {
                return reply.code(400).send({ error: '"until" must be in the future' });
            }
            until = parsed;
        }

        try {
            const suspendedCount = await config.appService.suspendAllApps(until);

            // Emit stats update
            await emitCurrentStats();

            return reply.send({ ok: true, suspendedCount });
        } catch (error) {
            return sendError(reply, error);
        }
    });

    // Resume all suspended apps (POST - needs CSRF)
    fastify.post('/apps/resume-all', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        try {
            const resumedCount = await config.appService.unsuspendAllApps();

            // Emit stats update
            await emitCurrentStats();

            return reply.send({ ok: true, resumedCount });
        } catch (error) {
            return sendError(reply, error);
        }
    });

    // Unsuspend an app (POST - needs CSRF)
    fastify.post('/apps/:id/unsuspend', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const params = request.params as { id: string };
        const appId = Number(params.id);

        if (!Number.isFinite(appId)) {
            return reply.code(400).send({ error: 'Invalid app ID' });
        }

        try {
            // Get app info before unsuspending for logging
            const apps = await config.appService.listApps();
            const app = apps.find(a => a.id === appId);

            await config.appService.unsuspendApp(appId);

            // Log admin event
            const clientInfo = getClientInfo(request);
            const adminLog = await adminLogRepository.create({
                eventType: 'app_unsuspended',
                appId,
                appName: app?.description || app?.userPubkey.slice(0, 12),
                ...clientInfo,
            });

            // Emit admin event for real-time updates
            getEventService().emitAdminEvent(adminLogRepository.toActivityEntry(adminLog));

            return reply.send({ ok: true });
        } catch (error) {
            return sendError(reply, error);
        }
    });
}
