import type { FastifyRequest, FastifyReply } from 'fastify';
import createDebug from 'debug';
import prisma from '../../db.js';
import { permitAllRequests, grantPermissionsByTrustLevel, type TrustLevel } from '../lib/acl.js';
import type { AllowScope } from '../lib/acl.js';
import { sanitizeCallbackUrl } from '../lib/auth.js';
import { getEventService } from '../services/event-service.js';
import { appService, emitCurrentStats } from '../services/index.js';
import { VALID_TRUST_LEVELS } from '../constants.js';
import { extractEventKind } from '../lib/parse.js';
import { toErrorMessage, toSafeErrorHtml } from '../lib/errors.js';
import type { ActivityEntry } from '@signet/types';
import type { RequestWithId, ProcessRequestRequest } from '../http/types.js';

const debug = createDebug('signet:web');

async function loadPendingRequest(request: RequestWithId) {
    const record = await prisma.request.findUnique({
        where: { id: request.params.id },
    });

    if (!record || record.allowed !== null) {
        throw new Error('Request not found or already processed');
    }

    return record;
}

export async function authorizeRequestWebHandler(request: RequestWithId, reply: FastifyReply) {
    try {
        const record = await loadPendingRequest(request);

        // Safely parse the request URL
        let callbackUrl: string | undefined;
        try {
            const url = new URL(request.url, `http://${request.headers.host}`);
            const rawCallback = url.searchParams.get('callbackUrl');
            // Validate callback URL to prevent XSS (javascript:, data:, etc.)
            callbackUrl = sanitizeCallbackUrl(rawCallback) ?? undefined;
        } catch {
            // Invalid URL, proceed without callback
        }

        return reply.view('/templates/authorizeRequest.handlebar', {
            record,
            callbackUrl,
            authorised: true, // Always authorized - auth handled at route level
        });
    } catch (error) {
        debug('authorizeRequestWebHandler failed', error);
        return reply.view('/templates/error.handlebar', { error: toSafeErrorHtml(error) });
    }
}

export async function processRequestWebHandler(
    request: ProcessRequestRequest,
    reply: FastifyReply
) {
    try {
        const record = await loadPendingRequest(request);

        // Get trust level from request body (default to 'reasonable')
        const requestedTrustLevel = request.body.trustLevel;
        const trustLevel: TrustLevel = requestedTrustLevel && VALID_TRUST_LEVELS.includes(requestedTrustLevel as TrustLevel)
            ? (requestedTrustLevel as TrustLevel)
            : 'reasonable';

        // Get alwaysAllow flag from request body (default to false for one-time approval)
        const alwaysAllow = request.body.alwaysAllow === true;

        // Get allowKind for kind-specific permissions (optional)
        const allowKind = typeof request.body.allowKind === 'number' ? request.body.allowKind : undefined;

        // Get app name for connect requests (optional)
        const appName = typeof request.body.appName === 'string' ? request.body.appName.trim() : undefined;

        const processedAt = new Date();
        await prisma.request.update({
            where: { id: record.id },
            data: {
                allowed: true,
                processedAt,
                approvalType: 'manual',
            },
        });

        // For connect requests, use the new trust level system (only if keyName is present)
        if (record.keyName) {
            if (record.method === 'connect') {
                const appId = await grantPermissionsByTrustLevel(
                    record.remotePubkey,
                    record.keyName,
                    trustLevel,
                    appName || undefined
                );

                // Emit app:connected event for real-time updates
                const app = await appService.getAppById(appId);
                if (app) {
                    getEventService().emitAppConnected(app);
                }
            } else if (alwaysAllow) {
                // For non-connect requests with "always allow", grant the specific method for future requests
                // If allowKind is specified, only grant for that kind; otherwise grant for all kinds
                const scope: AllowScope = allowKind !== undefined ? { kind: allowKind } : { kind: 'all' };
                await permitAllRequests(record.remotePubkey, record.keyName, record.method, undefined, scope);
            }
            // If alwaysAllow is false, we only approve this single request (no SigningCondition created)
        }

        // Log the approved request
        let logId = 0;
        let loggedAppName: string | undefined;
        if (record.keyName && record.remotePubkey) {
            const keyUser = await prisma.keyUser.findUnique({
                where: {
                    unique_key_user: {
                        keyName: record.keyName,
                        userPubkey: record.remotePubkey,
                    },
                },
            });

            if (keyUser) {
                loggedAppName = keyUser.description ?? undefined;
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
            appName: appName || loggedAppName,
            autoApproved: false,
            approvalType: 'manual',
        };

        // Emit approval event for real-time updates
        getEventService().emitRequestApproved(record.id, activity);

        // Emit stats update (pending count and possibly app count changed)
        await emitCurrentStats();

        reply.type('application/json');
        return reply.send({ ok: true, trustLevel });
    } catch (error) {
        reply.status(400);
        reply.type('application/json');
        return reply.send({ ok: false, error: toErrorMessage(error) });
    }
}
