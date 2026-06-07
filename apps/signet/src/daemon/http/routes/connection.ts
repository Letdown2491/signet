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
    updateRelays?: (relays: string[]) => Promise<RelayStatusResponse>;
}

const MAX_RELAYS = 20;

/** Normalize a relay URL for comparison (trim, drop trailing slash, lowercase). */
function normalizeRelay(url: string): string {
    return url.trim().replace(/\/+$/, '').toLowerCase();
}

/** Validate that a string is a ws:// or wss:// relay URL. */
function isValidRelayUrl(url: string): boolean {
    const trimmed = url.trim();
    if (!/^wss?:\/\/.+/i.test(trimmed)) {
        return false;
    }
    try {
        new URL(trimmed);
        return true;
    } catch {
        return false;
    }
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
     * Add a relay to the configured set.
     * POST /relays { url }
     */
    fastify.post<{ Body: { url?: string } }>('/relays', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest<{ Body: { url?: string } }>, reply: FastifyReply) => {
        if (!config.updateRelays) {
            return reply.code(503).send({ error: 'Relay management unavailable' });
        }

        const url = request.body?.url;
        if (!url || !isValidRelayUrl(url)) {
            return reply.code(400).send({ error: 'A valid wss:// or ws:// relay URL is required' });
        }

        const normalized = url.trim().replace(/\/+$/, '');
        const current = config.relayService.getStatus().map(s => s.url);

        if (current.some(r => normalizeRelay(r) === normalizeRelay(normalized))) {
            return reply.code(409).send({ error: 'Relay already configured' });
        }
        if (current.length >= MAX_RELAYS) {
            return reply.code(400).send({ error: `Maximum of ${MAX_RELAYS} relays allowed` });
        }

        const status = await config.updateRelays([...current, normalized]);
        logger.info('Relay added', { url: normalized });
        return reply.send(status);
    });

    /**
     * Remove a relay from the configured set.
     * DELETE /relays { url }
     */
    fastify.delete<{ Body: { url?: string } }>('/relays', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest<{ Body: { url?: string } }>, reply: FastifyReply) => {
        if (!config.updateRelays) {
            return reply.code(503).send({ error: 'Relay management unavailable' });
        }

        const url = request.body?.url;
        if (!url) {
            return reply.code(400).send({ error: 'url is required' });
        }

        const current = config.relayService.getStatus().map(s => s.url);
        const remaining = current.filter(r => normalizeRelay(r) !== normalizeRelay(url));

        if (remaining.length === current.length) {
            return reply.code(404).send({ error: 'Relay not found' });
        }
        if (remaining.length === 0) {
            return reply.code(400).send({ error: 'Cannot remove the last relay' });
        }

        const status = await config.updateRelays(remaining);
        logger.info('Relay removed', { url });
        return reply.send(status);
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
