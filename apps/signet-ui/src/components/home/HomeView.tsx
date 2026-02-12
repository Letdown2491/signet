import React, { useState } from 'react';
import type { DisplayRequest, DashboardStats, TrustLevel, RelayStatusResponse, MixedActivityEntry, HealthStatus, KeyInfo } from '@signet/types';
import type { UIHealthStatus } from '../../hooks/useHealth.js';
import type { DeadManSwitchStatus } from '../../lib/api-client.js';
import { Key } from 'lucide-react';
import { PageHeader } from '../shared/PageHeader.js';
import { SkeletonStatCard, SkeletonCard } from '../shared/Skeleton.js';
import { SystemStatusModal } from '../shared/SystemStatusModal.js';
import { StatsRow } from './StatsRow.js';
import { PendingRequestsList } from './PendingRequestsList.js';
import { RecentActivityFeed } from './RecentActivityFeed.js';
import styles from './HomeView.module.css';

interface HomeViewProps {
  requests: DisplayRequest[];
  stats: DashboardStats | null;
  activity: MixedActivityEntry[];
  loading: boolean;
  health: HealthStatus | null;
  uiStatus: UIHealthStatus;
  relayStatus: RelayStatusResponse | null;
  deadManSwitchStatus: DeadManSwitchStatus | null;
  deadManSwitchCountdown: string;
  deadManSwitchUrgency: 'normal' | 'warning' | 'critical';
  keys: KeyInfo[];
  passwords: Record<string, string>;
  appNames: Record<string, string>;
  showAutoApproved: boolean;
  onPasswordChange: (requestId: string, password: string) => void;
  onAppNameChange: (requestId: string, appName: string) => void;
  onApprove: (requestId: string, trustLevel?: TrustLevel, alwaysAllow?: boolean, allowKind?: number, appName?: string) => Promise<void>;
  onDeny: (requestId: string) => Promise<void>;
  onViewDetails: (request: DisplayRequest) => void;
  onNavigateToActivity: () => void;
  onNavigateToKeys: () => void;
  onNavigateToApps: () => void;
  onToggleShowAutoApproved: () => void;
  onReset?: (keyName: string, passphrase: string) => Promise<{ ok: boolean; error?: string; remainingAttempts?: number }>;
}

export function HomeView({
  requests,
  stats,
  activity,
  loading,
  health,
  uiStatus,
  relayStatus,
  deadManSwitchStatus,
  deadManSwitchCountdown,
  deadManSwitchUrgency,
  keys,
  passwords,
  appNames,
  showAutoApproved,
  onPasswordChange,
  onAppNameChange,
  onApprove,
  onDeny,
  onViewDetails,
  onNavigateToActivity,
  onNavigateToKeys,
  onNavigateToApps,
  onToggleShowAutoApproved,
  onReset,
}: HomeViewProps) {
  const [statusModalOpen, setStatusModalOpen] = useState(false);

  if (loading) {
    return (
      <div className={styles.container}>
        <PageHeader title="Dashboard" />

        {/* Skeleton Stats */}
        <section className={styles.statsSection}>
          <div className={styles.statsGrid}>
            <SkeletonStatCard />
            <SkeletonStatCard />
            <SkeletonStatCard />
            <SkeletonStatCard />
          </div>
        </section>

        {/* Skeleton Pending */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Pending</h2>
          <div className={styles.skeletonList}>
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </section>

        {/* Skeleton Recent */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Recent</h2>
          <div className={styles.skeletonList}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <PageHeader title="Dashboard" />

      <StatsRow
        stats={stats}
        health={health}
        uiStatus={uiStatus}
        onStatusClick={() => setStatusModalOpen(true)}
        onKeysClick={onNavigateToKeys}
        onAppsClick={onNavigateToApps}
        onActivityClick={onNavigateToActivity}
      />

      <SystemStatusModal
        open={statusModalOpen}
        onClose={() => setStatusModalOpen(false)}
        health={health}
        uiStatus={uiStatus}
        relayStatus={relayStatus}
        deadManSwitchStatus={deadManSwitchStatus}
        deadManSwitchCountdown={deadManSwitchCountdown}
        deadManSwitchUrgency={deadManSwitchUrgency}
        keys={keys}
        onReset={onReset}
      />

      {/* Onboarding - show when no keys exist at all */}
      {stats?.totalKeys === 0 && (
        <section className={styles.onboardingSection}>
          <div className={styles.onboardingCard}>
            <div className={styles.onboardingIcon}>
              <Key size={32} />
            </div>
            <h2 className={styles.onboardingTitle}>Welcome to Signet</h2>
            <p className={styles.onboardingText}>
              Create your first signing key to start using Signet as a remote signer for your Nostr apps.
            </p>
            <button type="button" className={styles.onboardingButton} onClick={onNavigateToKeys}>
              <Key size={16} />
              Create Your First Key
            </button>
          </div>
        </section>
      )}

      {/* Only show Pending and Recent when there are keys */}
      {(stats?.totalKeys ?? 0) > 0 && (
        <>
          <PendingRequestsList
            requests={requests}
            passwords={passwords}
            appNames={appNames}
            onPasswordChange={onPasswordChange}
            onAppNameChange={onAppNameChange}
            onApprove={onApprove}
            onDeny={onDeny}
            onViewDetails={onViewDetails}
          />

          <RecentActivityFeed
            activity={activity}
            showAutoApproved={showAutoApproved}
            onToggleShowAutoApproved={onToggleShowAutoApproved}
            onNavigateToActivity={onNavigateToActivity}
          />
        </>
      )}
    </div>
  );
}
