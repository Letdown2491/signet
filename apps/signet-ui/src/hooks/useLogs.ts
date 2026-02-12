import { useState, useCallback, useEffect, useMemo } from 'react';
import type { LogEntry, LogLevel, LogsResponse } from '@signet/types';
import { apiGet } from '../lib/api-client.js';
import { buildErrorMessage } from '../lib/formatters.js';
import { useSSESubscription } from '../contexts/ServerEventsContext.js';
import type { ServerEvent } from './useServerEvents.js';

const MAX_DISPLAY_LOGS = 200;
const INITIAL_FETCH_LIMIT = 100;

export interface UseLogsResult {
    logs: LogEntry[];
    loading: boolean;
    error: string | null;
    // Filters
    levelFilter: LogLevel | null;
    setLevelFilter: (level: LogLevel | null) => void;
    searchQuery: string;
    setSearchQuery: (query: string) => void;
    // Actions
    refresh: () => Promise<void>;
    clear: () => void;
    // State
    paused: boolean;
    setPaused: (paused: boolean) => void;
}

export function useLogs(): UseLogsResult {
    const [logs, setLogs] = useState<LogEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [levelFilter, setLevelFilter] = useState<LogLevel | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [paused, setPaused] = useState(false);

    // Fetch initial logs
    const fetchLogs = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            const params = new URLSearchParams();
            params.set('limit', String(INITIAL_FETCH_LIMIT));
            if (levelFilter) {
                params.set('level', levelFilter);
            }
            if (searchQuery) {
                params.set('search', searchQuery);
            }

            const response = await apiGet<LogsResponse>(`/logs?${params.toString()}`);
            setLogs(response.logs);
        } catch (err) {
            setError(buildErrorMessage(err, 'Failed to fetch logs'));
        } finally {
            setLoading(false);
        }
    }, [levelFilter, searchQuery]);

    // Initial fetch
    useEffect(() => {
        fetchLogs();
    }, [fetchLogs]);

    // Handle SSE log events
    const handleEvent = useCallback((event: ServerEvent) => {
        if (event.type === 'log:entry' && !paused) {
            setLogs(prev => {
                // Prepend new entry and cap at max display
                const updated = [event.entry, ...prev];
                return updated.slice(0, MAX_DISPLAY_LOGS);
            });
        } else if (event.type === 'reconnected') {
            // Refresh logs on reconnect to catch any missed entries
            fetchLogs();
        }
    }, [paused, fetchLogs]);

    useSSESubscription(handleEvent);

    // Filter logs client-side for real-time updates
    const filteredLogs = useMemo(() => {
        let result = logs;

        // Filter by level
        if (levelFilter) {
            const levelOrder: Record<LogLevel, number> = {
                debug: 0,
                info: 1,
                warn: 2,
                error: 3,
            };
            const minLevel = levelOrder[levelFilter];
            result = result.filter(log => levelOrder[log.level] >= minLevel);
        }

        // Filter by search query
        if (searchQuery) {
            const query = searchQuery.toLowerCase();
            result = result.filter(log =>
                log.message.toLowerCase().includes(query) ||
                (log.data && JSON.stringify(log.data).toLowerCase().includes(query))
            );
        }

        return result;
    }, [logs, levelFilter, searchQuery]);

    const clear = useCallback(() => {
        setLogs([]);
    }, []);

    return {
        logs: filteredLogs,
        loading,
        error,
        levelFilter,
        setLevelFilter,
        searchQuery,
        setSearchQuery,
        refresh: fetchLogs,
        clear,
        paused,
        setPaused,
    };
}
