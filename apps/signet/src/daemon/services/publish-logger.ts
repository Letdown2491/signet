import type { Event } from 'nostr-tools/pure';
import type { RelayPool } from '../lib/relay-pool.js';
import { logger } from '../lib/logger.js';

/**
 * Logs NIP-46 response publishing for debugging.
 * Hooks into RelayPool's publish callbacks to track success/failure.
 */
export class PublishLogger {
    private readonly pool: RelayPool;
    private enabled = false;

    // Track publish stats
    private stats = {
        totalPublished: 0,
        totalFailed: 0,
        byRelay: new Map<string, { published: number; failed: number }>(),
    };

    constructor(pool: RelayPool) {
        this.pool = pool;
    }

    /**
     * Start logging publish events
     */
    public start(): void {
        if (this.enabled) {
            return;
        }

        this.enabled = true;

        // Initialize stats for all relays
        for (const url of this.pool.getRelays()) {
            this.stats.byRelay.set(url, { published: 0, failed: 0 });
        }

        // Set up publish callbacks
        this.pool.setPublishCallbacks(
            (event: Event, relay: string) => this.onPublishSuccess(event, relay),
            (event: Event, relay: string, error: Error) => this.onPublishFailure(event, relay, error)
        );

        logger.info('Publish logging enabled');
    }

    /**
     * Stop logging publish events
     */
    public stop(): void {
        if (!this.enabled) {
            return;
        }

        this.enabled = false;
        this.pool.setPublishCallbacks(undefined, undefined);
        logger.info('Publish logging disabled');
    }

    /**
     * Get publish statistics
     */
    public getStats(): typeof this.stats {
        return {
            ...this.stats,
            byRelay: new Map(this.stats.byRelay),
        };
    }

    /**
     * Reset statistics
     */
    public resetStats(): void {
        this.stats = {
            totalPublished: 0,
            totalFailed: 0,
            byRelay: new Map(),
        };

        // Re-initialize for all relays
        for (const url of this.pool.getRelays()) {
            this.stats.byRelay.set(url, { published: 0, failed: 0 });
        }
    }

    private onPublishSuccess(event: Event, relay: string): void {
        if (!this.enabled) return;

        this.stats.totalPublished++;
        const relayStat = this.stats.byRelay.get(relay);
        if (relayStat) {
            relayStat.published++;
        } else {
            this.stats.byRelay.set(relay, { published: 1, failed: 0 });
        }

        logger.debug('Published event', { kind: event.kind, relay, eventId: event.id?.slice(0, 8) });
    }

    private onPublishFailure(event: Event, relay: string, error: Error): void {
        if (!this.enabled) return;

        this.stats.totalFailed++;
        const relayStat = this.stats.byRelay.get(relay);
        if (relayStat) {
            relayStat.failed++;
        } else {
            this.stats.byRelay.set(relay, { published: 0, failed: 1 });
        }

        logger.warn('Failed to publish event', { kind: event.kind, relay, error: error.message, eventId: event.id?.slice(0, 8) });
    }

    /**
     * Print a summary of publish stats
     */
    public printSummary(): void {
        const byRelay: Record<string, { published: number; failed: number }> = {};
        for (const [url, stat] of this.stats.byRelay) {
            byRelay[url] = stat;
        }
        logger.info('Publish statistics', {
            totalPublished: this.stats.totalPublished,
            totalFailed: this.stats.totalFailed,
            byRelay,
        });
    }
}
