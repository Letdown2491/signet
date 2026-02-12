import createDebug from 'debug';
import type { PendingRequest, ConnectedApp, DashboardStats, KeyInfo, RelayStatusResponse, ActivityEntry, LogEntry, HealthStatus } from '@signet/types';
import type { AdminActivityEntry } from '../repositories/admin-log-repository.js';
import { getDashboardService } from './dashboard-service.js';
import { logger } from '../lib/logger.js';

const debug = createDebug('signet:events');

/**
 * Server-sent event types for real-time updates
 */
export interface DeadManSwitchStatus {
    enabled: boolean;
    timeframeSec: number;
    lastResetAt: number | null;
    remainingSec: number | null;
    panicTriggeredAt: number | null;
}

export type ServerEvent =
    | { type: 'request:created'; request: PendingRequest }
    | { type: 'request:approved'; requestId: string; activity: ActivityEntry }
    | { type: 'request:denied'; requestId: string; activity: ActivityEntry }
    | { type: 'request:expired'; requestId: string }
    | { type: 'request:auto_approved'; activity: ActivityEntry }
    | { type: 'app:connected'; app: ConnectedApp }
    | { type: 'app:revoked'; appId: number }
    | { type: 'app:updated'; app: ConnectedApp }
    | { type: 'apps:updated' }
    | { type: 'key:created'; key: KeyInfo }
    | { type: 'key:unlocked'; keyName: string }
    | { type: 'key:locked'; keyName: string }
    | { type: 'key:deleted'; keyName: string }
    | { type: 'key:renamed'; oldName: string; newName: string }
    | { type: 'key:updated'; keyName: string }
    | { type: 'stats:updated'; stats: DashboardStats }
    | { type: 'relays:updated'; relays: RelayStatusResponse }
    | { type: 'admin:event'; activity: AdminActivityEntry }
    | { type: 'deadman:panic'; status: DeadManSwitchStatus }
    | { type: 'deadman:reset'; status: DeadManSwitchStatus }
    | { type: 'deadman:updated'; status: DeadManSwitchStatus }
    | { type: 'log:entry'; entry: LogEntry }
    | { type: 'health:updated'; health: HealthStatus }
    | { type: 'ping' };

export type EventCallback = (event: ServerEvent) => void;

/**
 * EventService provides a simple pub/sub mechanism for real-time events.
 * Subscribers receive events when requests are created, approved, denied,
 * or when apps connect.
 */
export class EventService {
    private subscribers: Set<EventCallback> = new Set();

    /**
     * Subscribe to all server events
     * @returns Unsubscribe function
     */
    subscribe(callback: EventCallback): () => void {
        this.subscribers.add(callback);
        return () => {
            this.subscribers.delete(callback);
        };
    }

    /**
     * Get the number of active subscribers
     */
    getSubscriberCount(): number {
        return this.subscribers.size;
    }

    /**
     * Emit an event to all subscribers
     */
    emit(event: ServerEvent): void {
        debug('Emitting event %s to %d subscribers', event.type, this.subscribers.size);
        for (const callback of this.subscribers) {
            try {
                callback(event);
            } catch (error) {
                logger.error('Error in event subscriber', { error: error instanceof Error ? error.message : String(error) });
            }
        }
    }

    /**
     * Emit a request:created event
     */
    emitRequestCreated(request: PendingRequest): void {
        this.emit({ type: 'request:created', request });
    }

    /**
     * Emit a request:approved event
     */
    emitRequestApproved(requestId: string, activity: ActivityEntry): void {
        this.emit({ type: 'request:approved', requestId, activity });
    }

    /**
     * Emit a request:denied event
     */
    emitRequestDenied(requestId: string, activity: ActivityEntry): void {
        this.emit({ type: 'request:denied', requestId, activity });
    }

    /**
     * Emit a request:expired event
     */
    emitRequestExpired(requestId: string): void {
        this.emit({ type: 'request:expired', requestId });
    }

    /**
     * Emit an app:connected event
     */
    emitAppConnected(app: ConnectedApp): void {
        this.emit({ type: 'app:connected', app });
    }

    /**
     * Emit a stats:updated event
     */
    emitStatsUpdated(stats: DashboardStats): void {
        this.emit({ type: 'stats:updated', stats });
    }

    /**
     * Emit a key:created event
     */
    emitKeyCreated(key: KeyInfo): void {
        this.emit({ type: 'key:created', key });
    }

    /**
     * Emit a key:unlocked event
     */
    emitKeyUnlocked(keyName: string): void {
        this.emit({ type: 'key:unlocked', keyName });
    }

    /**
     * Emit a key:locked event
     */
    emitKeyLocked(keyName: string): void {
        this.emit({ type: 'key:locked', keyName });
    }

    /**
     * Emit a key:deleted event
     */
    emitKeyDeleted(keyName: string): void {
        this.emit({ type: 'key:deleted', keyName });
    }

    /**
     * Emit a relays:updated event
     */
    emitRelaysUpdated(relays: RelayStatusResponse): void {
        this.emit({ type: 'relays:updated', relays });
    }

    /**
     * Emit a request:auto_approved event
     */
    emitRequestAutoApproved(activity: ActivityEntry): void {
        this.emit({ type: 'request:auto_approved', activity });
    }

    /**
     * Emit an app:revoked event
     */
    emitAppRevoked(appId: number): void {
        this.emit({ type: 'app:revoked', appId });
    }

    /**
     * Emit an app:updated event
     */
    emitAppUpdated(app: ConnectedApp): void {
        this.emit({ type: 'app:updated', app });
    }

    /**
     * Emit an apps:updated event (bulk change, clients should refetch)
     */
    emitAppsUpdated(): void {
        this.emit({ type: 'apps:updated' });
    }

    /**
     * Emit a key:renamed event
     */
    emitKeyRenamed(oldName: string, newName: string): void {
        this.emit({ type: 'key:renamed', oldName, newName });
    }

    /**
     * Emit a key:updated event (e.g., passphrase set)
     */
    emitKeyUpdated(keyName: string): void {
        this.emit({ type: 'key:updated', keyName });
    }

    /**
     * Emit an admin:event for admin activity (key lock/unlock, app suspend/unsuspend, daemon start)
     */
    emitAdminEvent(activity: AdminActivityEntry): void {
        this.emit({ type: 'admin:event', activity });
    }

    /**
     * Emit a deadman:panic event when the dead man's switch triggers
     */
    emitDeadmanPanic(status: DeadManSwitchStatus): void {
        this.emit({ type: 'deadman:panic', status });
    }

    /**
     * Emit a deadman:reset event when the timer is reset
     */
    emitDeadmanReset(status: DeadManSwitchStatus): void {
        this.emit({ type: 'deadman:reset', status });
    }

    /**
     * Emit a deadman:updated event when settings change
     */
    emitDeadmanUpdated(status: DeadManSwitchStatus): void {
        this.emit({ type: 'deadman:updated', status });
    }

    /**
     * Emit a log:entry event for real-time log streaming
     */
    emitLogEntry(entry: LogEntry): void {
        this.emit({ type: 'log:entry', entry });
    }

    /**
     * Emit a health:updated event for real-time health status
     */
    emitHealthUpdated(health: HealthStatus): void {
        this.emit({ type: 'health:updated', health });
    }
}

// Singleton instance for global access
let eventServiceInstance: EventService | null = null;

export function getEventService(): EventService {
    if (!eventServiceInstance) {
        eventServiceInstance = new EventService();
    }
    return eventServiceInstance;
}

export function setEventService(service: EventService): void {
    eventServiceInstance = service;
}

/**
 * Helper to fetch current stats and emit stats:updated event.
 * Call this after any operation that changes dashboard stats.
 * Debounced to prevent spamming clients when multiple operations happen in quick succession.
 */
let statsDebounceTimer: ReturnType<typeof setTimeout> | null = null;
const STATS_DEBOUNCE_MS = 150;

export async function emitCurrentStats(): Promise<void> {
    // Clear any pending emission
    if (statsDebounceTimer) {
        clearTimeout(statsDebounceTimer);
    }

    // Schedule new emission after debounce period
    statsDebounceTimer = setTimeout(async () => {
        statsDebounceTimer = null;
        try {
            const dashboardService = getDashboardService();
            const eventService = getEventService();
            const stats = await dashboardService.getStats();
            eventService.emitStatsUpdated(stats);
        } catch (error) {
            // Log but don't throw - stats emission is not critical
            debug('Failed to emit current stats: %O', error);
        }
    }, STATS_DEBOUNCE_MS);
}

// Health status getter - set by Daemon on initialization
let healthStatusGetter: (() => HealthStatus) | null = null;

export function setHealthStatusGetter(getter: () => HealthStatus): void {
    healthStatusGetter = getter;
}

/**
 * Helper to emit current health status.
 * Call this after any operation that affects health (key unlock/lock, etc.)
 */
export function emitCurrentHealth(): void {
    if (!healthStatusGetter) {
        debug('Health status getter not set, skipping emit');
        return;
    }
    try {
        const eventService = getEventService();
        const health = healthStatusGetter();
        eventService.emitHealthUpdated(health);
    } catch (error) {
        // Log but don't throw - health emission is not critical
        debug('Failed to emit current health: %O', error);
    }
}
