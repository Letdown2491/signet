import createDebug from 'debug';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { EventService, ServerEvent } from '../../services/event-service.js';
import type { PreHandlerAuth } from '../types.js';

const debug = createDebug('signet:sse');

export interface EventsRouteConfig {
    eventService: EventService;
}

/**
 * Register SSE (Server-Sent Events) routes for real-time updates
 */
export function registerEventsRoutes(
    fastify: FastifyInstance,
    config: EventsRouteConfig,
    preHandler: PreHandlerAuth
): void {
    /**
     * SSE endpoint for real-time events
     * GET /events
     *
     * Streams server-sent events to connected clients.
     * Sends keep-alive pings every 30 seconds.
     */
    fastify.get('/events', { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
        debug('SSE client connecting, current subscribers: %d', config.eventService.getSubscriberCount());

        // Set SSE headers
        reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no', // Disable nginx buffering
        });

        // Send initial connection event
        reply.raw.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

        // Event callback to send events to client
        const eventCallback = (event: ServerEvent) => {
            try {
                debug('Sending SSE event: %s', event.type);
                reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
            } catch (error) {
                debug('Error sending SSE event: %o', error);
            }
        };

        // Subscribe to events
        const unsubscribe = config.eventService.subscribe(eventCallback);
        debug('SSE client subscribed, total subscribers: %d', config.eventService.getSubscriberCount());

        // Keep-alive ping every 30 seconds
        // Send as actual data event so browser's onmessage fires and frontend heartbeat tracking works
        const keepAliveInterval = setInterval(() => {
            try {
                reply.raw.write(`data: ${JSON.stringify({ type: 'ping' })}\n\n`);
            } catch (error) {
                // Connection may be closed
            }
        }, 30000);

        // Named handlers for proper cleanup
        const onRequestClose = () => {
            debug('SSE client disconnected (close event)');
            cleanup();
        };

        const onRequestError = (error: Error) => {
            debug('SSE client error: %o', error);
            cleanup();
        };

        const onReplyClose = () => {
            debug('SSE response closed');
            cleanup();
        };

        // Cleanup function to ensure resources are freed
        let cleanedUp = false;
        const cleanup = () => {
            if (cleanedUp) return;
            cleanedUp = true;
            debug('SSE client cleanup triggered');
            clearInterval(keepAliveInterval);
            unsubscribe();
            // Remove event listeners to prevent memory leaks
            request.raw.off('close', onRequestClose);
            request.raw.off('error', onRequestError);
            reply.raw.off('close', onReplyClose);
            debug('Remaining subscribers: %d', config.eventService.getSubscriberCount());
        };

        // Cleanup on client disconnect
        request.raw.on('close', onRequestClose);

        // Cleanup on error
        request.raw.on('error', onRequestError);

        // Cleanup on socket end
        reply.raw.on('close', onReplyClose);

        // Don't return anything - keep the connection open
        await new Promise(() => {});
    });

    /**
     * Get current subscriber count (useful for debugging)
     * GET /events/status
     */
    fastify.get('/events/status', { preHandler }, async (_request: FastifyRequest, reply: FastifyReply) => {
        return reply.send({
            subscribers: config.eventService.getSubscriberCount(),
        });
    });
}
