import React from 'react';
import { Menu, X, Command } from 'lucide-react';
import { Sidebar, type NavItem } from './Sidebar.js';
import type { KeyInfo, RelayStatusResponse } from '@signet/types';
import styles from './AppLayout.module.css';

interface AppLayoutProps {
  children: React.ReactNode;
  activeNav: NavItem;
  onNavChange: (nav: NavItem) => void;
  pendingCount: number;
  keys: KeyInfo[];
  activeKeyName?: string;
  onKeySelect?: (keyName: string) => void;
  sseConnected: boolean;
  onOpenCommandPalette?: () => void;
  relayStatus: RelayStatusResponse | null;
  lockingKey?: string | null;
  unlockingKey?: string | null;
  onLockKey?: (keyName: string) => Promise<boolean>;
  onUnlockKey?: (keyName: string, passphrase: string) => Promise<boolean>;
  onConnectApp?: () => void;
  onAddKey?: () => void;
}

export function AppLayout({
  children,
  activeNav,
  onNavChange,
  pendingCount,
  keys,
  activeKeyName,
  onKeySelect,
  sseConnected,
  onOpenCommandPalette,
  relayStatus,
  lockingKey,
  unlockingKey,
  onLockKey,
  onUnlockKey,
  onConnectApp,
  onAddKey,
}: AppLayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  // Close mobile menu when nav changes
  React.useEffect(() => {
    setMobileMenuOpen(false);
  }, [activeNav]);

  // Handle keyboard shortcut for command palette
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        onOpenCommandPalette?.();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onOpenCommandPalette]);

  return (
    <div className={styles.layout}>
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className={styles.overlay}
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`${styles.sidebarContainer} ${mobileMenuOpen ? styles.sidebarOpen : ''}`}>
        <Sidebar
          activeNav={activeNav}
          onNavChange={onNavChange}
          pendingCount={pendingCount}
          keys={keys}
          activeKeyName={activeKeyName}
          onKeySelect={onKeySelect}
          sseConnected={sseConnected}
          relayStatus={relayStatus}
          lockingKey={lockingKey}
          unlockingKey={unlockingKey}
          onLockKey={onLockKey}
          onUnlockKey={onUnlockKey}
          onConnectApp={onConnectApp}
          onAddKey={onAddKey}
        />
      </div>

      {/* Main content */}
      <div className={styles.main}>
        {/* Mobile header */}
        <header className={styles.mobileHeader}>
          <button
            type="button"
            className={styles.menuButton}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <span className={styles.mobileTitle}>Signet</span>
          {onOpenCommandPalette && (
            <button
              type="button"
              className={styles.commandButton}
              onClick={onOpenCommandPalette}
              aria-label="Open command palette"
            >
              <Command size={16} />
              <span className={styles.commandShortcut}>K</span>
            </button>
          )}
        </header>

        {/* Content area */}
        <main className={styles.content}>
          {children}
        </main>
      </div>
    </div>
  );
}
