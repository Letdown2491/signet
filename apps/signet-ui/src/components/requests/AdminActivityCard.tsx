import React from 'react';
import type { AdminActivityEntry } from '@signet/types';
import { getAdminEventIcon, getAdminEventLabel } from '../shared/Icons.js';
import { formatRelativeTime } from '../../lib/formatters.js';
import styles from './AdminActivityCard.module.css';

interface AdminActivityCardProps {
  entry: AdminActivityEntry;
}

export function AdminActivityCard({ entry }: AdminActivityCardProps) {
  const Icon = getAdminEventIcon(entry.eventType);
  const label = getAdminEventLabel(entry.eventType);
  const now = Date.now();

  // Build summary based on event type
  let summary = '';
  if (entry.eventType === 'key_locked' || entry.eventType === 'key_unlocked' ||
      entry.eventType === 'key_encrypted' || entry.eventType === 'key_migrated' ||
      entry.eventType === 'key_exported') {
    summary = entry.keyName || 'Unknown key';
  } else if (entry.eventType === 'app_connected' || entry.eventType === 'app_suspended' || entry.eventType === 'app_unsuspended') {
    summary = entry.appName || `App #${entry.appId}`;
  } else if (entry.eventType === 'daemon_started') {
    summary = entry.clientVersion ? `v${entry.clientVersion}` : 'Signet daemon';
  } else if (entry.eventType === 'status_checked') {
    summary = 'System status';
  } else if (entry.eventType === 'command_executed') {
    summary = entry.command || 'Unknown command';
  } else if (entry.eventType === 'auth_failed') {
    summary = 'Authentication';
  } else if (entry.eventType === 'panic_triggered') {
    summary = 'All keys locked';
  } else if (entry.eventType === 'deadman_reset') {
    summary = 'Timer';
  }

  // Build details line: summary • via source • timestamp
  const detailParts: string[] = [summary];

  if (entry.clientName === 'kill-switch') {
    detailParts.push('via Kill Switch');
  } else if (entry.ipAddress) {
    detailParts.push(`via ${entry.ipAddress}`);
  } else if (entry.clientName) {
    detailParts.push(`via ${entry.clientName}`);
  }

  detailParts.push(formatRelativeTime(entry.timestamp, now));

  return (
    <div className={styles.card}>
      <div className={styles.iconWrapper}>
        <Icon size={18} aria-hidden="true" />
      </div>
      <div className={styles.content}>
        <div className={styles.header}>
          <span className={styles.label}>{label}</span>
          <span className={styles.badge}>Admin</span>
        </div>
        <div className={styles.details}>
          {detailParts.join(' • ')}
        </div>
      </div>
    </div>
  );
}
