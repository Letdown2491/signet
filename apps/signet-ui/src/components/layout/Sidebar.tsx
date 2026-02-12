import React, { useState, useCallback } from 'react';
import { Home, Smartphone, Key, Activity, Settings, HelpCircle, ChevronDown, ChevronRight, Plus, Lock, LockOpen, Loader2, Terminal, Copy, Check } from 'lucide-react';
import type { KeyInfo, RelayStatusResponse } from '@signet/types';
import { UnlockKeyModal } from './UnlockKeyModal.js';
import { DeadManSwitchCard } from './DeadManSwitchCard.js';
import { copyToClipboard } from '../../lib/clipboard.js';
import { generateConnectionToken } from '../../lib/api-client.js';
import styles from './Sidebar.module.css';

export type NavItem = 'home' | 'apps' | 'activity' | 'logs' | 'keys' | 'help' | 'settings';

/**
 * Get CSS class for trust score badge based on score thresholds
 */
function getScoreClass(score: number): string {
  if (score >= 80) return styles.scoreExcellent;
  if (score >= 60) return styles.scoreGood;
  if (score >= 40) return styles.scoreFair;
  return styles.scorePoor;
}

interface SidebarProps {
  activeNav: NavItem;
  onNavChange: (nav: NavItem) => void;
  pendingCount: number;
  keys: KeyInfo[];
  activeKeyName?: string;
  onKeySelect?: (keyName: string) => void;
  sseConnected: boolean;
  relayStatus: RelayStatusResponse | null;
  lockingKey?: string | null;
  unlockingKey?: string | null;
  onLockKey?: (keyName: string) => Promise<boolean>;
  onUnlockKey?: (keyName: string, passphrase: string) => Promise<boolean>;
  onConnectApp?: () => void;
  onAddKey?: () => void;
}

export function Sidebar({
  activeNav,
  onNavChange,
  pendingCount,
  keys,
  activeKeyName,
  onKeySelect,
  sseConnected,
  relayStatus,
  lockingKey,
  unlockingKey,
  onLockKey,
  onUnlockKey,
  onConnectApp,
  onAddKey,
}: SidebarProps) {
  const [keysExpanded, setKeysExpanded] = useState(true);
  const [relaysExpanded, setRelaysExpanded] = useState(true);
  const [unlockModalKey, setUnlockModalKey] = useState<string | null>(null);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [copyingKey, setCopyingKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleLockKey = useCallback(async (e: React.MouseEvent, keyName: string) => {
    e.stopPropagation();
    if (lockingKey || !onLockKey) return;
    await onLockKey(keyName);
  }, [lockingKey, onLockKey]);

  const handleUnlockClick = useCallback((e: React.MouseEvent, keyName: string) => {
    e.stopPropagation();
    setUnlockError(null);
    setUnlockModalKey(keyName);
  }, []);

  const handleUnlockSubmit = useCallback(async (passphrase: string) => {
    if (!unlockModalKey || !onUnlockKey) return;
    setUnlockError(null);
    const success = await onUnlockKey(unlockModalKey, passphrase);
    if (success) {
      setUnlockModalKey(null);
    } else {
      setUnlockError('Failed to unlock key. Check your passphrase.');
    }
  }, [unlockModalKey, onUnlockKey]);

  const handleUnlockCancel = useCallback(() => {
    setUnlockModalKey(null);
    setUnlockError(null);
  }, []);

  const handleCopyBunkerUri = useCallback(async (e: React.MouseEvent, keyName: string) => {
    e.stopPropagation();
    if (copyingKey) return;

    setCopyingKey(keyName);
    try {
      const result = await generateConnectionToken(keyName);
      if (result.ok && result.bunkerUri) {
        const success = await copyToClipboard(result.bunkerUri);
        if (success) {
          setCopiedKey(keyName);
          setTimeout(() => setCopiedKey(null), 2000);
        }
      }
    } catch {
      // Failed to generate or copy - silently fail
    } finally {
      setCopyingKey(null);
    }
  }, [copyingKey]);

  const navItems: { id: NavItem; label: string; icon: React.ReactNode; badge?: number }[] = [
    { id: 'home', label: 'Home', icon: <Home size={18} />, badge: pendingCount > 0 ? pendingCount : undefined },
    { id: 'apps', label: 'Apps', icon: <Smartphone size={18} /> },
    { id: 'activity', label: 'Activity', icon: <Activity size={18} /> },
    { id: 'logs', label: 'Logs', icon: <Terminal size={18} /> },
  ];

  return (
    <aside className={styles.sidebar}>
      {/* Logo */}
      <div className={styles.logo}>
        <div className={styles.logoIcon}>
          <Key size={20} />
        </div>
        <span className={styles.logoText}>Signet</span>
        {sseConnected && (
          <span className={styles.liveIndicator} title="Real-time updates active" aria-label="Real-time updates active">
            <span className={styles.liveDot} aria-hidden="true" />
          </span>
        )}
      </div>

      {/* Main Navigation */}
      <nav className={styles.nav} aria-label="Main navigation">
        <ul className={styles.navList}>
          {navItems.map((item) => (
            <li key={item.id}>
              <div className={styles.navItemRow}>
                <button
                  type="button"
                  className={`${styles.navItem} ${activeNav === item.id ? styles.navItemActive : ''}`}
                  onClick={() => onNavChange(item.id)}
                  aria-current={activeNav === item.id ? 'page' : undefined}
                >
                  <span className={styles.navIcon}>{item.icon}</span>
                  <span className={styles.navLabel}>{item.label}</span>
                  {item.badge && <span className={styles.navBadge}>{item.badge}</span>}
                </button>
                {item.id === 'apps' && onConnectApp && (
                  <button
                    type="button"
                    className={styles.navAddButton}
                    onClick={(e) => {
                      e.stopPropagation();
                      onConnectApp();
                    }}
                    aria-label="Connect app via nostrconnect"
                    title="Connect app via nostrconnect"
                  >
                    <Plus size={14} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>

        {/* Keys Section */}
        <div className={styles.section}>
          <div className={styles.sectionHeaderRow}>
            <button
              type="button"
              className={styles.sectionHeader}
              onClick={() => onNavChange('keys')}
              aria-label="Go to Keys page"
            >
              <span className={styles.sectionTitle}>Keys</span>
            </button>
            <div className={styles.sectionActions}>
              <button
                type="button"
                className={styles.sectionAddButton}
                onClick={() => onAddKey?.()}
                aria-label="Add key"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                className={styles.sectionExpandButton}
                onClick={() => setKeysExpanded(!keysExpanded)}
                aria-label={keysExpanded ? 'Collapse keys' : 'Expand keys'}
                aria-expanded={keysExpanded}
              >
                {keysExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
            </div>
          </div>

          {keysExpanded && (
            <ul className={styles.keyList}>
              {keys.length === 0 ? (
                <li className={styles.keyEmpty}>
                  <button
                    type="button"
                    className={styles.keyEmptyButton}
                    onClick={() => onNavChange('keys')}
                  >
                    + Add your first key
                  </button>
                </li>
              ) : (
                keys.map((key) => (
                  <li key={key.name}>
                    <div className={`${styles.keyRow} ${activeKeyName === key.name ? styles.keyRowActive : ''}`}>
                      <button
                        type="button"
                        className={`${styles.keyItem} ${activeKeyName === key.name ? styles.keyItemActive : ''}`}
                        onClick={() => onKeySelect?.(key.name)}
                      >
                        <span
                          className={`${styles.keyStatus} ${
                            key.status === 'online' ? styles.keyStatusOnline :
                            key.status === 'locked' ? styles.keyStatusLocked :
                            styles.keyStatusOffline
                          }`}
                          aria-label={`Key is ${key.status}`}
                        />
                        <span className={styles.keyName}>{key.name}</span>
                      </button>
                      {/* Copy bunker URI button for online keys */}
                      {key.status === 'online' && (
                        <button
                          type="button"
                          className={`${styles.copyButton} ${copiedKey === key.name ? styles.copied : ''}`}
                          onClick={(e) => handleCopyBunkerUri(e, key.name)}
                          disabled={copyingKey === key.name}
                          title="Copy bunker URI"
                          aria-label="Copy bunker URI"
                        >
                          {copyingKey === key.name ? (
                            <Loader2 size={12} className={styles.spinning} />
                          ) : copiedKey === key.name ? (
                            <Check size={12} />
                          ) : (
                            <Copy size={12} />
                          )}
                        </button>
                      )}
                      {/* Lock button for online encrypted keys */}
                      {key.status === 'online' && key.isEncrypted && onLockKey && (
                        <button
                          type="button"
                          className={styles.lockButton}
                          onClick={(e) => handleLockKey(e, key.name)}
                          disabled={lockingKey === key.name}
                          title="Lock key"
                          aria-label="Lock key"
                        >
                          {lockingKey === key.name ? (
                            <Loader2 size={12} className={styles.spinning} />
                          ) : (
                            <LockOpen size={12} />
                          )}
                        </button>
                      )}
                      {/* Unlock button for locked keys */}
                      {key.status === 'locked' && onUnlockKey && (
                        <button
                          type="button"
                          className={styles.lockButton}
                          onClick={(e) => handleUnlockClick(e, key.name)}
                          disabled={unlockingKey === key.name}
                          title="Unlock key"
                          aria-label="Unlock key"
                        >
                          {unlockingKey === key.name ? (
                            <Loader2 size={12} className={styles.spinning} />
                          ) : (
                            <Lock size={12} />
                          )}
                        </button>
                      )}
                    </div>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>

        {/* Relays Section */}
        <div className={styles.section}>
          <button
            type="button"
            className={styles.sectionHeader}
            onClick={() => setRelaysExpanded(!relaysExpanded)}
            aria-expanded={relaysExpanded}
            aria-label={relaysExpanded ? 'Collapse relays' : 'Expand relays'}
          >
            <span className={styles.sectionTitle}>
              Relays
              {relayStatus && (
                <span className={styles.sectionCount}>
                  {relayStatus.connected}/{relayStatus.total}
                </span>
              )}
            </span>
            {relaysExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>

          {relaysExpanded && (
            <ul className={styles.keyList}>
              {!relayStatus || relayStatus.relays.length === 0 ? (
                <li className={styles.keyEmpty}>No relays configured</li>
              ) : (
                relayStatus.relays.map((relay) => {
                  const displayUrl = relay.url.replace(/^wss?:\/\//, '');
                  return (
                    <li key={relay.url}>
                      <div className={styles.relayItem}>
                        <span
                          className={`${styles.keyStatus} ${
                            relay.connected ? styles.keyStatusOnline : styles.keyStatusOffline
                          }`}
                          aria-label={relay.connected ? 'Connected' : 'Disconnected'}
                        />
                        <span className={styles.relayUrl} title={relay.url}>
                          {displayUrl}
                        </span>
                        {relay.trustScore !== null ? (
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
                        )}
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </div>

      </nav>

      {/* Bottom Section */}
      <div className={styles.bottom}>
        {/* Inactivity Lock */}
        <DeadManSwitchCard keys={keys.map(k => ({ name: k.name, status: k.status, isEncrypted: k.isEncrypted }))} />

        <button
          type="button"
          className={`${styles.navItem} ${activeNav === 'help' ? styles.navItemActive : ''}`}
          onClick={() => onNavChange('help')}
          aria-current={activeNav === 'help' ? 'page' : undefined}
        >
          <span className={styles.navIcon}><HelpCircle size={18} /></span>
          <span className={styles.navLabel}>Help</span>
        </button>
        <button
          type="button"
          className={`${styles.navItem} ${activeNav === 'settings' ? styles.navItemActive : ''}`}
          onClick={() => onNavChange('settings')}
          aria-current={activeNav === 'settings' ? 'page' : undefined}
        >
          <span className={styles.navIcon}><Settings size={18} /></span>
          <span className={styles.navLabel}>Settings</span>
        </button>
      </div>

      {/* Unlock Key Modal */}
      <UnlockKeyModal
        open={unlockModalKey !== null}
        keyName={unlockModalKey ?? ''}
        loading={unlockingKey === unlockModalKey}
        error={unlockError}
        onSubmit={handleUnlockSubmit}
        onCancel={handleUnlockCancel}
      />
    </aside>
  );
}
