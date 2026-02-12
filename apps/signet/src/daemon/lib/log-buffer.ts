/**
 * Ring buffer for storing recent log entries in memory.
 * Used to provide log history via REST API and real-time streaming via SSE.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    data?: Record<string, unknown>;
}

export interface LogFilterOptions {
    /** Minimum log level to include */
    level?: LogLevel;
    /** Text to search for in message (case-insensitive) */
    search?: string;
    /** Maximum number of entries to return */
    limit?: number;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

export class LogBuffer {
    private buffer: LogEntry[] = [];
    private readonly maxSize: number;

    constructor(maxSize = 1000) {
        this.maxSize = maxSize;
    }

    /**
     * Add a log entry to the buffer.
     * If buffer is full, removes oldest entry.
     */
    push(entry: LogEntry): void {
        this.buffer.push(entry);
        if (this.buffer.length > this.maxSize) {
            this.buffer.shift();
        }
    }

    /**
     * Get all entries in the buffer (oldest first).
     */
    getAll(): LogEntry[] {
        return [...this.buffer];
    }

    /**
     * Get entries matching the filter criteria.
     * Returns newest entries first (reversed order).
     */
    filter(options: LogFilterOptions = {}): LogEntry[] {
        const { level, search, limit = 100 } = options;
        const minLevel = level ? LOG_LEVEL_ORDER[level] : 0;
        const searchLower = search?.toLowerCase();

        let results = this.buffer.filter(entry => {
            // Filter by minimum level
            if (LOG_LEVEL_ORDER[entry.level] < minLevel) {
                return false;
            }

            // Filter by search text
            if (searchLower && !entry.message.toLowerCase().includes(searchLower)) {
                return false;
            }

            return true;
        });

        // Return newest first, limited to requested count
        return results.slice(-limit).reverse();
    }

    /**
     * Clear all entries from the buffer.
     */
    clear(): void {
        this.buffer = [];
    }

    /**
     * Get the current number of entries in the buffer.
     */
    get size(): number {
        return this.buffer.length;
    }

    /**
     * Get buffer statistics including estimated memory usage.
     */
    getStats(): { entries: number; maxEntries: number; estimatedBytes: number } {
        let estimatedBytes = 0;
        for (const entry of this.buffer) {
            // Base object overhead (~40 bytes)
            estimatedBytes += 40;
            // timestamp string
            estimatedBytes += entry.timestamp.length * 2;
            // level string
            estimatedBytes += entry.level.length * 2;
            // message string
            estimatedBytes += entry.message.length * 2;
            // data object (rough estimate)
            if (entry.data) {
                estimatedBytes += JSON.stringify(entry.data).length * 2;
            }
        }
        return {
            entries: this.buffer.length,
            maxEntries: this.maxSize,
            estimatedBytes,
        };
    }
}

// Singleton instance for the daemon
export const logBuffer = new LogBuffer();
