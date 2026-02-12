import Fastify, { type FastifyInstance } from 'fastify';
import FastifyFormBody from '@fastify/formbody';
import FastifyView from '@fastify/view';
import Handlebars from 'handlebars';
import {
    registerAuthPlugins,
    createAuthMiddleware,
    createRateLimitMiddleware,
    createCsrfMiddleware,
    generateCsrfToken,
    setCsrfCookie,
    isAllowedOrigin,
} from '../lib/auth.js';
import { logger } from '../lib/logger.js';
import { registerConnectionRoutes, type ConnectionRouteConfig } from './routes/connection.js';
import { registerRequestRoutes, type RequestsRouteConfig } from './routes/requests.js';
import { registerKeysRoutes, type KeysRouteConfig } from './routes/keys.js';
import { registerAppsRoutes, type AppsRouteConfig } from './routes/apps.js';
import { registerDashboardRoutes, type DashboardRouteConfig } from './routes/dashboard.js';
import { registerTokensRoutes } from './routes/tokens.js';
import { registerPoliciesRoutes } from './routes/policies.js';
import { registerEventsRoutes } from './routes/events.js';
import { registerNostrconnectRoutes } from './routes/nostrconnect.js';
import { registerDeadManSwitchRoutes } from './routes/dead-man-switch.js';
import { registerLogsRoutes } from './routes/logs.js';
import type { KeyService, RequestService, AppService, DashboardService, EventService, RelayService } from '../services/index.js';
import type { ConnectionManager } from '../connection-manager.js';
import type { NostrConfig } from '../../config/types.js';

export interface HealthStatus {
    status: 'ok' | 'degraded';
    uptime: number;
    memory: { heapMB: number; rssMB: number };
    relays: { connected: number; total: number };
    keys: { active: number; locked: number; offline: number };
    subscriptions: number;
    sseClients: number;
    lastPoolReset: string | null;
    caches?: Record<string, { size: number; hits: number; misses: number; evictions: number }>;
    logBuffer?: { entries: number; maxEntries: number; estimatedKB: number };
}

export interface HttpServerConfig {
    port: number;
    host: string;
    baseUrl?: string;
    jwtSecret?: string;
    allowedOrigins: string[];
    requireAuth: boolean;
    connectionManager: ConnectionManager;
    nostrConfig: NostrConfig;
    keyService: KeyService;
    requestService: RequestService;
    appService: AppService;
    dashboardService: DashboardService;
    eventService: EventService;
    relayService: RelayService;
    getHealthStatus?: () => HealthStatus;
    getTrustScore?: (url: string) => number | null;
    getTrustScoresForRelays?: (urls: string[]) => Promise<Map<string, number | null>>;
}

export class HttpServer {
    private readonly fastify: FastifyInstance;
    private readonly config: HttpServerConfig;

    constructor(config: HttpServerConfig) {
        this.config = config;
        this.fastify = Fastify({ logger: { level: 'warn' } });
    }

    getFastify(): FastifyInstance {
        return this.fastify;
    }

    async start(): Promise<void> {
        await this.setupMiddleware();
        await this.setupRoutes();
        await this.listen();
    }

    private async setupMiddleware(): Promise<void> {
        await this.fastify.register(FastifyFormBody);

        // Parse baseUrl safely
        let urlPrefix = '';
        if (this.config.baseUrl) {
            try {
                urlPrefix = new URL(this.config.baseUrl).pathname.replace(/\/+$/, '');
            } catch (error) {
                logger.warn('Invalid baseUrl in config', { baseUrl: this.config.baseUrl });
            }
        }

        // Register authentication plugins
        if (this.config.jwtSecret) {
            await registerAuthPlugins(this.fastify, this.config.jwtSecret);
        } else {
            logger.warn('No JWT secret configured - authentication will not work');
        }

        // CORS handling with origin validation
        const allowedOrigins = this.config.allowedOrigins;
        if (allowedOrigins.includes('*')) {
            logger.warn('CORS is configured with wildcard origin (*) - insecure for production');
        }
        this.fastify.addHook('onRequest', async (request, reply) => {
            const origin = request.headers.origin;

            if (origin && isAllowedOrigin(origin, allowedOrigins)) {
                reply.header('Access-Control-Allow-Origin', origin);
                reply.header('Vary', 'Origin');
                reply.header('Access-Control-Allow-Credentials', 'true');
                reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
                reply.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
            }

            if (request.method === 'OPTIONS') {
                reply.status(204);
                return reply.send();
            }
        });

        // View engine for templates
        await this.fastify.register(FastifyView, {
            engine: { handlebars: Handlebars },
            defaultContext: { urlPrefix },
        });
    }

    private async setupRoutes(): Promise<void> {
        const authMiddleware = createAuthMiddleware(this.fastify, this.config.requireAuth);
        const csrfMiddleware = createCsrfMiddleware();
        const rateLimitAuth = createRateLimitMiddleware('auth');
        const rateLimitKeys = createRateLimitMiddleware('keys');

        // Determine if we should use secure cookies (HTTPS)
        const useSecureCookies = this.config.baseUrl?.startsWith('https://') ?? false;

        // Health check endpoint (no auth required)
        // Returns full status if getHealthStatus is provided, otherwise simple status
        this.fastify.get('/health', async (_request, reply) => {
            if (this.config.getHealthStatus) {
                return reply.send(this.config.getHealthStatus());
            }
            return reply.send({ status: 'ok' });
        });

        // CSRF token endpoint - provides a fresh token to the client
        this.fastify.get('/csrf-token', { preHandler: [authMiddleware] }, async (_request, reply) => {
            const token = generateCsrfToken();
            setCsrfCookie(reply, token, useSecureCookies);
            return reply.send({ token });
        });

        // Connection routes (POST /connections/refresh needs CSRF)
        registerConnectionRoutes(this.fastify, {
            connectionManager: this.config.connectionManager,
            nostrConfig: this.config.nostrConfig,
            relayService: this.config.relayService,
            getTrustScore: this.config.getTrustScore,
            getTrustScoresForRelays: this.config.getTrustScoresForRelays,
        }, { auth: [authMiddleware], csrf: [csrfMiddleware] });

        // Request routes (state-changing, needs CSRF)
        registerRequestRoutes(this.fastify, {
            requestService: this.config.requestService,
            appService: this.config.appService,
        }, {
            auth: [authMiddleware],
            csrf: [csrfMiddleware],
            rateLimit: [rateLimitAuth],
        });

        // Key routes (state-changing, needs CSRF)
        registerKeysRoutes(this.fastify, {
            keyService: this.config.keyService,
        }, {
            auth: [authMiddleware],
            csrf: [csrfMiddleware],
            rateLimit: [rateLimitKeys],
        });

        // App routes (state-changing, needs CSRF)
        registerAppsRoutes(this.fastify, {
            appService: this.config.appService,
        }, {
            auth: [authMiddleware],
            csrf: [csrfMiddleware],
        });

        // Dashboard routes (GET only, no CSRF needed)
        registerDashboardRoutes(this.fastify, {
            dashboardService: this.config.dashboardService,
        }, [authMiddleware]);

        // Token routes (state-changing, needs CSRF)
        registerTokensRoutes(this.fastify, {
            auth: [authMiddleware],
            csrf: [csrfMiddleware],
            rateLimit: [rateLimitAuth],
        });

        // Policy routes (state-changing, needs CSRF)
        registerPoliciesRoutes(this.fastify, {
            auth: [authMiddleware],
            csrf: [csrfMiddleware],
            rateLimit: [rateLimitAuth],
        });

        // Events routes (SSE, GET only, no CSRF needed)
        registerEventsRoutes(this.fastify, {
            eventService: this.config.eventService,
        }, [authMiddleware]);

        // Nostrconnect routes (state-changing, needs CSRF)
        registerNostrconnectRoutes(this.fastify, {
            appService: this.config.appService,
        }, {
            auth: [authMiddleware],
            csrf: [csrfMiddleware],
        });

        // Dead man's switch routes (state-changing, needs CSRF)
        registerDeadManSwitchRoutes(this.fastify, {
            auth: [authMiddleware],
            csrf: [csrfMiddleware],
        });

        // Logs routes (GET only, no CSRF needed)
        registerLogsRoutes(this.fastify, [authMiddleware]);
    }

    private async listen(): Promise<void> {
        await this.fastify.listen({
            port: this.config.port,
            host: this.config.host,
        });
    }
}
