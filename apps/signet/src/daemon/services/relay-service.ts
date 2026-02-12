import type { RelayPool, RelayStatus } from '../lib/relay-pool.js';
import { logger } from '../lib/logger.js';

/**
 * Monitors relay health and provides status to the UI.
 * Delegates to RelayPool for actual status tracking.
 */
export class RelayService {
    private readonly pool: RelayPool;
    private isRunning = false;

    constructor(pool: RelayPool) {
        this.pool = pool;
    }

    /**
     * Start monitoring relay health
     */
    public start(): void {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;
        logger.info('Relay health monitoring started');
    }

    /**
     * Stop monitoring relay health
     */
    public stop(): void {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        logger.info('Relay health monitoring stopped');
    }

    /**
     * Get current status of all relays
     */
    public getStatus(): RelayStatus[] {
        return this.pool.getStatus();
    }

    /**
     * Get count of connected relays
     */
    public getConnectedCount(): number {
        return this.pool.getConnectedCount();
    }

    /**
     * Check if any relay is connected
     */
    public hasConnectedRelay(): boolean {
        return this.pool.hasConnectedRelay();
    }

    /**
     * Force reconnect all disconnected relays.
     * Note: SimplePool handles reconnection internally, so this is mostly a no-op.
     */
    public async reconnectAll(): Promise<void> {
        await this.pool.ensureConnected();
    }

    /**
     * Force reset the relay pool and recreate all connections.
     * Use when connections are silently dead (e.g., after fail2ban/iptables changes).
     */
    public resetPool(): void {
        this.pool.resetPool();
    }
}
