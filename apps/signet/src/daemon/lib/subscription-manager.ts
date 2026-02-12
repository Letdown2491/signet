import createDebug from 'debug';
import type { RelayPool, SubscriptionFilter } from './relay-pool.js';
import type { Event } from 'nostr-tools/pure';
import { toErrorMessage } from './errors.js';
import { logger } from './logger.js';
import {
    SUBSCRIPTION_HEALTH_CHECK_INTERVAL_MS,
    SUBSCRIPTION_RECREATION_TIMEOUT_MS,
    SUBSCRIPTION_RESTART_DEBOUNCE_MS,
} from '../constants.js';

const debug = createDebug('signet:subscription-manager');

// Fallback sleep detection: if health check interval exceeds this, assume system slept
// This is a backup in case RelayPool's heartbeat doesn't fire after long sleep
const SLEEP_DETECTION_THRESHOLD_MS = SUBSCRIPTION_HEALTH_CHECK_INTERVAL_MS * 3;

export interface ManagedSubscription {
    id: string;
    filter: SubscriptionFilter;
    onEvent: (event: Event) => void;
    cleanup?: () => void;
    relays?: string[];  // Custom relays for this subscription (defaults to pool relays)
}

export interface SubscriptionManagerConfig {
    pool: RelayPool;
    healthCheckInterval?: number;
    recreationTimeout?: number;
}

type SubscriptionManagerEvent =
    | { type: 'subscription-restarted'; data: { count: number; reason: string } }
    | { type: 'subscription-refreshed'; data: { subscriptionId: string } }
    | { type: 'health-check-failed'; data: { subscriptionId: string; error?: string } }
    | { type: 'health-check-passed'; data: { subscriptionId: string } };

type SubscriptionManagerEventType = SubscriptionManagerEvent['type'];
type SubscriptionManagerListener = (event: SubscriptionManagerEvent) => void;

/**
 * Manages subscription lifecycle with automatic reconnection.
 *
 * Features:
 * - Listens for pool-reset events and recreates subscriptions
 * - Periodic health checks that rotate through subscriptions, recreating one per check
 * - Each health check both tests AND refreshes the subscription (test IS the fix)
 * - Automatic full restart on failure
 * - Debounced restarts to avoid rapid-fire reconnections
 *
 * Health check strategy:
 * Instead of creating throwaway ping subscriptions (which may use different connections),
 * we rotate through actual managed subscriptions, closing and recreating each one.
 * If recreation succeeds (EOSE received), that subscription is now on a fresh connection.
 * This guarantees all subscriptions get refreshed over time, regardless of silent failures.
 *
 * Note: Sleep/wake detection is handled by RelayPool, which emits 'pool-reset'
 * events when the system wakes from sleep.
 */
export class SubscriptionManager {
    private readonly pool: RelayPool;
    private readonly healthCheckInterval: number;
    private readonly recreationTimeout: number;

    private readonly subscriptions: Map<string, ManagedSubscription> = new Map();
    private readonly listeners: Set<SubscriptionManagerListener> = new Set();

    private healthCheckTimer?: NodeJS.Timeout;
    private isRunning = false;
    private restartDebounceTimer?: NodeJS.Timeout;
    private pendingRestart = false;
    private poolListenerCleanup?: () => void;
    private lastHealthCheck: number = 0;
    private healthCheckIndex: number = 0;  // Round-robin index for subscription rotation

    constructor(config: SubscriptionManagerConfig) {
        this.pool = config.pool;
        this.healthCheckInterval = config.healthCheckInterval ?? SUBSCRIPTION_HEALTH_CHECK_INTERVAL_MS;
        this.recreationTimeout = config.recreationTimeout ?? SUBSCRIPTION_RECREATION_TIMEOUT_MS;
    }

    /**
     * Start the subscription manager's health check loop.
     */
    public start(): void {
        if (this.isRunning) {
            debug('already running, ignoring start()');
            return;
        }

        this.isRunning = true;
        this.lastHealthCheck = Date.now();

        // Listen for pool-reset events to recreate subscriptions
        this.poolListenerCleanup = this.pool.on((event) => {
            if (event.type === 'pool-reset') {
                debug('received pool-reset event, scheduling subscription restart');
                this.scheduleRestart('pool-reset');
            }
        });

        // Start periodic health checks
        this.healthCheckTimer = setInterval(() => {
            this.runHealthCheck();
        }, this.healthCheckInterval);

        debug('started with %dms health check interval', this.healthCheckInterval);
        logger.info('Subscription health monitoring started', { checkIntervalSec: this.healthCheckInterval / 1000 });

        // Run initial health check after a short delay to allow subscriptions to connect
        setTimeout(() => {
            if (this.isRunning && this.subscriptions.size > 0) {
                logger.info('Running initial relay health check');
                this.runHealthCheck();
            }
        }, 5000);
    }

    /**
     * Stop the subscription manager.
     */
    public stop(): void {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;

        // Clean up pool listener
        this.poolListenerCleanup?.();
        this.poolListenerCleanup = undefined;

        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = undefined;
        }

        if (this.restartDebounceTimer) {
            clearTimeout(this.restartDebounceTimer);
            this.restartDebounceTimer = undefined;
        }

        debug('stopped');
        logger.info('Subscription health monitoring stopped');
    }

    /**
     * Register a subscription to be managed.
     * The subscription will be automatically restarted if the connection fails.
     *
     * @param id - Unique subscription ID
     * @param filter - Filter for matching events
     * @param onEvent - Callback for each matching event
     * @param relays - Optional custom relays (defaults to pool's configured relays)
     */
    public subscribe(
        id: string,
        filter: SubscriptionFilter,
        onEvent: (event: Event) => void,
        relays?: string[]
    ): () => void {
        // Close existing subscription with same ID
        this.unsubscribe(id);

        // Create the subscription (pass custom relays if provided)
        const cleanup = this.pool.subscribe(filter, onEvent, id, undefined, relays);

        // Track it
        const managed: ManagedSubscription = {
            id,
            filter,
            onEvent,
            cleanup,
            relays,
        };
        this.subscriptions.set(id, managed);

        debug('registered managed subscription %s%s', id, relays ? ` on ${relays.length} custom relays` : '');

        // Return cleanup function
        return () => this.unsubscribe(id);
    }

    /**
     * Unregister and close a managed subscription.
     */
    public unsubscribe(id: string): void {
        const managed = this.subscriptions.get(id);
        if (managed) {
            managed.cleanup?.();
            this.subscriptions.delete(id);
            debug('unregistered subscription %s', id);
        }
    }

    /**
     * Get the number of managed subscriptions.
     */
    public getSubscriptionCount(): number {
        return this.subscriptions.size;
    }

    /**
     * Add an event listener.
     */
    public on(listener: SubscriptionManagerListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Force restart all subscriptions.
     */
    public async restartAll(): Promise<void> {
        await this.doRestartSubscriptions('manual');
    }

    /**
     * Run health check by recreating one subscription (round-robin).
     * This tests the actual subscription path AND refreshes the connection.
     * Also includes fallback sleep detection in case RelayPool's heartbeat didn't fire.
     */
    private async runHealthCheck(): Promise<void> {
        const now = Date.now();
        const elapsed = now - this.lastHealthCheck;
        this.lastHealthCheck = now;

        // Fallback sleep detection: if too much time passed since last check, assume system slept
        // This catches cases where RelayPool's heartbeat didn't fire after long sleep
        if (elapsed > SLEEP_DETECTION_THRESHOLD_MS) {
            const sleepDuration = Math.round((elapsed - this.healthCheckInterval) / 1000);
            logger.info('System wake detected via health check, resetting pool', { sleepDurationSec: sleepDuration });
            this.pool.resetPool();
            // Pool reset will emit 'pool-reset' event, which triggers subscription restart
            // No need to continue with check - subscriptions will be recreated
            return;
        }

        if (this.subscriptions.size === 0) {
            debug('no subscriptions to health check');
            return;
        }

        // Get subscription to refresh (round-robin)
        const subscriptionIds = Array.from(this.subscriptions.keys());
        const currentIndex = this.healthCheckIndex % subscriptionIds.length;
        const targetId = subscriptionIds[currentIndex];
        this.healthCheckIndex = (this.healthCheckIndex + 1) % subscriptionIds.length;

        logger.debug('Health check refreshing subscription', { subscriptionId: targetId, index: currentIndex + 1, total: subscriptionIds.length });

        try {
            const success = await this.refreshOneSubscription(targetId);
            if (success) {
                logger.debug('Health check passed', { subscriptionId: targetId });
                this.pool.reportHealthCheckSuccess();
                this.emit({ type: 'health-check-passed', data: { subscriptionId: targetId } });
                this.emit({ type: 'subscription-refreshed', data: { subscriptionId: targetId } });
            } else {
                logger.warn('Health check failed, no EOSE received', { subscriptionId: targetId });
                const poolReset = this.pool.reportHealthCheckFailure();
                this.emit({ type: 'health-check-failed', data: { subscriptionId: targetId } });
                // If one subscription fails to recreate, something is wrong - restart all
                this.scheduleRestart(poolReset ? 'pool-reset' : 'health-check-failed');
            }
        } catch (error) {
            logger.error('Health check error', { subscriptionId: targetId, error: toErrorMessage(error) });
            const poolReset = this.pool.reportHealthCheckFailure();
            this.emit({ type: 'health-check-failed', data: { subscriptionId: targetId, error: toErrorMessage(error) } });
            this.scheduleRestart(poolReset ? 'pool-reset' : 'health-check-error');
        }
    }

    /**
     * Refresh a single subscription by closing and recreating it.
     * Returns true if the recreated subscription receives EOSE within timeout.
     * This tests the actual subscription path - if it works, the subscription is now fresh.
     */
    private refreshOneSubscription(subscriptionId: string): Promise<boolean> {
        return new Promise((resolve) => {
            const managed = this.subscriptions.get(subscriptionId);
            if (!managed) {
                debug('subscription %s not found, cannot refresh', subscriptionId);
                resolve(false);
                return;
            }

            // Store subscription config before closing
            const { filter, onEvent, relays } = managed;

            // Close existing subscription
            managed.cleanup?.();
            this.subscriptions.delete(subscriptionId);
            debug('closed subscription %s for refresh', subscriptionId);

            let resolved = false;
            let gotEose = false;

            const finish = (success: boolean) => {
                if (!resolved) {
                    resolved = true;
                    clearTimeout(timeout);
                    debug('refresh result for %s: %s (gotEose=%s)', subscriptionId, success, gotEose);
                    resolve(success);
                }
            };

            // Set timeout - if we don't get EOSE, the recreation failed
            const timeout = setTimeout(() => {
                debug('refresh timeout for %s - no EOSE received', subscriptionId);
                // The subscription was removed but recreation failed
                // We'll return false and trigger a full restart which will recreate everything
                finish(false);
            }, this.recreationTimeout);

            // Recreate the subscription with EOSE callback
            const cleanup = this.pool.subscribe(
                filter,
                onEvent,
                subscriptionId,
                () => {
                    // EOSE callback - subscription is working on fresh connection
                    gotEose = true;
                    finish(true);
                },
                relays
            );

            // Store the recreated subscription
            this.subscriptions.set(subscriptionId, {
                id: subscriptionId,
                filter,
                onEvent,
                cleanup,
                relays,
            });

            debug('recreated subscription %s, waiting for EOSE', subscriptionId);
        });
    }

    /**
     * Schedule a debounced restart of all subscriptions.
     */
    private scheduleRestart(reason: string): void {
        if (this.pendingRestart) {
            debug('restart already scheduled, ignoring');
            return;
        }

        this.pendingRestart = true;

        if (this.restartDebounceTimer) {
            clearTimeout(this.restartDebounceTimer);
        }

        this.restartDebounceTimer = setTimeout(() => {
            this.restartDebounceTimer = undefined;
            this.pendingRestart = false;
            this.doRestartSubscriptions(reason);
        }, SUBSCRIPTION_RESTART_DEBOUNCE_MS);

        debug('scheduled restart in %dms (reason: %s)', SUBSCRIPTION_RESTART_DEBOUNCE_MS, reason);
    }

    /**
     * Actually restart all subscriptions.
     */
    private async doRestartSubscriptions(reason: string): Promise<void> {
        const count = this.subscriptions.size;
        if (count === 0) {
            debug('no subscriptions to restart');
            return;
        }

        logger.info('Restarting subscriptions', { count, reason });

        // Collect subscription info before closing
        const toRestart: ManagedSubscription[] = [];
        for (const managed of this.subscriptions.values()) {
            toRestart.push({
                id: managed.id,
                filter: managed.filter,
                onEvent: managed.onEvent,
                relays: managed.relays,  // Preserve custom relays
            });
        }

        // Close all existing subscriptions
        for (const managed of this.subscriptions.values()) {
            managed.cleanup?.();
        }
        this.subscriptions.clear();

        // Brief pause to let connections settle
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Recreate all subscriptions (with their custom relays if any)
        for (const sub of toRestart) {
            const cleanup = this.pool.subscribe(sub.filter, sub.onEvent, sub.id, undefined, sub.relays);
            this.subscriptions.set(sub.id, {
                ...sub,
                cleanup,
            });
            debug('restarted subscription %s%s', sub.id, sub.relays ? ` on ${sub.relays.length} custom relays` : '');
        }

        logger.info('Subscriptions restarted successfully', { count });
        this.emit({ type: 'subscription-restarted', data: { count, reason } });
    }

    /**
     * Emit an event to listeners.
     */
    private emit(event: SubscriptionManagerEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                debug('listener error: %s', toErrorMessage(error));
            }
        }
    }
}
