// Log types for the Logs API

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    message: string;
    data?: Record<string, unknown>;
}

export interface LogsResponse {
    logs: LogEntry[];
}

export interface LogFilterParams {
    /** Minimum log level to include */
    level?: LogLevel;
    /** Text to search for in message (case-insensitive) */
    search?: string;
    /** Maximum number of entries to return (default: 100) */
    limit?: number;
}
