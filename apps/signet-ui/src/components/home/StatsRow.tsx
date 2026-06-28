import React from 'react';
import type { DashboardStats, HealthStatus } from '@signet/types';
import type { UIHealthStatus } from '../../hooks/useHealth.js';
import { HeartPulse, Key, Smartphone, Clock } from 'lucide-react';
import { formatUptime } from '../../lib/formatters.js';
import styles from './HomeView.module.css';

interface StatsRowProps {
  stats: DashboardStats | null;
  health: HealthStatus | null;
  uiStatus: UIHealthStatus;
  onStatusClick?: () => void;
  onKeysClick?: () => void;
  onAppsClick?: () => void;
  onActivityClick?: () => void;
}

const STATUS_LABELS: Record<UIHealthStatus, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  offline: 'Offline',
};

export function StatsRow({
  stats,
  health,
  uiStatus,
  onStatusClick,
  onKeysClick,
  onAppsClick,
  onActivityClick
}: StatsRowProps) {
  // Map status to icon style class
  const statusIconClass = uiStatus === 'healthy'
    ? styles.statIconHealthy
    : uiStatus === 'degraded'
      ? styles.statIconDegraded
      : styles.statIconOffline;

  // Format uptime or show dash if offline
  const uptimeDisplay = health ? formatUptime(health.uptime) : '-';

  return (
    <section className={styles.statsSection}>
      <div className={styles.statsGrid}>
        <button
          type="button"
          className={`${styles.statCard} ${styles.statCardClickable}`}
          onClick={onKeysClick}
          aria-label="View keys"
        >
          <div className={`${styles.statIcon} ${styles.statIconKeys}`}>
            <Key size={24} />
          </div>
          <div className={styles.statContent}>
            <span className={styles.statValue}>
              {stats ? (stats.totalKeys === 0 ? '0' : `${stats.activeKeys}/${stats.totalKeys}`) : '-'}
            </span>
            <span className={styles.statLabel}>Active Keys</span>
          </div>
        </button>

        <button
          type="button"
          className={`${styles.statCard} ${styles.statCardClickable}`}
          onClick={onAppsClick}
          aria-label="View apps"
        >
          <div className={`${styles.statIcon} ${styles.statIconApps}`}>
            <Smartphone size={24} />
          </div>
          <div className={styles.statContent}>
            <span className={styles.statValue}>{stats?.connectedApps ?? '-'}</span>
            <span className={styles.statLabel}>Apps</span>
          </div>
        </button>

        <button
          type="button"
          className={`${styles.statCard} ${styles.statCardClickable}`}
          onClick={onActivityClick}
          aria-label="View activity"
        >
          <div className={`${styles.statIcon} ${styles.statIconActivity}`}>
            <Clock size={24} />
          </div>
          <div className={styles.statContent}>
            <span className={styles.statValue}>{stats?.recentActivity24h ?? '-'}</span>
            <span className={styles.statLabel}>Last 24h</span>
          </div>
        </button>

        <button
          type="button"
          className={`${styles.statCard} ${styles.statCardClickable}`}
          onClick={onStatusClick}
          aria-label="View system status"
        >
          <div className={`${styles.statIcon} ${statusIconClass}`}>
            <HeartPulse size={24} />
          </div>
          <div className={styles.statContent}>
            <span className={styles.statValue}>{STATUS_LABELS[uiStatus]}</span>
            <span className={styles.statLabel}>{health ? `Up ${uptimeDisplay}` : 'No connection'}</span>
          </div>
        </button>
      </div>
    </section>
  );
}
