import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { PreHandlerAuthCsrf } from '../types.js';
import type { TrustLevel } from '@signet/types';
import { sendError } from '../../lib/route-errors.js';
import prisma from '../../../db.js';
import { parseNostrconnectUri } from '../../lib/nostrconnect.js';
import { invalidateAclCache } from '../../lib/acl.js';
import { emitCurrentStats, getEventService, getNostrconnectService } from '../../services/index.js';
import type { AppService } from '../../services/index.js';
import { adminLogRepository } from '../../repositories/admin-log-repository.js';
import { getClientInfo } from '../../lib/client-info.js';
import { validateUri, validateAppName, validateRelays, sanitizeString } from '../../lib/validation.js';
import { logger } from '../../lib/logger.js';

interface NostrconnectRequest {
    uri: string;
    keyName: string;
    trustLevel: TrustLevel;
    description?: string;
}

export interface NostrconnectRouteConfig {
    appService: AppService;
}

export function registerNostrconnectRoutes(
    fastify: FastifyInstance,
    config: NostrconnectRouteConfig,
    preHandler: PreHandlerAuthCsrf
): void {
    /**
     * POST /nostrconnect
     *
     * Connect to an app via nostrconnect:// URI.
     * Creates a KeyUser with the app's relays and grants the selected permissions.
     */
    fastify.post('/nostrconnect', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as NostrconnectRequest;

        // Validate required fields
        const uriResult = validateUri(body.uri);
        if (!uriResult.valid) {
            return reply.code(400).send({ error: uriResult.error });
        }
        if (!body.keyName) {
            return reply.code(400).send({ error: 'keyName is required' });
        }
        if (!body.trustLevel || !['paranoid', 'reasonable', 'full'].includes(body.trustLevel)) {
            return reply.code(400).send({ error: 'trustLevel must be paranoid, reasonable, or full' });
        }

        // Validate optional app name
        const appNameResult = validateAppName(body.description);
        if (!appNameResult.valid) {
            return reply.code(400).send({ error: appNameResult.error });
        }

        // Parse the nostrconnect URI
        const parseResult = parseNostrconnectUri(body.uri);
        if (!parseResult.success) {
            return reply.code(400).send({
                error: parseResult.error.message,
                errorType: parseResult.error.type,
            });
        }

        const { clientPubkey, relays, secret } = parseResult.data;

        // Validate relay count
        const relaysResult = validateRelays(relays);
        if (!relaysResult.valid) {
            return reply.code(400).send({ error: relaysResult.error });
        }

        // Sanitize the app name
        const sanitizedDescription = sanitizeString(body.description);

        try {
            // Check if already connected to this app
            const existing = await prisma.keyUser.findUnique({
                where: {
                    unique_key_user: {
                        keyName: body.keyName,
                        userPubkey: clientPubkey,
                    },
                },
            });

            if (existing && !existing.revokedAt) {
                return reply.code(409).send({
                    error: 'This app is already connected to this key',
                    errorType: 'already_connected',
                    existingAppId: existing.id,
                });
            }

            // Create or update KeyUser with nostrconnect relays and trust level
            const keyUser = await prisma.keyUser.upsert({
                where: {
                    unique_key_user: {
                        keyName: body.keyName,
                        userPubkey: clientPubkey,
                    },
                },
                update: {
                    revokedAt: null, // Un-revoke if previously revoked
                    suspendedAt: null,
                    suspendUntil: null,
                    description: sanitizedDescription || null,
                    nostrconnectRelays: JSON.stringify(relays),
                    trustLevel: body.trustLevel,
                },
                create: {
                    keyName: body.keyName,
                    userPubkey: clientPubkey,
                    description: sanitizedDescription || null,
                    nostrconnectRelays: JSON.stringify(relays),
                    trustLevel: body.trustLevel,
                },
            });

            // Invalidate ACL cache
            invalidateAclCache(body.keyName, clientPubkey);

            // Send connect response to the client on their relays
            const nostrconnectService = getNostrconnectService();
            const sendResult = await nostrconnectService.sendConnectResponse(
                body.keyName,
                clientPubkey,
                relays,
                secret
            );

            if (!sendResult.success) {
                // Connection was created but we failed to notify the client
                // This is not fatal - the client might retry or use our relays
                logger.warn('Failed to send nostrconnect response', { error: sendResult.error });
            }

            // Set up per-app relay subscription
            nostrconnectService.subscribeToClientRelays(body.keyName, keyUser.id, relays);

            // Emit app connected event
            const app = await config.appService.getAppById(keyUser.id);
            if (app) {
                getEventService().emitAppConnected(app);
            }

            // Log admin event for activity tracking
            const clientInfo = getClientInfo(request);
            const adminLog = await adminLogRepository.create({
                eventType: 'app_connected',
                keyName: body.keyName,
                appId: keyUser.id,
                appName: sanitizedDescription || parseResult.data.name || undefined,
                ...clientInfo,
            });
            getEventService().emitAdminEvent(adminLogRepository.toActivityEntry(adminLog));

            // Emit stats update
            await emitCurrentStats();

            return reply.send({
                ok: true,
                appId: keyUser.id,
                clientPubkey,
                relays,
                connectResponseSent: sendResult.success,
                connectResponseError: sendResult.error,
            });
        } catch (error) {
            return sendError(reply, error);
        }
    });
}
