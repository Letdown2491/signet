import React, { useState } from 'react';
import type { LogEntry, LogLevel } from '@signet/types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatRelativeTime } from '../../lib/formatters.js';
import styles from './LogsPanel.module.css';

interface LogEntryRowProps {
    entry: LogEntry;
}

const LEVEL_STYLES: Record<LogLevel, string> = {
    debug: styles.levelDebug,
    info: styles.levelInfo,
    warn: styles.levelWarn,
    error: styles.levelError,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
    debug: 'DBG',
    info: 'INF',
    warn: 'WRN',
    error: 'ERR',
};

export function LogEntryRow({ entry }: LogEntryRowProps) {
    const [expanded, setExpanded] = useState(false);
    const hasData = entry.data && Object.keys(entry.data).length > 0;

    const toggleExpanded = () => {
        if (hasData) {
            setExpanded(!expanded);
        }
    };

    const formattedTime = formatRelativeTime(entry.timestamp, Date.now());
    const absoluteTime = new Date(entry.timestamp).toLocaleString();

    return (
        <div className={`${styles.logEntry} ${LEVEL_STYLES[entry.level]}`}>
            <div
                className={`${styles.logRow} ${hasData ? styles.clickable : ''}`}
                onClick={toggleExpanded}
                role={hasData ? 'button' : undefined}
                tabIndex={hasData ? 0 : undefined}
                onKeyDown={hasData ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleExpanded();
                    }
                } : undefined}
                aria-expanded={hasData ? expanded : undefined}
            >
                {hasData && (
                    <span className={styles.expandIcon}>
                        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                )}

                <span className={`${styles.levelBadge} ${LEVEL_STYLES[entry.level]}`}>
                    {LEVEL_LABELS[entry.level]}
                </span>

                <span className={styles.timestamp} title={absoluteTime}>
                    {formattedTime}
                </span>

                <span className={styles.message}>{entry.message}</span>
            </div>

            {expanded && hasData && (
                <div className={styles.dataBlock}>
                    <pre className={styles.dataContent}>
                        {JSON.stringify(entry.data, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    );
}
