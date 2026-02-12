import React, { useState } from 'react';
import type { HealthStatus, RelayStatusResponse, KeyInfo } from '@signet/types';
import type { UIHealthStatus } from '../../hooks/useHealth.js';
import type { DeadManSwitchStatus } from '../../lib/api-client.js';
import { X, XCircle, ChevronDown, ChevronUp, Timer } from 'lucide-react';
import { formatUptime, formatRelativeTime } from '../../lib/formatters.js';
import styles from './SystemStatusModal.module.css';

interface SystemStatusModalProps {
    open: boolean;
    onClose: () => void;
    health: HealthStatus | null;
    uiStatus: UIHealthStatus;
    relayStatus: RelayStatusResponse | null;
    deadManSwitchStatus: DeadManSwitchStatus | null;
    deadManSwitchCountdown: string;
    deadManSwitchUrgency: 'normal' | 'warning' | 'critical';
    keys: KeyInfo[];
    onReset?: (keyName: string, passphrase: string) => Promise<{ ok: boolean; error?: string; remainingAttempts?: number }>;
}

const STATUS_LABELS: Record<UIHealthStatus, string> = {
    healthy: 'Healthy',
    degraded: 'Degraded',
    offline: 'Offline',
};

/**
 * Get CSS class for trust score badge based on score thresholds
 */
function getScoreClass(score: number): string {
    if (score >= 80) return styles.scoreExcellent;
    if (score >= 60) return styles.scoreGood;
    if (score >= 40) return styles.scoreFair;
    return styles.scorePoor;
}

export function SystemStatusModal({
    open,
    onClose,
    health,
    uiStatus,
    relayStatus,
    deadManSwitchStatus,
    deadManSwitchCountdown,
    deadManSwitchUrgency,
    keys,
    onReset,
}: SystemStatusModalProps) {
    const [relaysExpanded, setRelaysExpanded] = useState(false);
    const [resetDialogOpen, setResetDialogOpen] = useState(false);
    const [selectedKeyName, setSelectedKeyName] = useState('');
    const [passphrase, setPassphrase] = useState('');
    const [resetError, setResetError] = useState<string | null>(null);
    const [remainingAttempts, setRemainingAttempts] = useState<number | undefined>();
    const [resetting, setResetting] = useState(false);
    const now = Date.now();

    // Get encrypted keys for reset
    const encryptedKeys = keys.filter(k => k.isEncrypted);

    const handleReset = async () => {
        if (!onReset || !selectedKeyName || !passphrase) return;

        setResetting(true);
        setResetError(null);

        const result = await onReset(selectedKeyName, passphrase);

        setResetting(false);

        if (result.ok) {
            setResetDialogOpen(false);
            setPassphrase('');
            setSelectedKeyName('');
            setRemainingAttempts(undefined);
        } else {
            setResetError(result.error ?? 'Failed to reset timer');
            setRemainingAttempts(result.remainingAttempts);
        }
    };

    const openResetDialog = () => {
        // Pre-select first encrypted key if available
        if (encryptedKeys.length > 0 && !selectedKeyName) {
            setSelectedKeyName(encryptedKeys[0].name);
        }
        setResetDialogOpen(true);
    };

    const closeResetDialog = () => {
        setResetDialogOpen(false);
        setPassphrase('');
        setResetError(null);
        setRemainingAttempts(undefined);
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    if (!open) return null;

    const formatLastReset = (iso: string | null): string => {
        if (!iso) return 'Never';
        return formatRelativeTime(iso, now);
    };

    return (
        <div className={styles.backdrop} onClick={handleBackdropClick} role="presentation">
            <div className={styles.modal} role="dialog" aria-modal="true" aria-labelledby="status-modal-title">
                <div className={styles.header}>
                    <h2 id="status-modal-title" className={styles.title}>System Status</h2>
                    <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close">
                        <X size={20} />
                    </button>
                </div>

                <div className={styles.content}>
                    {/* Status Badge */}
                    <div className={`${styles.statusBadge} ${styles[`status_${uiStatus}`]}`}>
                        <span className={styles.statusDot} />
                        {STATUS_LABELS[uiStatus]}
                    </div>

                    {health ? (
                        <>
                            {/* Stats Grid */}
                            <div className={styles.statsGrid}>
                                <div className={styles.statItem}>
                                    <span className={styles.statLabel}>Uptime</span>
                                    <span className={styles.statValue}>{formatUptime(health.uptime)}</span>
                                </div>
                                <div className={styles.statItem}>
                                    <span className={styles.statLabel}>Memory</span>
                                    <span className={styles.statValue}>
                                        {health.memory.rssMB.toFixed(0)} MB
                                    </span>
                                </div>
                                <div className={styles.statItem}>
                                    <span className={styles.statLabel}>Active Listeners</span>
                                    <span className={styles.statValue}>{health.subscriptions}</span>
                                </div>
                                <div className={styles.statItem}>
                                    <span className={styles.statLabel}>Connected Clients</span>
                                    <span className={styles.statValue}>{health.sseClients}</span>
                                </div>
                                <div className={styles.statItem}>
                                    <span className={styles.statLabel}>Last Reset</span>
                                    <span className={styles.statValue}>{formatLastReset(health.lastPoolReset)}</span>
                                </div>
                                <div className={styles.statItem}>
                                    <span className={styles.statLabel}>Keys</span>
                                    <span className={styles.statValue}>
                                        {health.keys.active} active
                                        {health.keys.locked > 0 && `, ${health.keys.locked} locked`}
                                    </span>
                                </div>
                            </div>

                            {/* Relay Section */}
                            <button
                                type="button"
                                className={styles.relayHeader}
                                onClick={() => setRelaysExpanded(!relaysExpanded)}
                                aria-expanded={relaysExpanded}
                            >
                                <span className={styles.relayHeaderText}>
                                    Relays ({health.relays.connected}/{health.relays.total} connected)
                                </span>
                                {relaysExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                            </button>

                            {relaysExpanded && relayStatus && (
                                <div className={styles.relayList}>
                                    {relayStatus.relays.map((relay) => (
                                        <div key={relay.url} className={styles.relayItem}>
                                            <div className={styles.relayInfo}>
                                                <span className={styles.relayUrl}>{relay.url}</span>
                                                <span className={styles.relayTime}>
                                                    {relay.connected
                                                        ? relay.lastConnected
                                                            ? `Connected ${formatRelativeTime(relay.lastConnected, now)}`
                                                            : 'Connected'
                                                        : relay.lastDisconnected
                                                            ? `Disconnected ${formatRelativeTime(relay.lastDisconnected, now)}`
                                                            : 'Disconnected'}
                                                </span>
                                            </div>
                                            {relay.connected ? (
                                                relay.trustScore !== null ? (
                                                    <span
                                                        className={`${styles.scoreBadge} ${getScoreClass(relay.trustScore)}`}
                                                        title={`Trust score: ${relay.trustScore}`}
                                                    >
                                                        {relay.trustScore}
                                                    </span>
                                                ) : (
                                                    <span
                                                        className={`${styles.scoreBadge} ${styles.scoreUnknown}`}
                                                        title="Trust score unavailable"
                                                    >
                                                        ?
                                                    </span>
                                                )
                                            ) : (
                                                <div className={`${styles.relayStatus} ${styles.disconnected}`}>
                                                    <XCircle size={18} />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Inactivity Lock Section */}
                            {deadManSwitchStatus?.enabled && (
                                <div className={styles.inactivitySection}>
                                    <div className={styles.inactivityHeader}>
                                        <div className={styles.inactivityInfo}>
                                            <Timer size={16} className={styles.inactivityIcon} />
                                            <span className={styles.inactivityLabel}>Inactivity Lock</span>
                                        </div>
                                        <span className={`${styles.inactivityCountdown} ${styles[`urgency_${deadManSwitchUrgency}`]}`}>
                                            {deadManSwitchCountdown}
                                        </span>
                                    </div>
                                    {onReset && encryptedKeys.length > 0 && (
                                        <button
                                            type="button"
                                            className={styles.resetButton}
                                            onClick={openResetDialog}
                                        >
                                            <Timer size={14} />
                                            Reset
                                        </button>
                                    )}
                                </div>
                            )}
                        </>
                    ) : (
                        <div className={styles.offlineMessage}>
                            Unable to connect to daemon
                        </div>
                    )}
                </div>
            </div>

            {/* Reset Inactivity Lock Dialog */}
            {resetDialogOpen && (
                <div className={styles.dialogOverlay} role="presentation">
                    <div className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby="reset-dialog-title">
                        <div className={styles.dialogHeader}>
                            <Timer size={20} className={styles.dialogIcon} />
                            <h3 id="reset-dialog-title" className={styles.dialogTitle}>Reset Inactivity Lock</h3>
                        </div>

                        <p className={styles.dialogDescription}>
                            Enter your key passphrase to reset the timer.
                        </p>

                        {encryptedKeys.length > 1 && (
                            <div className={styles.dialogField}>
                                <label htmlFor="reset-key-select" className={styles.dialogLabel}>
                                    Key
                                </label>
                                <select
                                    id="reset-key-select"
                                    className={styles.dialogSelect}
                                    value={selectedKeyName}
                                    onChange={(e) => setSelectedKeyName(e.target.value)}
                                    disabled={resetting}
                                >
                                    {encryptedKeys.map((key) => (
                                        <option key={key.name} value={key.name}>
                                            {key.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className={styles.dialogField}>
                            <label htmlFor="reset-passphrase" className={styles.dialogLabel}>
                                Passphrase for {selectedKeyName || encryptedKeys[0]?.name}
                            </label>
                            <input
                                id="reset-passphrase"
                                type="password"
                                className={styles.dialogInput}
                                value={passphrase}
                                onChange={(e) => setPassphrase(e.target.value)}
                                disabled={resetting}
                                placeholder="Enter passphrase"
                                autoComplete="current-password"
                            />
                        </div>

                        {resetError && (
                            <p className={styles.dialogError}>
                                {resetError}
                                {remainingAttempts !== undefined && remainingAttempts < 5 && (
                                    <span> ({remainingAttempts} attempts remaining)</span>
                                )}
                            </p>
                        )}

                        <div className={styles.dialogActions}>
                            <button
                                type="button"
                                className={styles.dialogCancelButton}
                                onClick={closeResetDialog}
                                disabled={resetting}
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                className={styles.dialogConfirmButton}
                                onClick={handleReset}
                                disabled={resetting || !passphrase}
                            >
                                {resetting ? 'Resetting...' : 'Reset Timer'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
