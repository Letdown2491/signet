import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RequestService, AppService } from '../../services/index.js';
import { emitCurrentStats } from '../../services/index.js';
import type { TrustLevel, ActivityEntry } from '@signet/types';
import type { PreHandlerFull, RequestWithId, ProcessRequestRequest } from '../types.js';
import prisma from '../../../db.js';
import { grantPermissionsByTrustLevel, permitAllRequests, type AllowScope } from '../../lib/acl.js';
import { getEventService } from '../../services/event-service.js';
import { adminLogRepository } from '../../repositories/admin-log-repository.js';
import { extractEventKind } from '../../lib/parse.js';
import { toErrorMessage } from '../../lib/errors.js';
import {
    authorizeRequestWebHandler,
    processRequestWebHandler,
} from '../../web/authorize.js';

interface BatchApprovalBody {
    ids: string[];
    trustLevel?: TrustLevel;
    alwaysAllow?: boolean;
    allowKind?: number;
}

interface BatchResult {
    id: string;
    success: boolean;
    error?: string;
}

export interface RequestsRouteConfig {
    requestService: RequestService;
    appService: AppService;
}

export function registerRequestRoutes(
    fastify: FastifyInstance,
    config: RequestsRouteConfig,
    preHandler: PreHandlerFull
): void {
    // List requests (GET - no CSRF needed)
    fastify.get('/requests', { preHandler: preHandler.auth }, async (request: FastifyRequest, reply: FastifyReply) => {
        const query = (request.query ?? {}) as Record<string, string | undefined>;

        const limitParam = query.limit;
        const requestedLimit = limitParam ? Number.parseInt(limitParam, 10) : NaN;
        const limit = Number.isFinite(requestedLimit)
            ? Math.min(50, Math.max(1, requestedLimit))
            : 10;

        const offsetParam = query.offset;
        const requestedOffset = offsetParam ? Number.parseInt(offsetParam, 10) : NaN;
        const offset = Number.isFinite(requestedOffset) && requestedOffset >= 0
            ? requestedOffset
            : 0;

        const status = query.status || 'pending';

        // Handle admin filter specially - return admin activity logs only
        if (status === 'admin') {
            const adminLogs = await adminLogRepository.findAll({ limit, offset });
            const activity = adminLogs.map(log => adminLogRepository.toActivityEntry(log));
            return reply.send({ requests: activity });
        }

        // For 'all' filter, include both NIP-46 requests and admin events (unless excludeAdmin=true)
        if (status === 'all') {
            const excludeAdmin = query.excludeAdmin === 'true';

            if (excludeAdmin) {
                // Return only NIP-46 requests (for clients that handle admin separately)
                const requests = await config.requestService.listRequests({ status, limit, offset });
                return reply.send({ requests });
            }

            // Fetch both types
            const [requests, adminLogs] = await Promise.all([
                config.requestService.listRequests({ status, limit, offset }),
                adminLogRepository.findAll({ limit, offset }),
            ]);

            // Convert admin logs to activity entries
            const adminActivity = adminLogs.map(log => adminLogRepository.toActivityEntry(log));

            // Merge and sort by timestamp (newest first)
            const merged = [...requests, ...adminActivity].sort((a, b) => {
                const timeA = new Date('createdAt' in a ? a.createdAt : a.timestamp).getTime();
                const timeB = new Date('createdAt' in b ? b.createdAt : b.timestamp).getTime();
                return timeB - timeA;
            });

            // Apply limit after merge
            const limited = merged.slice(0, limit);

            return reply.send({ requests: limited });
        }

        const requests = await config.requestService.listRequests({ status, limit, offset });
        return reply.send({ requests });
    });

    // Web authorization page (HTML)
    fastify.get('/requests/:id', async (request: FastifyRequest, reply: FastifyReply) => {
        return authorizeRequestWebHandler(request as RequestWithId, reply);
    });

    // Process request approval (API)
    fastify.post('/requests/:id', { preHandler: preHandler.rateLimit }, async (request: FastifyRequest, reply: FastifyReply) => {
        return processRequestWebHandler(request as ProcessRequestRequest, reply);
    });

    // Deny request (DELETE - needs CSRF)
    fastify.delete('/requests/:id', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const { id } = request.params as { id: string };

        const record = await prisma.request.findUnique({ where: { id } });

        if (!record) {
            return reply.code(404).send({ error: 'Request not found' });
        }

        if (record.allowed !== null) {
            return reply.code(400).send({ error: 'Request already processed' });
        }

        await prisma.request.update({
            where: { id },
            data: {
                allowed: false,
                processedAt: new Date(),
            },
        });

        // Log the denial (no KeyUser created for denied apps)
        let logId = 0;
        if (record.keyName) {
            const log = await prisma.log.create({
                data: {
                    timestamp: new Date(),
                    type: 'denial',
                    method: record.method,
                    params: record.params,
                    keyName: record.keyName,
                    remotePubkey: record.remotePubkey,
                },
            });
            logId = log.id;
        }

        // Look up app name from KeyUser if the app was already connected
        let appName: string | undefined;
        if (record.keyName && record.remotePubkey) {
            const keyUser = await prisma.keyUser.findFirst({
                where: {
                    keyName: record.keyName,
                    userPubkey: record.remotePubkey,
                },
                select: { description: true },
            });
            appName = keyUser?.description ?? undefined;
        }

        // Build activity entry for SSE
        const activity: ActivityEntry = {
            id: logId,
            timestamp: new Date().toISOString(),
            type: 'denial',
            method: record.method ?? undefined,
            eventKind: record.method === 'sign_event' ? extractEventKind(record.params) : undefined,
            keyName: record.keyName ?? undefined,
            userPubkey: record.remotePubkey ?? undefined,
            appName,
            autoApproved: false,
            approvalType: undefined,
        };

        getEventService().emitRequestDenied(id, activity);

        // Emit stats update (pending count changed)
        await emitCurrentStats();

        return reply.send({ ok: true });
    });

    // Batch approval endpoint (POST - needs CSRF)
    fastify.post('/requests/batch', { preHandler: [...preHandler.rateLimit, ...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as BatchApprovalBody;

        if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
            return reply.code(400).send({ error: 'ids array is required' });
        }

        // Limit batch size to prevent abuse
        if (body.ids.length > 50) {
            return reply.code(400).send({ error: 'Maximum 50 requests per batch' });
        }

        const trustLevel: TrustLevel = body.trustLevel || 'reasonable';
        const alwaysAllow = body.alwaysAllow === true;
        const allowKind = typeof body.allowKind === 'number' ? body.allowKind : undefined;
        const eventService = getEventService();
        const results: BatchResult[] = [];

        for (const id of body.ids) {
            try {
                // Find the pending request
                const record = await prisma.request.findUnique({ where: { id } });

                if (!record) {
                    results.push({ id, success: false, error: 'Request not found' });
                    continue;
                }

                if (record.allowed !== null) {
                    results.push({ id, success: false, error: 'Request already processed' });
                    continue;
                }

                // Approve the request
                const processedAt = new Date();
                await prisma.request.update({
                    where: { id: record.id },
                    data: {
                        allowed: true,
                        processedAt,
                        approvalType: 'manual',
                    },
                });

                // Grant permissions based on request type (only if keyName is present)
                if (record.keyName) {
                    if (record.method === 'connect') {
                        const appId = await grantPermissionsByTrustLevel(
                            record.remotePubkey,
                            record.keyName,
                            trustLevel,
                            undefined
                        );

                        // Emit app:connected event
                        const app = await config.appService.getAppById(appId);
                        if (app) {
                            eventService.emitAppConnected(app);
                        }
                    } else if (alwaysAllow) {
                        // For non-connect requests with "always allow", grant the specific method
                        // If allowKind is specified, only grant for that kind; otherwise grant for all kinds
                        const scope: AllowScope = allowKind !== undefined ? { kind: allowKind } : { kind: 'all' };
                        await permitAllRequests(record.remotePubkey, record.keyName, record.method, undefined, scope);
                    }
                    // If alwaysAllow is false, we only approve this single request
                }

                // Log the approval - always create KeyUser if needed
                let logId = 0;
                let appName: string | undefined;
                if (record.keyName && record.remotePubkey) {
                    const keyUser = await prisma.keyUser.upsert({
                        where: {
                            unique_key_user: {
                                keyName: record.keyName,
                                userPubkey: record.remotePubkey,
                            },
                        },
                        update: { lastUsedAt: new Date() },
                        create: {
                            keyName: record.keyName,
                            userPubkey: record.remotePubkey,
                            // trustLevel defaults to "reasonable" in schema
                        },
                    });
                    appName = keyUser.description ?? undefined;

                    const log = await prisma.log.create({
                        data: {
                            timestamp: new Date(),
                            type: 'approval',
                            method: record.method,
                            params: record.params,
                            keyUserId: keyUser.id,
                            approvalType: 'manual',
                        },
                    });
                    logId = log.id;
                }

                // Build activity entry for SSE
                const activity: ActivityEntry = {
                    id: logId,
                    timestamp: processedAt.toISOString(),
                    type: 'approval',
                    method: record.method ?? undefined,
                    eventKind: record.method === 'sign_event' ? extractEventKind(record.params) : undefined,
                    keyName: record.keyName ?? undefined,
                    userPubkey: record.remotePubkey ?? undefined,
                    appName,
                    autoApproved: false,
                    approvalType: 'manual',
                };

                // Emit approval event
                eventService.emitRequestApproved(record.id, activity);

                results.push({ id, success: true });
            } catch (error) {
                results.push({ id, success: false, error: toErrorMessage(error) });
            }
        }

        const approved = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        // Emit stats update (pending count and possibly app count changed)
        if (approved > 0) {
            await emitCurrentStats();
        }

        return reply.send({ results, summary: { approved, failed } });
    });
}
