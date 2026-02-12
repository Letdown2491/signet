import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { RelayStatusResponse, RelayTrustScoreResponse } from '@signet/types';
import type { ConnectionManager } from '../../connection-manager.js';
import type { RelayService } from '../../services/index.js';
import type { NostrConfig } from '../../../config/types.js';
import type { PreHandlerAuthCsrf } from '../types.js';
import { logger } from '../../lib/logger.js';

export interface ConnectionRouteConfig {
    connectionManager: ConnectionManager;
    nostrConfig: NostrConfig;
    relayService: RelayService;
    getTrustScore?: (url: string) => number | null;
    getTrustScoresForRelays?: (urls: string[]) => Promise<Map<string, number | null>>;
}

export function registerConnectionRoutes(
    fastify: FastifyInstance,
    config: ConnectionRouteConfig,
    preHandler: PreHandlerAuthCsrf
): void {
    fastify.get('/connection', { preHandler: preHandler.auth }, async (_request: FastifyRequest, reply: FastifyReply) => {
        await config.connectionManager.waitUntilReady();
        const info = config.connectionManager.getConnectionInfo();

        if (!info) {
            return reply.code(503).send({ error: 'connection info unavailable' });
        }

        return reply.send({
            npub: info.npub,
            pubkey: info.pubkey,
            npubUri: info.npubUri,
            hexUri: info.hexUri,
            relays: info.relays,
            nostrRelays: config.nostrConfig.relays,
        });
    });

    fastify.get('/relays', { preHandler: preHandler.auth }, async (_request: FastifyRequest, reply: FastifyReply) => {
        const statuses = config.relayService.getStatus();
        const connected = config.relayService.getConnectedCount();

        const response: RelayStatusResponse = {
            connected,
            total: statuses.length,
            relays: statuses.map(s => ({
                url: s.url,
                connected: s.connected,
                lastConnected: s.lastConnected?.toISOString() ?? null,
                lastDisconnected: s.lastDisconnected?.toISOString() ?? null,
                trustScore: config.getTrustScore?.(s.url) ?? null,
            })),
        };

        return reply.send(response);
    });

    /**
     * Force reset relay connections.
     * Use when WebSocket connections are silently dead (e.g., after fail2ban/iptables changes).
     * POST /connections/refresh
     */
    fastify.post('/connections/refresh', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (_request: FastifyRequest, reply: FastifyReply) => {
        logger.info('Relay pool refresh requested via API');
        config.relayService.resetPool();
        return reply.send({ ok: true, message: 'Relay pool reset initiated' });
    });

    /**
     * Get trust scores for arbitrary relay URLs.
     * Used by NostrConnect modal to show scores for app-specified relays.
     * POST /relays/trust-scores
     */
    fastify.post<{ Body: { relays: string[] } }>('/relays/trust-scores', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest<{ Body: { relays: string[] } }>, reply: FastifyReply) => {
        const { relays } = request.body;

        if (!Array.isArray(relays) || relays.length === 0) {
            return reply.code(400).send({ error: 'relays array is required' });
        }

        // Limit to 10 relays to prevent abuse
        if (relays.length > 10) {
            return reply.code(400).send({ error: 'Maximum 10 relays allowed' });
        }

        if (!config.getTrustScoresForRelays) {
            // Service not available, return empty scores
            const scores: RelayTrustScoreResponse['scores'] = {};
            for (const url of relays) {
                scores[url] = null;
            }
            return reply.send({ scores });
        }

        const scoresMap = await config.getTrustScoresForRelays(relays);

        // Convert Map to object for JSON response
        const scores: RelayTrustScoreResponse['scores'] = {};
        for (const [url, score] of scoresMap) {
            scores[url] = score;
        }

        return reply.send({ scores });
    });
}
