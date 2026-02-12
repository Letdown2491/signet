import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { LogLevel, LogsResponse } from '@signet/types';
import type { PreHandler } from '../types.js';
import { logBuffer } from '../../lib/log-buffer.js';

interface LogsQueryParams {
    level?: LogLevel;
    search?: string;
    limit?: string;
}

export function registerLogsRoutes(
    fastify: FastifyInstance,
    preHandler: PreHandler[]
): void {
    /**
     * GET /logs
     *
     * Get recent log entries from the in-memory buffer.
     * Supports filtering by level and search text.
     *
     * Query params:
     * - level: Minimum log level (debug, info, warn, error)
     * - search: Text to search for in messages (case-insensitive)
     * - limit: Maximum entries to return (default: 100, max: 1000)
     */
    fastify.get('/logs', { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
        const query = request.query as LogsQueryParams;

        // Validate level if provided
        const validLevels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
        if (query.level && !validLevels.includes(query.level)) {
            return reply.code(400).send({
                error: `Invalid level. Must be one of: ${validLevels.join(', ')}`,
            });
        }

        // Parse and validate limit
        let limit = 100;
        if (query.limit) {
            const parsed = parseInt(query.limit, 10);
            if (isNaN(parsed) || parsed < 1) {
                return reply.code(400).send({ error: 'limit must be a positive integer' });
            }
            limit = Math.min(parsed, 1000); // Cap at 1000
        }

        const logs = logBuffer.filter({
            level: query.level,
            search: query.search,
            limit,
        });

        const response: LogsResponse = { logs };
        return reply.send(response);
    });
}
