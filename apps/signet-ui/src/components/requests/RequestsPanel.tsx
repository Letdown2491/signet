import React, { useState, useMemo } from 'react';
import type { DisplayRequest, RequestFilter, RequestMeta, TrustLevel, AdminActivityEntry } from '@signet/types';
import type { SortBy } from '../../hooks/useRequests.js';
import { useAdminActivity } from '../../hooks/useAdminActivity.js';
import { RequestCard } from './RequestCard.js';
import { RequestDetailsModal } from './RequestDetailsModal.js';
import { AdminActivityList } from './AdminActivityList.js';
import { AdminActivityCard } from './AdminActivityCard.js';
import { LoadingSpinner } from '../shared/LoadingSpinner.js';
import { ErrorMessage } from '../shared/ErrorMessage.js';
import { PageHeader } from '../shared/PageHeader.js';
import { RequestsIcon, SearchIcon } from '../shared/Icons.js';
import styles from './RequestsPanel.module.css';

// Type for mixed entries (can be either DisplayRequest or AdminActivityEntry)
type MixedEntry = DisplayRequest | AdminActivityEntry;

// Type guard to check if entry is an admin event
function isAdminEntry(entry: MixedEntry): entry is AdminActivityEntry {
  return 'category' in entry && entry.category === 'admin';
}

type DateGroup = 'Today' | 'Yesterday' | 'This Week' | 'Older';

function getDateGroup(dateStr: string): DateGroup {
  const date = new Date(dateStr);
  const now = new Date();

  // Reset times to compare dates only
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const dateOnly = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (dateOnly >= today) return 'Today';
  if (dateOnly >= yesterday) return 'Yesterday';
  if (dateOnly >= weekAgo) return 'This Week';
  return 'Older';
}

function groupEntriesByDate(entries: MixedEntry[]): Map<DateGroup, MixedEntry[]> {
  const groups = new Map<DateGroup, MixedEntry[]>();
  const order: DateGroup[] = ['Today', 'Yesterday', 'This Week', 'Older'];

  // Initialize groups in order
  order.forEach(group => groups.set(group, []));

  entries.forEach(entry => {
    // Use createdAt for requests, timestamp for admin entries
    const dateStr = isAdminEntry(entry) ? entry.timestamp : entry.createdAt;
    const group = getDateGroup(dateStr);
    groups.get(group)!.push(entry);
  });

  // Remove empty groups
  order.forEach(group => {
    if (groups.get(group)!.length === 0) {
      groups.delete(group);
    }
  });

  return groups;
}

const FILTER_TABS: Array<{ id: RequestFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'approved', label: 'Approved' },
  { id: 'denied', label: 'Denied' },
  { id: 'expired', label: 'Expired' },
  { id: 'admin', label: 'Admin' },
];

const SORT_OPTIONS: Array<{ id: SortBy; label: string }> = [
  { id: 'newest', label: 'Newest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'expiring', label: 'Expiring soon' },
];

interface RequestsPanelProps {
  requests: DisplayRequest[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  filter: RequestFilter;
  passwords: Record<string, string>;
  meta: Record<string, RequestMeta>;
  selectionMode: boolean;
  selectedIds: Set<string>;
  searchQuery: string;
  sortBy: SortBy;
  onFilterChange: (filter: RequestFilter) => void;
  onPasswordChange: (id: string, password: string) => void;
  onApprove: (id: string, trustLevel?: TrustLevel, alwaysAllow?: boolean, allowKind?: number) => void;
  onLoadMore: () => void;
  onToggleSelection: (id: string) => void;
  onSearchChange: (query: string) => void;
  onSortChange: (sort: SortBy) => void;
  onRefresh: () => void;
}

export function RequestsPanel({
  requests,
  loading,
  loadingMore,
  error,
  hasMore,
  filter,
  passwords,
  meta,
  selectionMode,
  selectedIds,
  searchQuery,
  sortBy,
  onFilterChange,
  onPasswordChange,
  onApprove,
  onLoadMore,
  onToggleSelection,
  onSearchChange,
  onSortChange,
  onRefresh,
}: RequestsPanelProps) {
  const [selectedRequest, setSelectedRequest] = useState<DisplayRequest | null>(null);
  const [keyFilter, setKeyFilter] = useState<string>('all');
  const [appFilter, setAppFilter] = useState<string>('all');

  // Hook for admin activity when admin filter is selected
  const adminActivity = useAdminActivity();

  // Cast requests to mixed entries since backend returns both types for 'all' filter
  const mixedEntries = requests as unknown as MixedEntry[];

  // Get unique keys and apps for filters (only from regular requests)
  const uniqueKeys = useMemo(() => {
    const keys = new Set<string>();
    mixedEntries.forEach(entry => {
      if (!isAdminEntry(entry) && entry.keyName) {
        keys.add(entry.keyName);
      }
    });
    return Array.from(keys).sort();
  }, [mixedEntries]);

  const uniqueApps = useMemo(() => {
    const apps = new Map<string, string>(); // npub -> display name (appName or truncated npub)
    mixedEntries.forEach(entry => {
      if (!isAdminEntry(entry) && entry.npub && !apps.has(entry.npub)) {
        apps.set(entry.npub, entry.appName || entry.npub.slice(0, 12) + '...');
      }
    });
    return Array.from(apps.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [mixedEntries]);

  // Apply local filters (admin entries always pass through)
  const filteredEntries = useMemo(() => {
    return mixedEntries.filter(entry => {
      if (isAdminEntry(entry)) return true; // Admin entries always shown
      if (keyFilter !== 'all' && entry.keyName !== keyFilter) return false;
      if (appFilter !== 'all' && entry.npub !== appFilter) return false;
      return true;
    });
  }, [mixedEntries, keyFilter, appFilter]);

  const groupedEntries = useMemo(() => groupEntriesByDate(filteredEntries), [filteredEntries]);

  return (
    <div className={styles.container}>
      <PageHeader title="Activity" />

      <div className={styles.header}>
        <div className={styles.filters}>
          {FILTER_TABS.map(tab => (
            <button
              type="button"
              key={tab.id}
              className={`${styles.filterTab} ${filter === tab.id ? styles.active : ''}`}
              onClick={() => onFilterChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

      </div>

      <div className={styles.searchSortRow}>
        <div className={styles.searchBox}>
          <SearchIcon size={16} className={styles.searchIcon} aria-hidden="true" />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search by method, npub, key, or event kind..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search requests"
          />
          {searchQuery && (
            <button
              type="button"
              className={styles.clearSearch}
              onClick={() => onSearchChange('')}
              aria-label="Clear search"
            >
              &times;
            </button>
          )}
        </div>

        <div className={styles.filtersRow}>
          {uniqueKeys.length > 1 && (
            <select
              className={styles.filterSelect}
              value={keyFilter}
              onChange={(e) => setKeyFilter(e.target.value)}
              aria-label="Filter by key"
            >
              <option value="all">All keys</option>
              {uniqueKeys.map(key => (
                <option key={key} value={key}>{key}</option>
              ))}
            </select>
          )}

          {uniqueApps.length > 1 && (
            <select
              className={styles.filterSelect}
              value={appFilter}
              onChange={(e) => setAppFilter(e.target.value)}
              aria-label="Filter by app"
            >
              <option value="all">All apps</option>
              {uniqueApps.map(([npub, label]) => (
                <option key={npub} value={npub}>{label}</option>
              ))}
            </select>
          )}

          <select
            className={styles.filterSelect}
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as SortBy)}
            aria-label="Sort requests"
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Admin filter shows admin activity list */}
      {filter === 'admin' ? (
        <AdminActivityList
          entries={adminActivity.entries}
          loading={adminActivity.loading}
          loadingMore={adminActivity.loadingMore}
          error={adminActivity.error}
          hasMore={adminActivity.hasMore}
          onLoadMore={adminActivity.loadMore}
          onRefresh={adminActivity.refresh}
        />
      ) : (
        <>
          {error && (
            <ErrorMessage
              error={error}
              onRetry={onRefresh}
              retrying={loading}
            />
          )}

          {loading && mixedEntries.length === 0 ? (
            <LoadingSpinner text="Loading requests..." />
          ) : mixedEntries.length === 0 ? (
            <div className={styles.emptyState} aria-live="polite">
              <span className={styles.emptyIcon} aria-hidden="true">
                <RequestsIcon size={48} />
              </span>
              <span>No {filter === 'all' ? '' : filter + ' '}activity</span>
            </div>
          ) : (
            <div className={styles.list}>
              {Array.from(groupedEntries.entries()).map(([group, groupEntries]) => (
                <div key={group} className={styles.dateGroup}>
                  <h3 className={styles.dateGroupHeader}>{group}</h3>
                  <div className={styles.dateGroupList}>
                    {groupEntries.map(entry => {
                      if (isAdminEntry(entry)) {
                        return <AdminActivityCard key={`admin-${entry.id}`} entry={entry} />;
                      }
                      const request = entry as DisplayRequest;
                      return (
                        <RequestCard
                          key={request.id}
                          request={request}
                          meta={meta[request.id] ?? { state: 'idle' }}
                          password={passwords[request.id] ?? ''}
                          selectionMode={selectionMode}
                          selected={selectedIds.has(request.id)}
                          onPasswordChange={(pw) => onPasswordChange(request.id, pw)}
                          onApprove={(trustLevel, alwaysAllow, allowKind) => onApprove(request.id, trustLevel, alwaysAllow, allowKind)}
                          onSelect={() => onToggleSelection(request.id)}
                          onViewDetails={() => setSelectedRequest(request)}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}

              {hasMore && (
                <button
                  type="button"
                  className={styles.loadMoreButton}
                  onClick={onLoadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? 'Loading...' : 'Load More'}
                </button>
              )}
            </div>
          )}

          <RequestDetailsModal
            request={selectedRequest}
            open={selectedRequest !== null}
            onClose={() => setSelectedRequest(null)}
          />
        </>
      )}
    </div>
  );
}
