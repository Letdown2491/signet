/**
 * Lightweight structured logger with timestamps and log levels.
 *
 * Features:
 * - Automatic ISO timestamps on every log line
 * - Log levels with filtering (LOG_LEVEL env var)
 * - Structured data support: logger.info('message', { key: 'value' })
 * - JSON output mode for production (LOG_FORMAT=json)
 * - Child loggers for adding context
 * - In-memory ring buffer for log history (accessible via /logs API)
 * - SSE streaming for real-time log updates
 * - Zero dependencies, pino-compatible API
 *
 * Environment variables:
 * - LOG_LEVEL: 'debug' | 'info' | 'warn' | 'error' (default: 'info')
 * - LOG_FORMAT: 'json' | 'pretty' (default: 'pretty')
 *
 * Usage:
 *   import { logger } from './lib/logger.js';
 *   logger.info('Server started', { port: 3000 });
 *
 *   const keyLogger = logger.child({ keyName: 'alice' });
 *   keyLogger.info('Key online'); // Includes keyName in output
 */

import { logBuffer, type LogEntry } from './log-buffer.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

// Late-binding emitter to avoid circular dependency with EventService
let logEntryEmitter: ((entry: LogEntry) => void) | null = null;

/**
 * Set the SSE emitter for log entries.
 * Called during daemon initialization after EventService is ready.
 */
export function setLogEntryEmitter(emitter: (entry: LogEntry) => void): void {
    logEntryEmitter = emitter;
}

interface LogData {
    [key: string]: unknown;
}

interface Logger {
    debug: (msg: string, data?: LogData) => void;
    info: (msg: string, data?: LogData) => void;
    warn: (msg: string, data?: LogData) => void;
    error: (msg: string, data?: LogData) => void;
    child: (bindings: LogData) => Logger;
}

const LEVELS: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
};

const LEVEL_NAMES: Record<LogLevel, string> = {
    debug: 'DEBUG',
    info: 'INFO',
    warn: 'WARN',
    error: 'ERROR',
};

function getLogLevel(): LogLevel {
    const envLevel = process.env.LOG_LEVEL?.toLowerCase();
    if (envLevel && envLevel in LEVELS) {
        return envLevel as LogLevel;
    }
    return 'info';
}

function isJsonFormat(): boolean {
    return process.env.LOG_FORMAT?.toLowerCase() === 'json';
}

function formatMessage(
    level: LogLevel,
    msg: string,
    data?: LogData,
    bindings?: LogData
): string {
    const timestamp = new Date().toISOString();
    const mergedData = { ...bindings, ...data };
    const hasData = Object.keys(mergedData).length > 0;

    if (isJsonFormat()) {
        return JSON.stringify({
            time: timestamp,
            level,
            msg,
            ...(hasData ? mergedData : {}),
        });
    }

    // Pretty format: [timestamp] LEVEL: message {data}
    const dataStr = hasData ? ` ${JSON.stringify(mergedData)}` : '';
    return `[${timestamp}] ${LEVEL_NAMES[level]}: ${msg}${dataStr}`;
}

function shouldLog(level: LogLevel): boolean {
    return LEVELS[level] >= LEVELS[getLogLevel()];
}

function log(level: LogLevel, msg: string, data?: LogData, bindings?: LogData): void {
    if (!shouldLog(level)) {
        return;
    }

    const timestamp = new Date().toISOString();
    const mergedData = { ...bindings, ...data };
    const hasData = Object.keys(mergedData).length > 0;

    // Output to console
    const formatted = formatMessage(level, msg, data, bindings);
    if (level === 'error') {
        console.error(formatted);
    } else if (level === 'warn') {
        console.warn(formatted);
    } else {
        console.log(formatted);
    }

    // Push to ring buffer
    const entry: LogEntry = {
        timestamp,
        level,
        message: msg,
        ...(hasData ? { data: mergedData } : {}),
    };
    logBuffer.push(entry);

    // Emit SSE event if emitter is registered
    if (logEntryEmitter) {
        logEntryEmitter(entry);
    }
}

function createLogger(bindings?: LogData): Logger {
    return {
        debug: (msg: string, data?: LogData) => log('debug', msg, data, bindings),
        info: (msg: string, data?: LogData) => log('info', msg, data, bindings),
        warn: (msg: string, data?: LogData) => log('warn', msg, data, bindings),
        error: (msg: string, data?: LogData) => log('error', msg, data, bindings),
        child: (childBindings: LogData) => {
            return createLogger({ ...bindings, ...childBindings });
        },
    };
}

/**
 * Default logger instance.
 * Use logger.child() to create loggers with additional context.
 */
export const logger = createLogger();

/**
 * Create a new logger with specific bindings.
 * Useful for module-level loggers with consistent context.
 */
export function createChildLogger(bindings: LogData): Logger {
    return createLogger(bindings);
}
