import { SimplePool } from 'nostr-tools/pool';
import { type Event } from 'nostr-tools/pure';
import { type Filter } from 'nostr-tools/filter';
import createDebug from 'debug';
import { toErrorMessage } from './errors.js';
import { logger } from './logger.js';
import {
    RELAY_WATCHDOG_FAILURE_THRESHOLD,
    RELAY_WATCHDOG_RESET_COOLDOWN_MS,
    RELAY_HEARTBEAT_INTERVAL_MS,
    RELAY_SLEEP_DETECTION_THRESHOLD_MS,
} from '../constants.js';

const debug = createDebug('signet:relay-pool');

export interface RelayStatus {
    url: string;
    connected: boolean;
    lastConnected: Date | null;
    lastDisconnected: Date | null;
    lastError: string | null;
}

export type SubscriptionFilter = Filter;

interface ActiveSubscription {
    id: string;
    close: () => void;
}

export type RelayPoolEvent =
    | { type: 'pool-reset' }
    | { type: 'status-change' }
    | { type: 'sleep-detected'; data: { sleepDuration: number } };

export type RelayPoolEventType = RelayPoolEvent['type'];
export type RelayPoolListener = (event: RelayPoolEvent) => void;

/**
 * Thin wrapper around nostr-tools SimplePool.
 * Provides connection status tracking and simplified subscription management.
 */
export class RelayPool {
    private pool: SimplePool;
    private readonly relays: string[];
    private readonly subscriptions: Map<string, ActiveSubscription> = new Map();
    private readonly relayStatus: Map<string, RelayStatus> = new Map();
    private consecutiveFailures = 0;
    private lastReset: number = 0;

    // Sleep/wake detection
    private heartbeatTimer?: NodeJS.Timeout;
    private lastHeartbeat: number = 0;
    private isMonitoring = false;

    // Event listeners
    private readonly listeners: Set<RelayPoolListener> = new Set();

    // Callbacks for external monitoring (legacy, kept for compatibility)
    private onPublishSuccess?: (event: Event, relay: string) => void;
    private onPublishFailure?: (event: Event, relay: string, error: Error) => void;
    private onStatusChange?: () => void;

    constructor(relays: string[]) {
        this.pool = new SimplePool();
        this.relays = relays;

        // Initialize status for all relays
        for (const url of relays) {
            this.relayStatus.set(url, {
                url,
                connected: false,
                lastConnected: null,
                lastDisconnected: null,
                lastError: null,
            });
        }

        debug('RelayPool created with %d relays', relays.length);
    }

    /**
     * Start monitoring for sleep/wake cycles.
     * Should be called after subscriptions are set up.
     */
    public startMonitoring(): void {
        if (this.isMonitoring) {
            debug('already monitoring, ignoring startMonitoring()');
            return;
        }

        this.isMonitoring = true;
        this.lastHeartbeat = Date.now();

        this.heartbeatTimer = setInterval(() => {
            this.runHeartbeat();
        }, RELAY_HEARTBEAT_INTERVAL_MS);

        debug('sleep/wake monitoring started with %dms heartbeat', RELAY_HEARTBEAT_INTERVAL_MS);
    }

    /**
     * Stop monitoring for sleep/wake cycles.
     */
    public stopMonitoring(): void {
        if (!this.isMonitoring) {
            return;
        }

        this.isMonitoring = false;
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }

        debug('sleep/wake monitoring stopped');
    }

    /**
     * Add an event listener for pool events.
     */
    public on(listener: RelayPoolListener): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Emit an event to all listeners.
     */
    private emit(event: RelayPoolEvent): void {
        for (const listener of this.listeners) {
            try {
                listener(event);
            } catch (error) {
                debug('listener error: %s', toErrorMessage(error));
            }
        }
    }

    /**
     * Run heartbeat check for sleep/wake detection.
     */
    private runHeartbeat(): void {
        const now = Date.now();
        const elapsed = now - this.lastHeartbeat;
        this.lastHeartbeat = now;

        debug('heartbeat: %dms elapsed (expected ~%dms)', elapsed, RELAY_HEARTBEAT_INTERVAL_MS);

        // Check for time jump (sleep/wake detection)
        if (elapsed > RELAY_SLEEP_DETECTION_THRESHOLD_MS) {
            const sleepDuration = Math.round((elapsed - RELAY_HEARTBEAT_INTERVAL_MS) / 1000);
            logger.info('System wake detected, resetting relay pool', { sleepDurationSec: sleepDuration });
            this.emit({ type: 'sleep-detected', data: { sleepDuration } });

            // Reset the pool to clear stale connections
            this.resetPool();
        }
    }

    /**
     * Get the list of relay URLs.
     */
    public getRelays(): string[] {
        return [...this.relays];
    }

    /**
     * Subscribe to events matching a filter.
     * Returns a cleanup function to close the subscription.
     *
     * @param filter - The filter to match events against
     * @param onEvent - Callback for each matching event
     * @param subscriptionId - Unique ID for this subscription
     * @param onEose - Optional callback when EOSE is received
     * @param customRelays - Optional custom relays to use (defaults to pool's configured relays)
     */
    public subscribe(
        filter: SubscriptionFilter,
        onEvent: (event: Event) => void,
        subscriptionId: string,
        onEose?: () => void,
        customRelays?: string[]
    ): () => void {
        // Close existing subscription with same ID if any
        const existing = this.subscriptions.get(subscriptionId);
        if (existing) {
            debug('closing existing subscription %s', subscriptionId);
            existing.close();
            this.subscriptions.delete(subscriptionId);
        }

        const relaysToUse = customRelays ?? this.relays;
        debug('creating subscription %s on %d relays with filter %o', subscriptionId, relaysToUse.length, filter);

        const sub = this.pool.subscribeMany(
            relaysToUse,
            filter,
            {
                onevent: (event) => {
                    debug('received event %s on subscription %s', event.id?.slice(0, 8), subscriptionId);
                    onEvent(event);
                },
                oneose: () => {
                    debug('EOSE received for subscription %s', subscriptionId);
                    // Mark all relays as connected when we receive EOSE
                    // (indicates at least one relay responded)
                    // Only mark pool's relays, not custom relays
                    if (!customRelays) {
                        this.markAllRelaysConnected();
                    }
                    onEose?.();
                },
                onclose: (reasons) => {
                    debug('subscription %s closed: %o', subscriptionId, reasons);
                },
            }
        );

        const cleanup = () => {
            sub.close();
            this.subscriptions.delete(subscriptionId);
            debug('subscription %s closed', subscriptionId);
        };

        this.subscriptions.set(subscriptionId, { id: subscriptionId, close: cleanup });

        return cleanup;
    }

    /**
     * Publish an event to relays.
     * Resolves when at least one relay accepts the event.
     * Throws if no relay accepts the event.
     *
     * @param event - The event to publish
     * @param customRelays - Optional custom relays to publish to (defaults to pool's configured relays)
     */
    public async publish(event: Event, customRelays?: string[]): Promise<{ successes: string[]; failures: Array<{ url: string; error: string }> }> {
        const relaysToUse = customRelays ?? this.relays;
        debug('publishing event %s (kind %d) to %d relays', event.id?.slice(0, 8), event.kind, relaysToUse.length);

        const results = await Promise.allSettled(
            this.pool.publish(relaysToUse, event)
        );

        const successes: string[] = [];
        const failures: Array<{ url: string; error: string }> = [];

        results.forEach((result, index) => {
            const relayUrl = relaysToUse[index];
            if (result.status === 'fulfilled') {
                successes.push(relayUrl);
                // Only update status for pool's configured relays
                if (this.relays.includes(relayUrl)) {
                    this.updateRelayStatus(relayUrl, true);
                }
                this.onPublishSuccess?.(event, relayUrl);
                debug('published to %s', relayUrl);
            } else {
                const errorMsg = result.reason?.message ?? String(result.reason);
                failures.push({ url: relayUrl, error: errorMsg });
                // Only update status for pool's configured relays
                if (this.relays.includes(relayUrl)) {
                    this.updateRelayStatus(relayUrl, false, errorMsg);
                }
                this.onPublishFailure?.(event, relayUrl, result.reason);
                debug('failed to publish to %s: %s', relayUrl, errorMsg);
            }
        });

        if (successes.length === 0) {
            throw new Error(`Failed to publish to any relay: ${failures.map(f => `${f.url}: ${f.error}`).join(', ')}`);
        }

        debug('published to %d/%d relays', successes.length, relaysToUse.length);
        return { successes, failures };
    }

    /**
     * Set callbacks for publish monitoring.
     */
    public setPublishCallbacks(
        onSuccess?: (event: Event, relay: string) => void,
        onFailure?: (event: Event, relay: string, error: Error) => void
    ): void {
        this.onPublishSuccess = onSuccess;
        this.onPublishFailure = onFailure;
    }

    /**
     * Set callback for relay status changes.
     */
    public setStatusChangeCallback(callback: () => void): void {
        this.onStatusChange = callback;
    }

    /**
     * Get current status of all relays.
     * Derives connected state from tracked timestamps since SimplePool's
     * listConnectionStatus() doesn't accurately reflect subscription connections.
     */
    public getStatus(): RelayStatus[] {
        // Derive connected state from timestamps
        // A relay is considered connected if lastConnected > lastDisconnected
        // or if lastConnected exists and lastDisconnected is null
        for (const url of this.relays) {
            const existing = this.relayStatus.get(url);
            if (existing) {
                const isConnected = existing.lastConnected !== null && (
                    existing.lastDisconnected === null ||
                    existing.lastConnected > existing.lastDisconnected
                );
                if (existing.connected !== isConnected) {
                    this.relayStatus.set(url, {
                        ...existing,
                        connected: isConnected,
                    });
                }
            }
        }

        return Array.from(this.relayStatus.values());
    }

    /**
     * Get count of connected relays.
     */
    public getConnectedCount(): number {
        // Use getStatus() to get accurate connected state
        return this.getStatus().filter(s => s.connected).length;
    }

    /**
     * Check if any relay is connected.
     */
    public hasConnectedRelay(): boolean {
        return this.getConnectedCount() > 0;
    }

    /**
     * Close all subscriptions and connections.
     */
    public close(): void {
        debug('closing relay pool');

        // Stop monitoring
        this.stopMonitoring();

        for (const [id, sub] of this.subscriptions) {
            debug('closing subscription %s', id);
            sub.close();
        }
        this.subscriptions.clear();

        this.pool.close(this.relays);
        debug('relay pool closed');
    }

    /**
     * Ensure connections are ready by attempting to connect to relays.
     * SimplePool handles this lazily, but this can be called proactively.
     */
    public async ensureConnected(): Promise<void> {
        // SimplePool connects lazily when subscribing or publishing.
        // We can trigger this by subscribing to a filter that won't match anything.
        // Or we just trust that publish/subscribe will connect as needed.
        debug('ensureConnected called - SimplePool connects lazily');
    }

    /**
     * Report a health check success. Resets the failure counter.
     */
    public reportHealthCheckSuccess(): void {
        if (this.consecutiveFailures > 0) {
            debug('health check passed, resetting failure counter from %d', this.consecutiveFailures);
        }
        this.consecutiveFailures = 0;
    }

    /**
     * Report a health check failure. May trigger pool reset if threshold exceeded.
     * @returns true if the pool was reset
     */
    public reportHealthCheckFailure(): boolean {
        this.consecutiveFailures++;
        debug('health check failed, consecutive failures: %d', this.consecutiveFailures);

        if (this.consecutiveFailures >= RELAY_WATCHDOG_FAILURE_THRESHOLD) {
            const now = Date.now();
            if (now - this.lastReset >= RELAY_WATCHDOG_RESET_COOLDOWN_MS) {
                logger.warn('Watchdog triggered pool reset', { consecutiveFailures: this.consecutiveFailures });
                this.resetPool();
                return true;
            } else {
                const cooldownRemaining = Math.round((RELAY_WATCHDOG_RESET_COOLDOWN_MS - (now - this.lastReset)) / 1000);
                debug('watchdog: in cooldown, %ds remaining', cooldownRemaining);
            }
        }
        return false;
    }

    /**
     * Force reset the underlying SimplePool. Closes all connections and creates a fresh pool.
     * Use this when the pool appears to be in a corrupted state.
     * Emits 'pool-reset' event so listeners can recreate subscriptions.
     */
    public resetPool(): void {
        logger.info('Pool reset initiated', { consecutiveFailures: this.consecutiveFailures });

        // Close the existing pool
        try {
            this.pool.close(this.relays);
        } catch (error) {
            logger.error('Error closing pool', { error: toErrorMessage(error) });
        }

        // Create a fresh pool
        this.pool = new SimplePool();
        this.consecutiveFailures = 0;
        this.lastReset = Date.now();

        // Reset all relay statuses
        for (const url of this.relays) {
            this.relayStatus.set(url, {
                url,
                connected: false,
                lastConnected: null,
                lastDisconnected: new Date(),
                lastError: 'Pool reset',
            });
        }

        logger.info('Pool reset complete');

        // Emit pool-reset event so SubscriptionManager can recreate subscriptions
        this.emit({ type: 'pool-reset' });
        this.onStatusChange?.();
    }

    /**
     * Get watchdog status for diagnostics.
     */
    public getWatchdogStatus(): { consecutiveFailures: number; lastReset: Date | null; threshold: number } {
        return {
            consecutiveFailures: this.consecutiveFailures,
            lastReset: this.lastReset > 0 ? new Date(this.lastReset) : null,
            threshold: RELAY_WATCHDOG_FAILURE_THRESHOLD,
        };
    }

    private updateRelayStatus(url: string, connected: boolean, error?: string): void {
        const existing = this.relayStatus.get(url);
        const previouslyConnected = existing?.connected ?? false;
        this.relayStatus.set(url, {
            url,
            connected,
            lastConnected: connected ? new Date() : (existing?.lastConnected ?? null),
            lastDisconnected: !connected && error ? new Date() : (existing?.lastDisconnected ?? null),
            lastError: error ?? null,
        });
        // Notify if connection state changed
        if (connected !== previouslyConnected) {
            this.onStatusChange?.();
        }
    }

    /**
     * Mark all relays as connected (called when EOSE received).
     */
    private markAllRelaysConnected(): void {
        const now = new Date();
        let anyChanged = false;
        for (const url of this.relays) {
            const existing = this.relayStatus.get(url);
            if (existing && !existing.connected) {
                this.relayStatus.set(url, {
                    ...existing,
                    connected: true,
                    lastConnected: now,
                });
                anyChanged = true;
            }
        }
        if (anyChanged) {
            this.onStatusChange?.();
        }
    }
}
