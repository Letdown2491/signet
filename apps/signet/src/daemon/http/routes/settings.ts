import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { settingsRepository } from '../../repositories/settings-repository.js';
import { resolveBunkerTokenExpiryMinutes } from '../services/connection-token-service.js';
import type { PreHandlerAuthCsrf } from '../types.js';
import { sendError } from '../../lib/route-errors.js';

/**
 * Runtime-configurable daemon settings.
 *
 * Settings here persist in the `setting` table (via SettingsRepository), so they
 * survive restarts and can be changed from the UI without a config edit or image
 * rebuild — unlike the boot/environment settings (host/port, baseUrl, CORS,
 * relays) which intentionally stay in the container environment.
 */
export function registerSettingsRoutes(
    fastify: FastifyInstance,
    preHandler: PreHandlerAuthCsrf
): void {
    // One-time bunker token lifetime (GET - no CSRF)
    fastify.get(
        '/settings/bunker-token-expiry',
        { preHandler: preHandler.auth },
        async (_request: FastifyRequest, reply: FastifyReply) => {
            try {
                const minutes = await resolveBunkerTokenExpiryMinutes();
                return reply.send({ minutes });
            } catch (error) {
                return sendError(reply, error);
            }
        }
    );

    // One-time bunker token lifetime (PUT - needs CSRF)
    fastify.put(
        '/settings/bunker-token-expiry',
        { preHandler: [...preHandler.auth, ...preHandler.csrf] },
        async (request: FastifyRequest, reply: FastifyReply) => {
            const { minutes } = (request.body ?? {}) as { minutes?: unknown };
            const n = Number(minutes);
            if (!Number.isFinite(n) || n <= 0) {
                return reply.code(400).send({ error: 'minutes must be a positive number' });
            }

            try {
                const minutesInt = Math.round(n);
                await settingsRepository.set('bunkerTokenExpiryMinutes', String(minutesInt));
                return reply.send({ ok: true, minutes: minutesInt });
            } catch (error) {
                return sendError(reply, error);
            }
        }
    );
}