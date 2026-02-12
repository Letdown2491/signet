import React, { useState, useMemo } from 'react';
import type { ConnectedApp, TrustLevel, MethodBreakdown } from '@signet/types';
import { parseConnectPermissions, formatPermission } from '@signet/types';
import { toNpub, formatLastActive } from '../../lib/formatters.js';
import { getPermissionRisk, getTrustLevelInfo } from '../../lib/event-labels.js';
import { LoadingSpinner } from '../shared/LoadingSpinner.js';
import { ConfirmDialog } from '../shared/ConfirmDialog.js';
import { PageHeader } from '../shared/PageHeader.js';
import { SuspendAppModal } from './SuspendAppModal.js';
import { ChevronDown, ChevronRight, Search, Smartphone, Pause, Play, Plus, Loader2 } from 'lucide-react';
import styles from './AppsPanel.module.css';

const METHOD_COLORS: Record<keyof MethodBreakdown, string> = {
  sign_event: '#10b981',
  nip04_encrypt: '#3b82f6',
  nip04_decrypt: '#8b5cf6',
  nip44_encrypt: '#06b6d4',
  nip44_decrypt: '#a855f7',
  get_public_key: '#f59e0b',
  other: '#6b7280',
};

const METHOD_LABELS: Record<keyof MethodBreakdown, string> = {
  sign_event: 'Signed',
  nip04_encrypt: 'Legacy DM sent',
  nip04_decrypt: 'Legacy DM read',
  nip44_encrypt: 'Encrypted',
  nip44_decrypt: 'Decrypted',
  get_public_key: 'Identity',
  other: 'Other',
};

function MethodBreakdownBar({ breakdown }: { breakdown: MethodBreakdown }) {
  const entries = Object.entries(breakdown) as Array<[keyof MethodBreakdown, number]>;
  const nonZero = entries.filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]);
  const total = nonZero.reduce((sum, [, count]) => sum + count, 0);

  if (total === 0) return null;

  return (
    <div className={styles.methodBreakdown}>
      <div className={styles.methodBar}>
        {nonZero.map(([method, count]) => (
          <div
            key={method}
            className={styles.methodSegment}
            style={{
              width: `${(count / total) * 100}%`,
              backgroundColor: METHOD_COLORS[method],
            }}
          />
        ))}
      </div>
      <div className={styles.methodLegend}>
        {nonZero.slice(0, 3).map(([method, count]) => (
          <span key={method} className={styles.methodLegendItem}>
            <span className={styles.methodDot} style={{ backgroundColor: METHOD_COLORS[method] }} />
            {METHOD_LABELS[method]}: {count}
          </span>
        ))}
      </div>
    </div>
  );
}

type SortOption = 'recent' | 'requests' | 'name';

interface AppsPanelProps {
  apps: ConnectedApp[];
  loading: boolean;
  error: string | null;
  suspendingAll: boolean;
  resumingAll: boolean;
  onRevokeApp: (appId: number) => Promise<boolean>;
  onUpdateDescription: (appId: number, description: string) => Promise<boolean>;
  onUpdateTrustLevel: (appId: number, trustLevel: TrustLevel) => Promise<boolean>;
  onSuspendApp: (appId: number, until?: Date) => Promise<boolean>;
  onUnsuspendApp: (appId: number) => Promise<boolean>;
  onSuspendAllApps: (until?: Date) => Promise<{ success: boolean; suspendedCount?: number }>;
  onResumeAllApps: () => Promise<{ success: boolean; resumedCount?: number }>;
  onClearError: () => void;
  onOpenConnectModal: () => void;
}

export function AppsPanel({
  apps,
  loading,
  error,
  suspendingAll,
  resumingAll,
  onRevokeApp,
  onUpdateDescription,
  onUpdateTrustLevel,
  onSuspendApp,
  onUnsuspendApp,
  onSuspendAllApps,
  onResumeAllApps,
  onClearError,
  onOpenConnectModal,
}: AppsPanelProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [revokeConfirm, setRevokeConfirm] = useState<number | null>(null);
  const [suspendModalApp, setSuspendModalApp] = useState<ConnectedApp | null>(null);
  const [showSuspendAllModal, setShowSuspendAllModal] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const [trustMenuOpen, setTrustMenuOpen] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [keyFilter, setKeyFilter] = useState('all');
  const [sortBy, setSortBy] = useState<SortOption>('recent');

  // Calculate counts for bulk actions
  const activeAppsCount = useMemo(() => apps.filter(app => !app.suspendedAt).length, [apps]);
  const suspendedAppsCount = useMemo(() => apps.filter(app => !!app.suspendedAt).length, [apps]);
  const allSuspended = apps.length > 0 && suspendedAppsCount === apps.length;

  const keyNames = useMemo(() => {
    const names = new Set<string>();
    apps.forEach(app => names.add(app.keyName));
    return Array.from(names).sort();
  }, [apps]);

  const filteredApps = useMemo(() => {
    let result = apps;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(app =>
        app.description?.toLowerCase().includes(q) ||
        toNpub(app.userPubkey).toLowerCase().includes(q) ||
        app.keyName.toLowerCase().includes(q)
      );
    }

    if (keyFilter !== 'all') {
      result = result.filter(app => app.keyName === keyFilter);
    }

    return [...result].sort((a, b) => {
      switch (sortBy) {
        case 'requests':
          return b.requestCount - a.requestCount;
        case 'name':
          return (a.description || '').localeCompare(b.description || '');
        case 'recent':
        default:
          const aTime = a.lastUsedAt ? new Date(a.lastUsedAt).getTime() : 0;
          const bTime = b.lastUsedAt ? new Date(b.lastUsedAt).getTime() : 0;
          return bTime - aTime;
      }
    });
  }, [apps, searchQuery, keyFilter, sortBy]);

  const handleExpand = (id: number) => {
    setExpandedId(expandedId === id ? null : id);
    setEditingId(null);
    setTrustMenuOpen(null);
  };

  const startEdit = (app: ConnectedApp) => {
    setEditingId(app.id);
    setEditName(app.description || '');
    onClearError();
  };

  const saveEdit = async () => {
    if (editingId === null) return;
    const success = await onUpdateDescription(editingId, editName);
    if (success) {
      setEditingId(null);
      setEditName('');
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleRevoke = async () => {
    if (revokeConfirm === null) return;
    await onRevokeApp(revokeConfirm);
    setRevokeConfirm(null);
    setExpandedId(null);
  };

  const handleTrustChange = async (appId: number, level: TrustLevel) => {
    await onUpdateTrustLevel(appId, level);
    setTrustMenuOpen(null);
  };

  const handleSuspendSubmit = async (until?: Date) => {
    if (!suspendModalApp) return;
    setSuspending(true);
    try {
      await onSuspendApp(suspendModalApp.id, until);
      setSuspendModalApp(null);
    } finally {
      setSuspending(false);
    }
  };

  const handleSuspendAllSubmit = async (until?: Date) => {
    const result = await onSuspendAllApps(until);
    if (result.success) {
      setShowSuspendAllModal(false);
    }
  };

  const handleToggleSuspendResume = async () => {
    if (allSuspended) {
      await onResumeAllApps();
    } else {
      setShowSuspendAllModal(true);
    }
  };

  if (loading && apps.length === 0) {
    return <LoadingSpinner text="Loading apps..." />;
  }

  return (
    <div className={styles.container}>
      <PageHeader
        title="Apps"
        count={apps.length}
        action={
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={handleToggleSuspendResume}
              disabled={apps.length === 0 || suspendingAll || resumingAll}
              title={allSuspended ? 'Resume all apps' : 'Suspend all apps'}
              aria-label={allSuspended ? 'Resume all apps' : 'Suspend all apps'}
            >
              {suspendingAll || resumingAll ? (
                <Loader2 size={16} className={styles.spinning} />
              ) : allSuspended ? (
                <Play size={16} />
              ) : (
                <Pause size={16} />
              )}
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={onOpenConnectModal}
              title="Connect app"
              aria-label="Connect app"
            >
              <Plus size={16} />
            </button>
          </div>
        }
      />

      {/* Search and Filters */}
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Search size={16} className={styles.searchIcon} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search apps..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search apps"
          />
          {searchQuery && (
            <button type="button" className={styles.clearSearch} onClick={() => setSearchQuery('')} aria-label="Clear search">
              &times;
            </button>
          )}
        </div>

        <div className={styles.filters}>
          <select
            className={styles.filterSelect}
            value={keyFilter}
            onChange={(e) => setKeyFilter(e.target.value)}
            aria-label="Filter by key"
          >
            <option value="all">All keys</option>
            {keyNames.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>

          <select
            className={styles.filterSelect}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortOption)}
            aria-label="Sort apps"
          >
            <option value="recent">Most recent</option>
            <option value="requests">Most requests</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {/* App List */}
      {apps.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <Smartphone size={48} />
          </div>
          <p>No connected apps</p>
          <p className={styles.emptyHint}>
            Click + for NostrConnect, or share your key's bunker URI with an app
          </p>
        </div>
      ) : filteredApps.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <Search size={48} />
          </div>
          <p>No matching apps</p>
          <p className={styles.emptyHint}>Try adjusting your search or filters</p>
        </div>
      ) : (
        <div className={styles.appList}>
          {filteredApps.map(app => {
            const isExpanded = expandedId === app.id;
            const isSuspended = !!app.suspendedAt;
            const trustInfo = getTrustLevelInfo(app.trustLevel);
            const displayName = app.description || toNpub(app.userPubkey).slice(0, 16) + '...';

            return (
              <div key={app.id} className={`${styles.appCard} ${isExpanded ? styles.expanded : ''} ${isSuspended ? styles.suspended : ''}`}>
                <button
                  type="button"
                  className={styles.appHeader}
                  onClick={() => handleExpand(app.id)}
                >
                  <div className={styles.appMain}>
                    <span className={`${styles.activityDot} ${!isSuspended ? styles.active : ''}`} />
                    <span className={`${styles.appName} ${isSuspended ? styles.muted : ''}`}>{displayName}</span>
                  </div>
                  <span className={styles.appLastActive}>{isSuspended ? 'Suspended' : formatLastActive(app.lastUsedAt)}</span>
                  <div className={styles.appMeta}>
                    <span className={styles.appKey}>{app.keyName}</span>
                    <span className={styles.dot}>•</span>
                    <span className={`${styles.trustBadge} ${styles[app.trustLevel]}`}>
                      {trustInfo.label}
                    </span>
                  </div>
                  <span className={styles.appRequests}>{app.requestCount} requests</span>
                  <span className={styles.expandIcon}>
                    {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                </button>

                {isExpanded && (
                  <div className={styles.appDetails}>
                    <div className={styles.detailSection}>
                      <span className={styles.detailLabel}>Public Key</span>
                      <code className={styles.pubkey}>{toNpub(app.userPubkey)}</code>
                    </div>

                    <div className={styles.detailSection}>
                      <span className={styles.detailLabel}>Permissions</span>
                      <div className={styles.permissions}>
                        {app.permissions.map((perm, i) => {
                          const risk = getPermissionRisk(perm);
                          const parsed = parseConnectPermissions(perm)[0];
                          const label = parsed ? formatPermission(parsed) : perm;
                          return (
                            <span key={i} className={`${styles.permission} ${styles[risk]}`}>
                              {label}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    {app.requestCount > 0 && (
                      <div className={styles.detailSection}>
                        <span className={styles.detailLabel}>Usage</span>
                        <MethodBreakdownBar breakdown={app.methodBreakdown} />
                      </div>
                    )}

                    <div className={styles.detailSection}>
                      <span className={styles.detailLabel}>Trust Level</span>
                      <div className={styles.trustSelector}>
                        <button
                          type="button"
                          className={`${styles.trustButton} ${styles[app.trustLevel]}`}
                          onClick={() => setTrustMenuOpen(trustMenuOpen === app.id ? null : app.id)}
                        >
                          {trustInfo.label}
                          <ChevronDown size={14} />
                        </button>
                        {trustMenuOpen === app.id && (
                          <div className={styles.trustMenu}>
                            {(['paranoid', 'reasonable', 'full'] as TrustLevel[]).map(level => {
                              const info = getTrustLevelInfo(level);
                              return (
                                <button
                                  type="button"
                                  key={level}
                                  className={`${styles.trustMenuItem} ${app.trustLevel === level ? styles.selected : ''}`}
                                  onClick={() => handleTrustChange(app.id, level)}
                                >
                                  <span className={styles.trustMenuLabel}>{info.label}</span>
                                  <span className={styles.trustMenuDesc}>{info.description}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className={styles.actions}>
                      {editingId === app.id ? (
                        <div className={styles.editRow}>
                          <input
                            type="text"
                            className={styles.editInput}
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            placeholder="App name"
                            autoFocus
                          />
                          <button type="button" className={styles.saveButton} onClick={saveEdit}>Save</button>
                          <button type="button" className={styles.cancelButton} onClick={cancelEdit}>Cancel</button>
                        </div>
                      ) : (
                        <>
                          <button type="button" className={styles.renameButton} onClick={() => startEdit(app)}>
                            Rename
                          </button>
                          {isSuspended ? (
                            <button type="button" className={styles.resumeButton} onClick={() => onUnsuspendApp(app.id)}>
                              Resume
                            </button>
                          ) : (
                            <button type="button" className={styles.suspendButton} onClick={() => setSuspendModalApp(app)}>
                              Suspend
                            </button>
                          )}
                          <button type="button" className={styles.revokeButton} onClick={() => setRevokeConfirm(app.id)}>
                            Revoke Access
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={revokeConfirm !== null}
        title="Revoke App Access"
        message="This app will no longer be able to use your keys. This action cannot be undone."
        confirmLabel="Revoke Access"
        danger
        onConfirm={handleRevoke}
        onCancel={() => setRevokeConfirm(null)}
      />

      <SuspendAppModal
        open={suspendModalApp !== null}
        appName={suspendModalApp?.description || toNpub(suspendModalApp?.userPubkey || '').slice(0, 16) + '...'}
        loading={suspending}
        error={error}
        onSubmit={handleSuspendSubmit}
        onCancel={() => setSuspendModalApp(null)}
      />

      <SuspendAppModal
        open={showSuspendAllModal}
        appCount={activeAppsCount}
        loading={suspendingAll}
        error={error}
        onSubmit={handleSuspendAllSubmit}
        onCancel={() => setShowSuspendAllModal(false)}
      />
    </div>
  );
}
