/**
 * Statistics for a single cache instance.
 */
export interface CacheStats {
    size: number;
    hits: number;
    misses: number;
    evictions: number;
}

/**
 * Health status returned by the /health endpoint.
 */
export interface HealthStatus {
    status: 'ok' | 'degraded';
    uptime: number;
    memory: {
        heapMB: number;
        rssMB: number;
    };
    relays: {
        connected: number;
        total: number;
    };
    keys: {
        active: number;
        locked: number;
        offline: number;
    };
    subscriptions: number;
    sseClients: number;
    lastPoolReset: string | null;
    caches?: Record<string, CacheStats>;
    logBuffer?: {
        entries: number;
        maxEntries: number;
        estimatedKB: number;
    };
}
