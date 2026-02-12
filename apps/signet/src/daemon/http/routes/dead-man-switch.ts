import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDeadManSwitchService } from '../../services/index.js';
import type { PreHandlerAuthCsrf } from '../types.js';
import { sendError } from '../../lib/route-errors.js';
import { toErrorMessage } from '../../lib/errors.js';

export function registerDeadManSwitchRoutes(
    fastify: FastifyInstance,
    preHandler: PreHandlerAuthCsrf
): void {
    // Get status (GET - no CSRF needed)
    fastify.get('/dead-man-switch', { preHandler: preHandler.auth }, async (_request: FastifyRequest, reply: FastifyReply) => {
        try {
            const service = getDeadManSwitchService();
            const status = await service.getStatus();
            const remainingAttempts = service.getRemainingAttempts();
            return reply.send({ ...status, remainingAttempts });
        } catch (error) {
            return sendError(reply, error);
        }
    });

    // Update settings (PUT - needs CSRF)
    // Can enable, disable, or change timeframe
    fastify.put('/dead-man-switch', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as {
            enabled?: boolean;
            timeframeSec?: number;
            keyName?: string;
            passphrase?: string;
        };

        try {
            const service = getDeadManSwitchService();
            const currentStatus = await service.getStatus();

            // Handle enable
            if (body.enabled === true && !currentStatus.enabled) {
                await service.enable(body.timeframeSec);
                const status = await service.getStatus();
                return reply.send({ ok: true, status });
            }

            // Handle disable (requires passphrase)
            if (body.enabled === false && currentStatus.enabled) {
                if (!body.keyName || !body.passphrase) {
                    return reply.code(400).send({
                        error: 'keyName and passphrase required to disable',
                        remainingAttempts: service.getRemainingAttempts(),
                    });
                }
                await service.disable(body.keyName, body.passphrase);
                const status = await service.getStatus();
                return reply.send({ ok: true, status });
            }

            // Handle timeframe change (requires passphrase)
            if (body.timeframeSec !== undefined && body.timeframeSec !== currentStatus.timeframeSec) {
                if (!body.keyName || !body.passphrase) {
                    return reply.code(400).send({
                        error: 'keyName and passphrase required to change timeframe',
                        remainingAttempts: service.getRemainingAttempts(),
                    });
                }
                await service.updateTimeframe(body.keyName, body.passphrase, body.timeframeSec);
                const status = await service.getStatus();
                return reply.send({ ok: true, status });
            }

            // No changes
            const status = await service.getStatus();
            return reply.send({ ok: true, status });
        } catch (error) {
            const service = getDeadManSwitchService();
            const message = toErrorMessage(error);

            // Include remaining attempts in error response for passphrase failures
            if (message.includes('attempts remaining') || message.includes('Too many failed')) {
                return reply.code(400).send({
                    error: message,
                    remainingAttempts: service.getRemainingAttempts(),
                });
            }

            return sendError(reply, error);
        }
    });

    // Reset timer (POST - needs CSRF, requires passphrase)
    fastify.post('/dead-man-switch/reset', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { keyName?: string; passphrase?: string };

        if (!body.keyName || !body.passphrase) {
            const service = getDeadManSwitchService();
            return reply.code(400).send({
                error: 'keyName and passphrase are required',
                remainingAttempts: service.getRemainingAttempts(),
            });
        }

        try {
            const service = getDeadManSwitchService();
            const status = await service.reset(body.keyName, body.passphrase);
            return reply.send({ ok: true, status });
        } catch (error) {
            const service = getDeadManSwitchService();
            const message = toErrorMessage(error);

            if (message.includes('attempts remaining') || message.includes('Too many failed')) {
                return reply.code(400).send({
                    error: message,
                    remainingAttempts: service.getRemainingAttempts(),
                });
            }

            return sendError(reply, error);
        }
    });

    // Test panic (POST - needs CSRF, requires passphrase)
    // For testing the panic functionality without waiting for the timer
    fastify.post('/dead-man-switch/test-panic', { preHandler: [...preHandler.auth, ...preHandler.csrf] }, async (request: FastifyRequest, reply: FastifyReply) => {
        const body = request.body as { keyName?: string; passphrase?: string };

        if (!body.keyName || !body.passphrase) {
            const service = getDeadManSwitchService();
            return reply.code(400).send({
                error: 'keyName and passphrase are required',
                remainingAttempts: service.getRemainingAttempts(),
            });
        }

        try {
            const service = getDeadManSwitchService();
            await service.testPanic(body.keyName, body.passphrase);
            const status = await service.getStatus();
            return reply.send({ ok: true, status });
        } catch (error) {
            const service = getDeadManSwitchService();
            const message = toErrorMessage(error);

            if (message.includes('attempts remaining') || message.includes('Too many failed')) {
                return reply.code(400).send({
                    error: message,
                    remainingAttempts: service.getRemainingAttempts(),
                });
            }

            return sendError(reply, error);
        }
    });
}
