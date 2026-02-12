import { decode as nip19Decode, npubEncode } from 'nostr-tools/nip19';
import { hexToBytes } from './lib/hex.js';
import { ConnectionManager } from './connection-manager.js';
import { Nip46Backend, type PermitCallbackParams } from './nip46-backend.js';
import { RelayPool } from './lib/relay-pool.js';
import { SubscriptionManager } from './lib/subscription-manager.js';
import { printServerInfo } from './lib/network.js';
import { requestAuthorization } from './authorize.js';
import type { DaemonBootstrapConfig } from './types.js';
import { checkRequestPermission, type RpcMethod, type ApprovalType } from './lib/acl.js';
import { TTLCache, getAllCacheStats } from './lib/ttl-cache.js';
import { extractEventKind } from './lib/parse.js';
import { toErrorMessage } from './lib/errors.js';
import { logger, setLogEntryEmitter } from './lib/logger.js';
import { logBuffer } from './lib/log-buffer.js';
import {
    KeyService,
    RequestService,
    AppService,
    DashboardService,
    RelayService,
    PublishLogger,
    EventService,
    setEventService,
    getEventService,
    setDashboardService,
    setHealthStatusGetter,
    emitCurrentStats,
    getConnectionTokenService,
    AdminCommandService,
    initNostrconnectService,
    initDeadManSwitchService,
    type DeadManSwitchService,
    TrustScoreService,
} from './services/index.js';
import { requestRepository, logRepository } from './repositories/index.js';
import { adminLogRepository } from './repositories/admin-log-repository.js';
import { HttpServer, type HealthStatus } from './http/server.js';
import prisma from '../db.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Read version from package.json using CJS-compatible approach
let daemonVersion = '1.0.0';
try {
    // In CJS output, __dirname is available
    const packageJsonPath = join(__dirname, '../../package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    daemonVersion = packageJson.version || '1.0.0';
} catch {
    // Fall back to default version if reading fails
}

// ============================================================================
// Global Error Handlers
// ============================================================================
// Catch unhandled errors to prevent silent crashes and provide visibility

process.on('uncaughtException', (error: Error) => {
    logger.error('Uncaught exception', {
        error: error.message,
        stack: error.stack,
    });
    // Don't exit - let the process continue if possible
    // The error is logged and we can investigate
});

process.on('unhandledRejection', (reason: unknown, _promise: Promise<unknown>) => {
    const reasonStr = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    logger.error('Unhandled rejection', {
        reason: reasonStr,
        ...(stack ? { stack } : {}),
    });
    // Don't exit - just log for investigation
});

// Cleanup constants
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const REQUEST_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const LOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Health monitoring constants
const HEALTH_LOG_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const HEALTH_SSE_INTERVAL_MS = 10 * 1000; // 10 seconds - real-time health updates via SSE

// Rate limiting for auto-approval logging: 1 log per method per 5 seconds per app
// Using TTLCache ensures automatic cleanup of old entries
const AUTO_APPROVAL_LOG_INTERVAL_MS = 5 * 1000; // 5 seconds
const autoApprovalLogTimestamps = new TTLCache<boolean>('auto-approval-log', {
    ttlMs: AUTO_APPROVAL_LOG_INTERVAL_MS,
    maxSize: 10_000, // Safety cap
});

function shouldLogAutoApproval(keyUserId: number, method: string): boolean {
    const key = `${keyUserId}:${method}`;

    // If key exists and hasn't expired, don't log
    if (autoApprovalLogTimestamps.has(key)) {
        return false;
    }

    // Key doesn't exist or expired - log and set new entry
    autoApprovalLogTimestamps.set(key, true);
    return true;
}

function buildAuthorizationCallback(
    keyName: string,
    connectionManager: ConnectionManager
) {
    const keyLogger = logger.child({ key: keyName });

    return async ({ id, method, pubkey, params }: PermitCallbackParams): Promise<boolean> => {
        const humanPubkey = npubEncode(pubkey);
        keyLogger.info('Request received', { requestId: id, from: humanPubkey, method });

        const primaryParam = Array.isArray(params) ? params[0] : undefined;
        const result = await checkRequestPermission(
            keyName,
            pubkey,
            method as RpcMethod,
            primaryParam
        );

        if (result.permitted !== undefined) {
            const accessType = result.autoApproved ? 'auto-approved' : 'granted';
            keyLogger.info(`Access ${result.permitted ? accessType : 'denied'} via ACL`, { npub: humanPubkey });

            // Log all permitted requests (with rate limiting)
            // This includes both trust-level auto-approvals and explicit permission grants
            if (result.permitted && result.keyUserId) {
                if (shouldLogAutoApproval(result.keyUserId, method)) {
                    // Log asynchronously to avoid blocking
                    logAutoApproval(result.keyUserId, method, primaryParam, keyName, id, pubkey, result.autoApproved, result.approvalType).catch(err => {
                        logger.error('Failed to log auto-approval', { error: toErrorMessage(err) });
                    });
                }
            }

            return result.permitted;
        }
        keyLogger.info('No ACL decision, proceeding to authorization request', { npub: humanPubkey });

        try {
            await requestAuthorization(connectionManager, keyName, pubkey, id, method, primaryParam);
            return true;
        } catch (error) {
            keyLogger.info('Authorization rejected', { error: toErrorMessage(error) });
            return false;
        }
    };
}

async function logAutoApproval(
    keyUserId: number,
    method: string,
    params: string | undefined,
    keyName: string,
    requestId: string,
    remotePubkey: string,
    autoApproved: boolean,
    approvalType?: ApprovalType
): Promise<void> {
    // Fetch KeyUser info for the activity entry
    const keyUser = await prisma.keyUser.findUnique({
        where: { id: keyUserId },
        select: { userPubkey: true, description: true },
    });

    const paramsStr = typeof params === 'string' ? params : JSON.stringify(params);

    // Extract event kind for sign_event
    const eventKind = method === 'sign_event' ? extractEventKind(paramsStr) : undefined;

    // Create request record (so it appears in Activity page)
    await requestRepository.createAutoApproved({
        requestId,
        keyName,
        method,
        remotePubkey,
        params: paramsStr,
        keyUserId,
        approvalType,
    });

    // Create log entry
    const log = await logRepository.create({
        type: 'approval',
        method,
        params: paramsStr,
        keyUserId,
        autoApproved,
        approvalType,
    });

    // Emit SSE event
    const eventService = getEventService();
    eventService.emitRequestAutoApproved({
        id: log.id,
        timestamp: log.timestamp.toISOString(),
        type: log.type,
        method: log.method ?? undefined,
        eventKind,
        keyName,
        userPubkey: keyUser?.userPubkey,
        appName: keyUser?.description ?? undefined,
        autoApproved,
        approvalType,
    });

    // Emit stats update (activity count changed)
    await emitCurrentStats();
}

export async function runDaemon(config: DaemonBootstrapConfig): Promise<void> {
    const daemon = new Daemon(config);
    await daemon.start();
}

class Daemon {
    private readonly config: DaemonBootstrapConfig;
    private readonly pool: RelayPool;
    private readonly subscriptionManager: SubscriptionManager;
    private readonly connectionManager: ConnectionManager;
    private readonly keyService: KeyService;
    private readonly requestService: RequestService;
    private readonly appService: AppService;
    private readonly dashboardService: DashboardService;
    private readonly relayService: RelayService;
    private readonly publishLogger: PublishLogger;
    private readonly eventService: EventService;
    private readonly adminCommandService?: AdminCommandService;
    private readonly deadManSwitchService: DeadManSwitchService;
    private readonly trustScoreService: TrustScoreService;
    private readonly backends: Map<string, Nip46Backend> = new Map();
    private httpServer?: HttpServer;
    private lastPoolReset: Date | null = null;

    // Interval tracking for graceful shutdown
    private cleanupIntervalId?: ReturnType<typeof setInterval>;
    private healthLogIntervalId?: ReturnType<typeof setInterval>;
    private healthSseIntervalId?: ReturnType<typeof setInterval>;
    private isShuttingDown = false;

    constructor(config: DaemonBootstrapConfig) {
        this.config = config;

        // Create shared relay pool
        this.pool = new RelayPool(config.nostr.relays);

        // Create subscription manager for automatic reconnection after sleep/wake
        this.subscriptionManager = new SubscriptionManager({ pool: this.pool });

        // Initialize relay health monitoring
        this.relayService = new RelayService(this.pool);

        // Wire up relay status change callback to emit SSE events
        this.pool.setStatusChangeCallback(() => {
            this.emitRelayStatus();
        });

        // Initialize publish logger for debugging response delivery
        this.publishLogger = new PublishLogger(this.pool);

        // Initialize services
        this.keyService = new KeyService({
            configFile: config.configFile,
            allKeys: config.allKeys,
            nostrRelays: config.nostr.relays,
            adminSecret: config.admin.secret,
        }, config.keys);

        this.requestService = new RequestService({
            allKeys: config.allKeys,
        });

        this.appService = new AppService();

        this.dashboardService = new DashboardService({
            allKeys: config.allKeys,
            getActiveKeyCount: () => Object.keys(this.keyService.getActiveKeys()).length,
        });
        setDashboardService(this.dashboardService);

        // Initialize event service for real-time updates
        this.eventService = new EventService();
        setEventService(this.eventService);
        setHealthStatusGetter(() => this.getHealthStatus());

        // Wire up logger to emit SSE events for real-time log streaming
        setLogEntryEmitter((entry) => this.eventService.emitLogEntry(entry));

        // Initialize connection manager (generates bunker URIs and sends auth_url responses)
        this.connectionManager = new ConnectionManager({
            key: config.admin.key,
            relays: config.nostr.relays,
            secret: config.admin.secret,
        }, config.configFile, this.pool);

        // Initialize admin command service (kill switch) if configured
        if (config.killSwitch) {
            this.adminCommandService = new AdminCommandService({
                config: config.killSwitch,
                keyService: this.keyService,
                appService: this.appService,
                getActiveKeySecrets: () => this.keyService.getActiveKeys(),
                daemonVersion,
            });
        }

        // Initialize dead man's switch service
        this.deadManSwitchService = initDeadManSwitchService({
            keyService: this.keyService,
            appService: this.appService,
            daemonVersion,
            // Warning DM callback will be set up after admin command service starts
        });

        // Initialize trust score service for relay reputation
        this.trustScoreService = new TrustScoreService(config.nostr.relays);

        // Initialize nostrconnect service for client-initiated connections
        const nostrconnectService = initNostrconnectService({
            keyService: this.keyService,
        });

        // Wire up per-app subscription callbacks
        nostrconnectService.setOnAppConnected((keyName, appId, relays) => {
            const backend = this.backends.get(keyName);
            if (backend) {
                backend.addAppSubscription(appId, relays);
            } else {
                logger.warn('No backend for key, cannot create subscription', { key: keyName, source: 'nostrconnect' });
            }
        });

        nostrconnectService.setOnAppRevoked((keyName, appId) => {
            const backend = this.backends.get(keyName);
            if (backend) {
                backend.removeAppSubscription(appId);
            }
        });
    }

    public async start(): Promise<void> {
        logger.info('Connecting to relays...');

        // RelayPool connects lazily, but let's log what we're configured with
        const relayCount = this.pool.getRelays().length;
        logger.info('Relay configuration', { count: relayCount, relays: this.pool.getRelays() });

        this.subscriptionManager.start();
        this.pool.startMonitoring(); // Start sleep/wake detection

        // Handle pool events (sleep/wake, reset)
        this.pool.on((event) => {
            if (event.type === 'sleep-detected') {
                logger.info('System wake detected, refreshing connections', { source: 'killswitch' });
                this.adminCommandService?.refresh();
            }
            if (event.type === 'pool-reset') {
                this.lastPoolReset = new Date();
                // Log health status after pool reset for visibility
                setTimeout(() => this.logHealthStatus(), 2000);
            }
        });

        this.relayService.start();
        this.publishLogger.start();
        await this.startWebAuth();

        // Wire up callback to start bunker backend when keys are unlocked/created via HTTP
        this.keyService.setOnKeyActivated(async (keyName: string, secret: string) => {
            await this.startKey(keyName, secret);
            // Refresh kill switch subscriptions so it listens on newly activated keys
            this.adminCommandService?.refresh();
            // Log health status after key change
            this.logHealthStatus();
        });

        // Wire up callback to stop bunker backend when keys are locked via HTTP
        this.keyService.setOnKeyLocked((keyName: string) => {
            this.stopKey(keyName);
            // Refresh kill switch subscriptions since this key is no longer available
            this.adminCommandService?.refresh();
            // Log health status after key change
            this.logHealthStatus();
        });

        await this.startConfiguredKeys();
        await this.loadPlainKeys();

        // Start admin command service (kill switch) after keys are loaded
        if (this.adminCommandService) {
            this.adminCommandService.start();
        }

        // Start dead man's switch service
        await this.deadManSwitchService.start();

        // Start trust score service (fetches relay trust scores)
        await this.trustScoreService.start();

        this.startCleanupTasks();

        // Log daemon_started event
        const adminLog = await adminLogRepository.create({
            eventType: 'daemon_started',
            clientName: 'signet-daemon',
            clientVersion: daemonVersion,
        });
        this.eventService.emitAdminEvent(adminLogRepository.toActivityEntry(adminLog));

        // Register signal handlers for graceful shutdown
        const handleShutdown = async (signal: string) => {
            logger.info('Received shutdown signal', { signal });
            await this.shutdown();
            process.exit(0);
        };

        process.on('SIGTERM', () => handleShutdown('SIGTERM'));
        process.on('SIGINT', () => handleShutdown('SIGINT'));

        logger.info('Signet ready to serve requests');
    }

    private startCleanupTasks(): void {
        // Run cleanup immediately on startup
        this.runCleanup();

        // Schedule periodic cleanup (store ID for graceful shutdown)
        this.cleanupIntervalId = setInterval(() => {
            this.runCleanup();
        }, CLEANUP_INTERVAL_MS);

        // Schedule periodic health logging (store ID for graceful shutdown)
        this.healthLogIntervalId = setInterval(() => {
            this.logHealthStatus();
        }, HEALTH_LOG_INTERVAL_MS);

        // Schedule periodic health SSE updates for real-time monitoring (store ID for graceful shutdown)
        this.healthSseIntervalId = setInterval(() => {
            this.eventService.emitHealthUpdated(this.getHealthStatus());
        }, HEALTH_SSE_INTERVAL_MS);

        // Log initial health status after a short delay
        setTimeout(() => {
            this.logHealthStatus();
        }, 30000); // 30 seconds after startup
    }

    private async shutdown(): Promise<void> {
        if (this.isShuttingDown) return;
        this.isShuttingDown = true;

        logger.info('Shutting down gracefully...');

        // Clear intervals
        if (this.cleanupIntervalId) clearInterval(this.cleanupIntervalId);
        if (this.healthLogIntervalId) clearInterval(this.healthLogIntervalId);
        if (this.healthSseIntervalId) clearInterval(this.healthSseIntervalId);

        // Stop all backends
        for (const [name, backend] of this.backends) {
            logger.info('Stopping backend', { key: name });
            backend.stop();
        }
        this.backends.clear();

        // Stop services in reverse order of startup
        this.adminCommandService?.stop();
        this.deadManSwitchService.stop();
        this.trustScoreService.stop();
        this.relayService.stop();
        this.publishLogger.stop();
        this.subscriptionManager.stop();
        this.pool.close();

        // Close HTTP server
        if (this.httpServer) {
            await this.httpServer.getFastify().close();
        }

        // Disconnect database
        await prisma.$disconnect();

        logger.info('Shutdown complete');
    }

    private logHealthStatus(): void {
        const status = this.getHealthStatus();
        const uptimeHours = Math.floor(status.uptime / 3600);
        const uptimeMinutes = Math.floor((status.uptime % 3600) / 60);

        logger.info('Health status', {
            uptime: `${uptimeHours}h ${uptimeMinutes}m`,
            heapMB: status.memory.heapMB,
            rssMB: status.memory.rssMB,
            sseClients: status.sseClients,
            relays: `${status.relays.connected}/${status.relays.total}`,
            activeKeys: status.keys.active,
            subscriptions: status.subscriptions,
            ...(status.lastPoolReset ? { lastPoolReset: status.lastPoolReset } : {}),
        });
    }

    private getHealthStatus(): HealthStatus {
        const mem = process.memoryUsage();
        const keyStats = this.keyService.getKeyStats();
        const relayConnected = this.pool.getConnectedCount();
        const relayTotal = this.pool.getRelays().length;
        const logStats = logBuffer.getStats();

        return {
            status: relayConnected > 0 ? 'ok' : 'degraded',
            uptime: Math.round(process.uptime()),
            memory: {
                heapMB: Math.round(mem.heapUsed / 1024 / 1024),
                rssMB: Math.round(mem.rss / 1024 / 1024),
            },
            relays: {
                connected: relayConnected,
                total: relayTotal,
            },
            keys: {
                active: keyStats.active,
                locked: keyStats.locked,
                offline: keyStats.offline,
            },
            subscriptions: this.subscriptionManager.getSubscriptionCount(),
            sseClients: this.eventService.getSubscriberCount(),
            lastPoolReset: this.lastPoolReset?.toISOString() ?? null,
            caches: getAllCacheStats(),
            logBuffer: {
                entries: logStats.entries,
                maxEntries: logStats.maxEntries,
                estimatedKB: Math.round(logStats.estimatedBytes / 1024),
            },
        };
    }

    private async runCleanup(): Promise<void> {
        let statsChanged = false;

        // Cleanup expired requests (older than 24 hours)
        try {
            const requestMaxAge = new Date(Date.now() - REQUEST_MAX_AGE_MS);
            const deletedRequests = await requestRepository.cleanupExpired(requestMaxAge);
            if (deletedRequests > 0) {
                logger.info('Cleaned up expired requests', { count: deletedRequests, maxAge: '24 hours' });
                statsChanged = true;
            }
        } catch (error) {
            logger.error('Failed to cleanup old requests', { error: toErrorMessage(error) });
        }

        // Cleanup old logs (older than 30 days)
        try {
            const logMaxAge = new Date(Date.now() - LOG_MAX_AGE_MS);
            const deletedLogs = await logRepository.cleanupExpired(logMaxAge);
            if (deletedLogs > 0) {
                logger.info('Cleaned up old logs', { count: deletedLogs, maxAge: '30 days' });
                statsChanged = true;
            }
        } catch (error) {
            logger.error('Failed to cleanup old logs', { error: toErrorMessage(error) });
        }

        // Cleanup old admin logs (older than 30 days)
        try {
            const adminLogMaxAge = new Date(Date.now() - LOG_MAX_AGE_MS);
            const deletedAdminLogs = await adminLogRepository.cleanupExpired(adminLogMaxAge);
            if (deletedAdminLogs > 0) {
                logger.info('Cleaned up old admin logs', { count: deletedAdminLogs, maxAge: '30 days' });
            }
        } catch (error) {
            logger.error('Failed to cleanup old admin logs', { error: toErrorMessage(error) });
        }

        // Cleanup expired connection tokens
        try {
            const tokenService = getConnectionTokenService();
            const deletedTokens = await tokenService.cleanupExpiredTokens();
            if (deletedTokens > 0) {
                logger.info('Cleaned up expired connection tokens', { count: deletedTokens });
            }
        } catch (error) {
            logger.error('Failed to cleanup connection tokens', { error: toErrorMessage(error) });
        }

        // Emit stats update if anything changed
        if (statsChanged) {
            await emitCurrentStats();
        }
    }

    private async startConfiguredKeys(): Promise<void> {
        const activeKeys = this.keyService.getActiveKeys();
        const names = Object.keys(activeKeys);
        logger.info('Starting keys', { keys: names.length > 0 ? names : ['(none)'] });

        for (const [name, secret] of Object.entries(activeKeys)) {
            await this.startKey(name, secret);
        }
    }

    private async loadPlainKeys(): Promise<void> {
        for (const [name, entry] of Object.entries(this.config.allKeys)) {
            if (!entry?.key) {
                continue;
            }

            const nsec = entry.key.startsWith('nsec1')
                ? entry.key
                : (() => {
                    const { nsecEncode } = require('nostr-tools/nip19');
                    return nsecEncode(hexToBytes(entry.key));
                })();
            this.loadKeyMaterial(name, nsec);
        }
    }

    private async startKey(name: string, secret: string): Promise<void> {
        // Parse secret to bytes
        let secretBytes: Uint8Array;
        if (secret.startsWith('nsec1')) {
            const decoded = nip19Decode(secret);
            if (decoded.type !== 'nsec') {
                logger.warn('Cannot start key: Invalid nsec', { key: name });
                return;
            }
            secretBytes = decoded.data as Uint8Array;
        } else {
            secretBytes = hexToBytes(secret);
        }

        try {
            const backend = new Nip46Backend({
                keyName: name,
                nsec: secretBytes,
                pool: this.pool,
                subscriptionManager: this.subscriptionManager,
                permitCallback: buildAuthorizationCallback(name, this.connectionManager),
                adminSecret: this.config.admin.secret,
            });

            backend.start();
            this.backends.set(name, backend);
            logger.info('Key online', { key: name });
        } catch (error) {
            logger.error('Failed to start key', { key: name, error: toErrorMessage(error) });
        }
    }

    private stopKey(name: string): void {
        const backend = this.backends.get(name);
        if (backend) {
            backend.stop();
            this.backends.delete(name);
            logger.info('Key locked', { key: name });
        }
    }

    private async startWebAuth(): Promise<void> {
        // Support both new (SIGNET_*) and legacy (AUTH_*) env var names
        const portEnv = process.env.SIGNET_PORT ?? process.env.AUTH_PORT;
        const authPort = this.config.authPort ?? (portEnv ? parseInt(portEnv, 10) : undefined);
        if (!authPort) {
            logger.info('No authPort configured, HTTP server disabled');
            return;
        }

        const baseUrl = this.config.baseUrl ?? process.env.EXTERNAL_URL ?? process.env.BASE_URL;
        logger.info('Starting HTTP server', { port: authPort });
        this.httpServer = new HttpServer({
            port: authPort,
            host: this.config.authHost ?? process.env.SIGNET_HOST ?? process.env.AUTH_HOST ?? '0.0.0.0',
            baseUrl,
            jwtSecret: this.config.jwtSecret,
            allowedOrigins: this.config.allowedOrigins ?? [],
            requireAuth: this.config.requireAuth ?? false,
            connectionManager: this.connectionManager,
            nostrConfig: this.config.nostr,
            keyService: this.keyService,
            requestService: this.requestService,
            appService: this.appService,
            dashboardService: this.dashboardService,
            eventService: this.eventService,
            relayService: this.relayService,
            getHealthStatus: () => this.getHealthStatus(),
            getTrustScore: (url) => this.trustScoreService.getScore(url),
            getTrustScoresForRelays: (urls) => this.trustScoreService.getScoresForRelays(urls),
        });

        await this.httpServer.start();
        await printServerInfo(authPort);
    }

    private loadKeyMaterial(keyName: string, nsec: string): void {
        this.keyService.loadKeyMaterial(keyName, nsec);
        this.startKey(keyName, nsec).catch((error) => {
            logger.error('Failed to start key', { key: keyName, error: toErrorMessage(error) });
        });
    }

    private emitRelayStatus(): void {
        const statuses = this.relayService.getStatus();
        const connected = this.relayService.getConnectedCount();
        this.eventService.emitRelaysUpdated({
            connected,
            total: statuses.length,
            relays: statuses.map(s => ({
                url: s.url,
                connected: s.connected,
                lastConnected: s.lastConnected?.toISOString() ?? null,
                lastDisconnected: s.lastDisconnected?.toISOString() ?? null,
                trustScore: this.trustScoreService.getScore(s.url),
            })),
        });
    }
}
