import React, { useEffect, useState, useCallback } from 'react';
import type { TrustLevel, DisplayRequest } from '@signet/types';
import { fetchConnectionInfo } from './lib/connection.js';
import { ToastProvider, useToast } from './contexts/ToastContext.js';
import { SettingsProvider, useSettings } from './contexts/SettingsContext.js';
import { ServerEventsProvider, useServerEventsContext } from './contexts/ServerEventsContext.js';
import { AppLayout } from './components/layout/AppLayout.js';
import type { NavItem } from './components/layout/Sidebar.js';
import { Toast } from './components/shared/Toast.js';
import { LoadingSpinner } from './components/shared/LoadingSpinner.js';
import { CommandPalette } from './components/shared/CommandPalette.js';
import { HomeView } from './components/home/HomeView.js';
import { RequestsPanel } from './components/requests/RequestsPanel.js';
import { RequestDetailsModal } from './components/requests/RequestDetailsModal.js';
import { KeysPanel } from './components/keys/KeysPanel.js';
import { AppsPanel } from './components/apps/AppsPanel.js';
import { ConnectAppModal } from './components/apps/ConnectAppModal.js';
import { SettingsPanel } from './components/settings/SettingsPanel.js';
import { HelpPanel } from './components/help/HelpPanel.js';
import { LogsPanel } from './components/logs/LogsPanel.js';
import { LockScreen } from './components/shared/LockScreen.js';
import { useRequests } from './hooks/useRequests.js';
import { useKeys } from './hooks/useKeys.js';
import { useApps } from './hooks/useApps.js';
import { useDashboard } from './hooks/useDashboard.js';
import { useRelays } from './hooks/useRelays.js';
import { useHealth } from './hooks/useHealth.js';
import { useDeadManSwitch } from './hooks/useDeadManSwitch.js';
import './design-system.css';
import './styles.css';

type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

function AppContent() {
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [activeNav, setActiveNav] = useState<NavItem>('home');
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>('default');
  const [detailsModalRequest, setDetailsModalRequest] = useState<DisplayRequest | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [connectAppModalOpen, setConnectAppModalOpen] = useState(false);
  const [showCreateKeyForm, setShowCreateKeyForm] = useState(false);
  const [selectedKeyName, setSelectedKeyName] = useState<string | null>(null);
  const [showAutoApproved, setShowAutoApproved] = useState(true);
  const [appNames, setAppNames] = useState<Record<string, string>>({});

  const { showToast } = useToast();
  const { settings } = useSettings();
  const { connected: sseConnected } = useServerEventsContext();

  // Hooks for data - each hook handles its own SSE events
  const requests = useRequests();
  const keys = useKeys();
  const apps = useApps();
  const dashboard = useDashboard();
  const relays = useRelays();
  const health = useHealth();
  const deadManSwitch = useDeadManSwitch();

  // Wait for initial connection before showing the app
  useEffect(() => {
    fetchConnectionInfo()
      .finally(() => setConnectionLoading(false));
  }, []);

  // Load keys and apps on mount
  useEffect(() => {
    keys.refresh();
    apps.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Check notification permission on mount
  useEffect(() => {
    if (!('Notification' in window)) {
      setNotificationPermission('unsupported');
      return;
    }

    setNotificationPermission(Notification.permission as NotificationPermissionState);
  }, []);

  // Request notification permission
  const requestNotificationPermission = useCallback(async () => {
    if (!('Notification' in window)) return;

    try {
      const permission = await Notification.requestPermission();
      setNotificationPermission(permission as NotificationPermissionState);
    } catch (error) {
      console.error('Failed to request notification permission:', error);
    }
  }, []);

  // Global keyboard shortcut for Command Palette (Cmd+K / Ctrl+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Use dashboard stats for accurate pending count (not affected by filter)
  const pendingCount = dashboard.stats?.pendingRequests ?? 0;

  // Update browser tab title with pending count
  useEffect(() => {
    document.title = pendingCount > 0 ? `(${pendingCount}) Signet` : 'Signet';
  }, [pendingCount]);

  // Send notification for new requests (use dashboard stats for accuracy regardless of filter)
  useEffect(() => {
    if (!settings.notificationsEnabled || notificationPermission !== 'granted') {
      return;
    }

    if (pendingCount > 0 && document.hidden) {
      new Notification('Signet', {
        body: `${pendingCount} pending request${pendingCount > 1 ? 's' : ''} awaiting approval`,
        icon: '/favicon.ico',
      });
    }
  }, [pendingCount, settings.notificationsEnabled, notificationPermission]);

  // Handle key selection from sidebar
  const handleKeySelect = useCallback((keyName: string) => {
    setSelectedKeyName(keyName);
    setActiveNav('keys');
  }, []);

  // Handle navigation changes
  const handleNavChange = useCallback((nav: NavItem) => {
    setActiveNav(nav);
  }, []);

  // Handle add key from sidebar
  const handleAddKey = useCallback(() => {
    setActiveNav('keys');
    setShowCreateKeyForm(true);
  }, []);

  // Switch request filter based on active page
  // Home page needs pending requests, Activity page needs processed requests
  useEffect(() => {
    if (activeNav === 'home') {
      requests.setFilter('pending');
    } else if (activeNav === 'activity') {
      // 'all' in the backend means processed (approved, denied, expired)
      requests.setFilter('all');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNav]);

  // Handle app name changes for connect requests
  const handleAppNameChange = useCallback((requestId: string, appName: string) => {
    setAppNames(prev => ({ ...prev, [requestId]: appName }));
  }, []);

  if (connectionLoading) {
    return (
      <div className="app-loading">
        <LoadingSpinner size="large" text="Connecting to Signet..." />
      </div>
    );
  }

  // Handle recovery from inactivity lock
  const handleRecover = async (keyName: string, passphrase: string, resumeApps: boolean): Promise<{ ok: boolean; error?: string }> => {
    // Step 1: Unlock the key
    const unlockSuccess = await keys.unlockKey(keyName, passphrase);
    if (!unlockSuccess) {
      return { ok: false, error: 'Invalid passphrase. Please try again.' };
    }

    // Step 2: Reset the dead man switch (clears panic state)
    const resetResult = await deadManSwitch.reset(keyName, passphrase);
    if (!resetResult.ok) {
      return { ok: false, error: resetResult.error };
    }

    // Step 3: Resume all suspended apps if requested
    if (resumeApps) {
      const suspendedApps = apps.apps.filter(app => app.suspendedAt !== null);
      await Promise.all(suspendedApps.map(app => apps.unsuspendApp(app.id)));
    }

    return { ok: true };
  };

  // Show lock screen when panic is triggered
  if (deadManSwitch.status?.panicTriggeredAt != null) {
    return (
      <LockScreen
        triggeredAt={deadManSwitch.status.panicTriggeredAt}
        keys={keys.keys}
        onRecover={handleRecover}
      />
    );
  }

  // Render content based on active nav
  const renderContent = () => {
    switch (activeNav) {
      case 'home':
        return (
          <HomeView
            requests={requests.requests}
            stats={dashboard.stats}
            activity={dashboard.activity}
            loading={requests.loading || dashboard.loading}
            health={health.health}
            uiStatus={health.uiStatus}
            relayStatus={relays.relays}
            deadManSwitchStatus={deadManSwitch.status}
            deadManSwitchCountdown={deadManSwitch.countdown}
            deadManSwitchUrgency={deadManSwitch.urgency}
            keys={keys.keys}
            passwords={requests.passwords}
            appNames={appNames}
            showAutoApproved={showAutoApproved}
            onPasswordChange={requests.setPassword}
            onAppNameChange={handleAppNameChange}
            onApprove={requests.approve}
            onDeny={requests.deny}
            onViewDetails={setDetailsModalRequest}
            onNavigateToActivity={() => setActiveNav('activity')}
            onNavigateToKeys={() => setActiveNav('keys')}
            onNavigateToApps={() => setActiveNav('apps')}
            onToggleShowAutoApproved={() => setShowAutoApproved(prev => !prev)}
            onReset={deadManSwitch.reset}
          />
        );

      case 'apps':
        return (
          <AppsPanel
            apps={apps.apps}
            loading={apps.loading}
            error={apps.error}
            onRevokeApp={async (appId) => {
              const success = await apps.revokeApp(appId);
              if (success) {
                showToast({
                  message: 'App access revoked',
                  type: 'success',
                });
              }
              return success;
            }}
            onUpdateDescription={async (appId, description) => {
              const success = await apps.updateDescription(appId, description);
              if (success) {
                showToast({
                  message: 'App renamed successfully',
                  type: 'success',
                });
              }
              return success;
            }}
            onUpdateTrustLevel={async (appId: number, trustLevel: TrustLevel) => {
              const success = await apps.updateTrustLevel(appId, trustLevel);
              if (success) {
                showToast({
                  message: 'Trust level updated',
                  type: 'success',
                });
              }
              return success;
            }}
            onSuspendApp={async (appId: number) => {
              const success = await apps.suspendApp(appId);
              if (success) {
                showToast({
                  message: 'App suspended',
                  type: 'success',
                });
              }
              return success;
            }}
            onUnsuspendApp={async (appId: number) => {
              const success = await apps.unsuspendApp(appId);
              if (success) {
                showToast({
                  message: 'App resumed',
                  type: 'success',
                });
              }
              return success;
            }}
            onSuspendAllApps={async (until?: Date) => {
              const result = await apps.suspendAllApps(until);
              if (result.success && result.suspendedCount) {
                showToast({
                  message: `Suspended ${result.suspendedCount} app${result.suspendedCount > 1 ? 's' : ''}`,
                  type: 'success',
                });
              }
              return result;
            }}
            onResumeAllApps={async () => {
              const result = await apps.resumeAllApps();
              if (result.success && result.resumedCount) {
                showToast({
                  message: `Resumed ${result.resumedCount} app${result.resumedCount > 1 ? 's' : ''}`,
                  type: 'success',
                });
              }
              return result;
            }}
            suspendingAll={apps.suspendingAll}
            resumingAll={apps.resumingAll}
            onClearError={apps.clearError}
            onOpenConnectModal={() => setConnectAppModalOpen(true)}
          />
        );

      case 'activity':
        // For now, show requests panel as activity
        return (
          <RequestsPanel
            requests={requests.requests}
            loading={requests.loading}
            loadingMore={requests.loadingMore}
            error={requests.error}
            hasMore={requests.hasMore}
            filter={requests.filter}
            passwords={requests.passwords}
            meta={requests.meta}
            selectionMode={requests.selectionMode}
            selectedIds={requests.selectedIds}
            searchQuery={requests.searchQuery}
            sortBy={requests.sortBy}
            onFilterChange={requests.setFilter}
            onPasswordChange={requests.setPassword}
            onApprove={requests.approve}
            onLoadMore={requests.loadMore}
            onToggleSelection={requests.toggleSelection}
            onSearchChange={requests.setSearchQuery}
            onSortChange={requests.setSortBy}
            onRefresh={requests.refresh}
          />
        );

      case 'logs':
        return <LogsPanel />;

      case 'keys':
        return (
          <KeysPanel
            keys={keys.keys}
            apps={apps.apps}
            loading={keys.loading}
            error={keys.error}
            creating={keys.creating}
            deleting={keys.deleting}
            unlocking={keys.unlocking}
            locking={keys.locking}
            lockingAll={keys.lockingAll}
            renaming={keys.renaming}
            encrypting={keys.encrypting}
            migrating={keys.migrating}
            exporting={keys.exporting}
            forceShowCreateForm={showCreateKeyForm}
            onCreateKey={keys.createKey}
            onDeleteKey={keys.deleteKey}
            onUnlockKey={keys.unlockKey}
            onLockKey={keys.lockKey}
            onLockAllKeys={async () => {
              const result = await keys.lockAllKeys();
              if (result.success && result.lockedCount) {
                showToast({
                  message: `Locked ${result.lockedCount} key${result.lockedCount > 1 ? 's' : ''}`,
                  type: 'success',
                });
              }
              return result;
            }}
            onRenameKey={keys.renameKey}
            onEncryptKey={keys.encryptKey}
            onMigrateKey={keys.migrateKey}
            onExportKey={keys.exportKey}
            onClearError={keys.clearError}
            onCreateFormClose={() => setShowCreateKeyForm(false)}
          />
        );

      case 'help':
        return <HelpPanel />;

      case 'settings':
        return (
          <SettingsPanel
            notificationPermission={notificationPermission}
            onRequestNotificationPermission={requestNotificationPermission}
            keys={keys.keys}
          />
        );

      default:
        return null;
    }
  };

  return (
    <AppLayout
      activeNav={activeNav}
      onNavChange={handleNavChange}
      pendingCount={pendingCount}
      keys={keys.keys}
      activeKeyName={selectedKeyName ?? undefined}
      onKeySelect={handleKeySelect}
      sseConnected={sseConnected}
      onOpenCommandPalette={() => setCommandPaletteOpen(true)}
      relayStatus={relays.relays}
      lockingKey={keys.locking}
      unlockingKey={keys.unlocking}
      onLockKey={keys.lockKey}
      onUnlockKey={keys.unlockKey}
      onConnectApp={() => setConnectAppModalOpen(true)}
      onAddKey={handleAddKey}
    >
      {renderContent()}

      {/* Keys Panel - shown when clicking on a key in sidebar */}
      {/* For now, keys are managed separately - could add a keys nav item */}

      {/* Request Details Modal */}
      <RequestDetailsModal
        request={detailsModalRequest}
        open={detailsModalRequest !== null}
        onClose={() => setDetailsModalRequest(null)}
      />

      <Toast />

      {/* Connect App Modal */}
      <ConnectAppModal
        open={connectAppModalOpen}
        keys={keys.keys}
        onClose={() => setConnectAppModalOpen(false)}
        onSuccess={(warning) => {
          apps.refresh();
          if (warning) {
            showToast({
              message: `App connected, but: ${warning}`,
              type: 'warning',
            });
          } else {
            showToast({
              message: 'App connected successfully',
              type: 'success',
            });
          }
        }}
      />

      {/* Command Palette */}
      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onNavigate={setActiveNav}
        keys={keys.keys}
        apps={apps.apps}
      />
    </AppLayout>
  );
}

export default function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <ServerEventsProvider>
          <AppContent />
        </ServerEventsProvider>
      </ToastProvider>
    </SettingsProvider>
  );
}
