import React, { useRef, useEffect, useState } from 'react';
import type { LogLevel } from '@signet/types';
import { Terminal, Search, Trash2, Pause, Play, RefreshCw } from 'lucide-react';
import { useLogs } from '../../hooks/useLogs.js';
import { LoadingSpinner } from '../shared/LoadingSpinner.js';
import { PageHeader } from '../shared/PageHeader.js';
import { LogEntryRow } from './LogEntryRow.js';
import styles from './LogsPanel.module.css';

const LOG_LEVELS: { value: LogLevel | ''; label: string }[] = [
    { value: '', label: 'All Levels' },
    { value: 'debug', label: 'Debug' },
    { value: 'info', label: 'Info' },
    { value: 'warn', label: 'Warning' },
    { value: 'error', label: 'Error' },
];

export function LogsPanel() {
    const {
        logs,
        loading,
        error,
        levelFilter,
        setLevelFilter,
        searchQuery,
        setSearchQuery,
        refresh,
        clear,
        paused,
        setPaused,
    } = useLogs();

    const [autoScroll, setAutoScroll] = useState(true);
    const logsContainerRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to top when new logs arrive (if enabled)
    useEffect(() => {
        if (autoScroll && logsContainerRef.current && !paused) {
            logsContainerRef.current.scrollTop = 0;
        }
    }, [logs, autoScroll, paused]);

    const handleLevelChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = e.target.value as LogLevel | '';
        setLevelFilter(value || null);
    };

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setSearchQuery(e.target.value);
    };

    return (
        <div className={styles.container}>
            <PageHeader title="Logs" />

            <div className={styles.toolbar}>
                <div className={styles.filters}>
                    <div className={styles.searchWrapper}>
                        <Search className={styles.searchIcon} size={16} />
                        <input
                            type="text"
                            placeholder="Search logs..."
                            value={searchQuery}
                            onChange={handleSearchChange}
                            className={styles.searchInput}
                            aria-label="Search logs"
                        />
                    </div>

                    <select
                        value={levelFilter || ''}
                        onChange={handleLevelChange}
                        className={styles.levelSelect}
                        aria-label="Filter by log level"
                    >
                        {LOG_LEVELS.map(level => (
                            <option key={level.value} value={level.value}>
                                {level.label}
                            </option>
                        ))}
                    </select>
                </div>

                <div className={styles.actions}>
                    <button
                        type="button"
                        onClick={() => setPaused(!paused)}
                        className={`${styles.actionButton} ${paused ? styles.paused : ''}`}
                        title={paused ? 'Resume live updates' : 'Pause live updates'}
                        aria-label={paused ? 'Resume live updates' : 'Pause live updates'}
                    >
                        {paused ? <Play size={16} /> : <Pause size={16} />}
                    </button>

                    <button
                        type="button"
                        onClick={refresh}
                        className={styles.actionButton}
                        disabled={loading}
                        title="Refresh logs"
                        aria-label="Refresh logs"
                    >
                        <RefreshCw size={16} className={loading ? styles.spinning : ''} />
                    </button>

                    <button
                        type="button"
                        onClick={clear}
                        className={styles.actionButton}
                        title="Clear logs"
                        aria-label="Clear logs"
                    >
                        <Trash2 size={16} />
                    </button>

                    <label className={styles.autoScrollLabel}>
                        <input
                            type="checkbox"
                            checked={autoScroll}
                            onChange={(e) => setAutoScroll(e.target.checked)}
                            className={styles.checkbox}
                        />
                        <span>Auto-scroll</span>
                    </label>
                </div>
            </div>

            {error && (
                <div className={styles.error} role="alert">
                    {error}
                </div>
            )}

            {paused && (
                <div className={styles.pausedBanner} role="status">
                    Live updates paused
                </div>
            )}

            <div className={styles.logsContainer} ref={logsContainerRef}>
                {loading && logs.length === 0 ? (
                    <div className={styles.loadingState}>
                        <LoadingSpinner />
                        <span>Loading logs...</span>
                    </div>
                ) : logs.length === 0 ? (
                    <div className={styles.emptyState}>
                        <Terminal size={48} className={styles.emptyIcon} />
                        <p>No logs to display</p>
                        <p className={styles.emptyHint}>
                            {searchQuery || levelFilter
                                ? 'Try adjusting your filters'
                                : 'Logs will appear here as the daemon runs'}
                        </p>
                    </div>
                ) : (
                    <div className={styles.logsList}>
                        {logs.map((log, index) => (
                            <LogEntryRow key={`${log.timestamp}-${index}`} entry={log} />
                        ))}
                    </div>
                )}
            </div>

            <div className={styles.footer}>
                <span className={styles.logCount}>
                    {logs.length} log{logs.length !== 1 ? 's' : ''}
                    {(searchQuery || levelFilter) && ' (filtered)'}
                </span>
            </div>
        </div>
    );
}
