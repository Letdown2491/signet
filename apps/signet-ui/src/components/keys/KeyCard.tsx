import React, { useState } from 'react';
import type { KeyInfo, ConnectedApp } from '@signet/types';
import { ChevronDown, ChevronRight, Copy, QrCode, Lock, Unlock, Trash2, Users, Pencil, Shield, Download, ArrowUpCircle, HelpCircle } from 'lucide-react';
import { formatRelativeTime, toNpub } from '../../lib/formatters.js';
import { getTrustLevelInfo } from '../../lib/event-labels.js';
import { copyToClipboard as copyText } from '../../lib/clipboard.js';
import { BunkerURIModal } from '../layout/BunkerURIModal.js';
import styles from './KeysPanel.module.css';

interface KeyCardProps {
  keyInfo: KeyInfo;
  apps: ConnectedApp[];
  expanded: boolean;
  now: number;
  unlocking: string | null;  // Key name being unlocked, or null
  locking: string | null;    // Key name being locked, or null
  renaming: boolean;
  encrypting: boolean;
  migrating: boolean;
  exporting: boolean;
  onToggleExpand: () => void;
  onUnlock: (passphrase: string) => Promise<boolean>;
  onLock: () => void;
  onRename: (newName: string) => Promise<boolean>;
  onEncrypt: (encryption: 'nip49' | 'legacy', passphrase: string, confirmPassphrase: string) => Promise<boolean>;
  onMigrate: (passphrase: string) => Promise<boolean>;
  onExport: (format: 'nsec' | 'nip49', currentPassphrase?: string, exportPassphrase?: string, confirmExportPassphrase?: string) => Promise<{ key?: string; format?: 'nsec' | 'ncryptsec' } | null>;
  onDelete: () => void;
  onShowQR: (value: string, title: string) => void;
  onClearError: () => void;
}

export function KeyCard({
  keyInfo: key,
  apps,
  expanded,
  now,
  unlocking,
  locking,
  renaming,
  encrypting,
  migrating,
  exporting,
  onToggleExpand,
  onUnlock,
  onLock,
  onRename,
  onEncrypt,
  onMigrate,
  onExport,
  onDelete,
  onShowQR,
  onClearError,
}: KeyCardProps) {
  // Unlock state
  const [unlockPassphrase, setUnlockPassphrase] = useState('');

  // Rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [editName, setEditName] = useState('');


  // Encrypt state (for unencrypted keys)
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [encryptFormat, setEncryptFormat] = useState<'nip49' | 'legacy'>('nip49');
  const [encryptPassphrase, setEncryptPassphrase] = useState('');
  const [encryptConfirmPassphrase, setEncryptConfirmPassphrase] = useState('');
  const [showNip49Tooltip, setShowNip49Tooltip] = useState(false);
  const [showLegacyTooltip, setShowLegacyTooltip] = useState(false);

  // Migrate state (for legacy-encrypted keys)
  const [isMigrating, setIsMigrating] = useState(false);
  const [migratePassphrase, setMigratePassphrase] = useState('');

  // Export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<'nsec' | 'nip49'>('nip49');
  const [exportNewPassphrase, setExportNewPassphrase] = useState('');
  const [exportConfirmPassphrase, setExportConfirmPassphrase] = useState('');

  // Clipboard feedback
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Bunker URI modal state
  const [showBunkerModal, setShowBunkerModal] = useState(false);

  // Connected apps list state
  const [showAllApps, setShowAllApps] = useState(false);

  const copyToClipboard = async (text: string, field: string) => {
    const success = await copyText(text);
    if (success) {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    }
  };

  const handleUnlock = async () => {
    if (!unlockPassphrase.trim()) return;
    const success = await onUnlock(unlockPassphrase);
    if (success) {
      setUnlockPassphrase('');
    }
  };

  const startRename = () => {
    setIsRenaming(true);
    setEditName(key.name);
    onClearError();
  };

  const cancelRename = () => {
    setIsRenaming(false);
    setEditName('');
  };

  const handleRename = async () => {
    if (!editName.trim()) return;
    const success = await onRename(editName.trim());
    if (success) {
      setIsRenaming(false);
      setEditName('');
    }
  };

  // Encrypt handlers
  const startEncrypt = () => {
    setIsEncrypting(true);
    setEncryptFormat('nip49');
    setEncryptPassphrase('');
    setEncryptConfirmPassphrase('');
    onClearError();
  };

  const cancelEncrypt = () => {
    setIsEncrypting(false);
    setEncryptPassphrase('');
    setEncryptConfirmPassphrase('');
  };

  const handleEncrypt = async () => {
    if (!encryptPassphrase.trim() || encryptPassphrase !== encryptConfirmPassphrase) return;
    const success = await onEncrypt(encryptFormat, encryptPassphrase, encryptConfirmPassphrase);
    if (success) {
      setIsEncrypting(false);
      setEncryptPassphrase('');
      setEncryptConfirmPassphrase('');
    }
  };

  // Migrate handlers
  const startMigrate = () => {
    setIsMigrating(true);
    setMigratePassphrase('');
    onClearError();
  };

  const cancelMigrate = () => {
    setIsMigrating(false);
    setMigratePassphrase('');
  };

  const handleMigrate = async () => {
    if (!migratePassphrase.trim()) return;
    const success = await onMigrate(migratePassphrase);
    if (success) {
      setIsMigrating(false);
      setMigratePassphrase('');
    }
  };

  // Export handlers
  const startExport = () => {
    setIsExporting(true);
    setExportFormat('nip49');
    setExportNewPassphrase('');
    setExportConfirmPassphrase('');
    onClearError();
  };

  const cancelExport = () => {
    setIsExporting(false);
    setExportNewPassphrase('');
    setExportConfirmPassphrase('');
  };

  const handleExport = async () => {
    // For NIP-49 export, need new passphrase
    if (exportFormat === 'nip49') {
      if (!exportNewPassphrase.trim() || exportNewPassphrase !== exportConfirmPassphrase) return;
    }
    // Export only works for online keys (key is in memory, no passphrase needed)

    const result = await onExport(
      exportFormat,
      undefined,  // No current passphrase needed for online keys
      exportFormat === 'nip49' ? exportNewPassphrase : undefined,
      exportFormat === 'nip49' ? exportConfirmPassphrase : undefined
    );
    if (result?.key) {
      // Create file content with npub and secret
      const content = [
        `# Signet Key Export: ${key.name}`,
        `# Exported: ${new Date().toISOString()}`,
        '',
        `npub: ${key.npub}`,
        `${result.format}: ${result.key}`,
        '',
      ].join('\n');

      // Trigger file download
      const blob = new Blob([content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${key.name}-${result.format}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Close the export form
      cancelExport();
    }
  };

  const handleToggleExpand = () => {
    if (!expanded) {
      // Reset local state when expanding
      setUnlockPassphrase('');
      setIsRenaming(false);
      setEditName('');
      setIsEncrypting(false);
      setEncryptPassphrase('');
      setEncryptConfirmPassphrase('');
      setIsMigrating(false);
      setMigratePassphrase('');
      setIsExporting(false);
      setExportNewPassphrase('');
      setExportConfirmPassphrase('');
      onClearError();
    }
    onToggleExpand();
  };

  return (
    <div className={`${styles.keyCard} ${expanded ? styles.expanded : ''}`}>
      <button
        type="button"
        className={styles.keyHeader}
        onClick={handleToggleExpand}
        aria-expanded={expanded}
      >
        <div className={styles.keyMain}>
          <span className={`${styles.activityDot} ${
            key.status === 'online' ? styles.active :
            key.status === 'locked' ? styles.locked : ''
          }`} />
          <span className={styles.keyName}>{key.name}</span>
        </div>
        <div className={styles.keyMeta}>
          {key.npub && (
            <span className={styles.npubPreview}>
              {key.npub.slice(0, 12)}...
            </span>
          )}
          <span className={styles.dot}>•</span>
          <span>{key.userCount} app{key.userCount !== 1 ? 's' : ''}</span>
          <span className={styles.dot}>•</span>
          <span>{key.requestCount} request{key.requestCount !== 1 ? 's' : ''}</span>
          {key.lastUsedAt && (
            <>
              <span className={styles.dot}>•</span>
              <span>{formatRelativeTime(key.lastUsedAt, now)}</span>
            </>
          )}
        </div>
        <span className={styles.expandIcon}>
          {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>

      {expanded && (
        <div className={styles.keyDetails}>
          {key.status === 'locked' ? (
            <div className={styles.unlockSection}>
              <div className={styles.unlockHeader}>
                <Lock size={20} />
                <span>Key is Locked</span>
              </div>
              <p className={styles.unlockHint}>
                Enter passphrase to unlock and start signing
              </p>
              <div className={styles.unlockForm}>
                <input
                  type="password"
                  className={styles.input}
                  value={unlockPassphrase}
                  onChange={(e) => setUnlockPassphrase(e.target.value)}
                  placeholder="Enter passphrase"
                  aria-label="Passphrase to unlock key"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleUnlock();
                  }}
                />
                <button
                  type="button"
                  className={styles.unlockButton}
                  onClick={handleUnlock}
                  disabled={unlocking === key.name || !unlockPassphrase.trim()}
                >
                  <Unlock size={16} />
                  {unlocking === key.name ? 'Unlocking...' : 'Unlock'}
                </button>
              </div>
            </div>
          ) : (
            <>
              {key.npub && (
                <div className={styles.detailSection}>
                  <span className={styles.detailLabel}>Public Key</span>
                  <div className={styles.detailRow}>
                    <code className={styles.detailValue}>{key.npub}</code>
                    <div className={styles.detailActions}>
                      <button
                        type="button"
                        className={styles.actionButton}
                        onClick={() => copyToClipboard(key.npub!, `npub-${key.name}`)}
                      >
                        <Copy size={14} />
                        {copiedField === `npub-${key.name}` ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        className={styles.actionButton}
                        onClick={() => onShowQR(key.npub!, 'Public Key')}
                      >
                        <QrCode size={14} />
                        QR
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {key.status === 'online' && (
                <div className={styles.detailSection}>
                  <span className={styles.detailLabel}>Bunker Connection</span>
                  <div className={styles.detailRow}>
                    <code className={styles.detailValue}>
                      bunker://{key.pubkey?.slice(0, 16)}...
                    </code>
                    <div className={styles.detailActions}>
                      <button
                        type="button"
                        className={styles.actionButton}
                        onClick={() => setShowBunkerModal(true)}
                        title="Show bunker URI QR code"
                      >
                        <QrCode size={14} />
                        QR
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Encryption section */}
              <div className={styles.detailSection}>
                <span className={styles.detailLabel}>
                  <Shield size={14} />
                  Encryption
                  {key.encryptionFormat && key.encryptionFormat !== 'none' && (
                    <span className={`${styles.encryptionBadge} ${styles[key.encryptionFormat]}`}>
                      {key.encryptionFormat === 'nip49' ? 'NIP-49' : 'Legacy'}
                    </span>
                  )}
                </span>

                {/* Unencrypted key - show encrypt form or button */}
                {!key.isEncrypted && (
                  <>
                    {isEncrypting ? (
                      <div className={styles.encryptForm}>
                        <div className={styles.radioGroup}>
                          <label className={styles.radioLabel}>
                            <input
                              type="radio"
                              name="encryptFormat"
                              value="nip49"
                              checked={encryptFormat === 'nip49'}
                              onChange={() => setEncryptFormat('nip49')}
                              className={styles.radioInput}
                            />
                            <span>NIP-49 (Recommended)</span>
                            <button
                              type="button"
                              className={styles.tooltipButton}
                              onMouseEnter={() => setShowNip49Tooltip(true)}
                              onMouseLeave={() => setShowNip49Tooltip(false)}
                              onFocus={() => setShowNip49Tooltip(true)}
                              onBlur={() => setShowNip49Tooltip(false)}
                              aria-label="More info about NIP-49"
                            >
                              <HelpCircle size={14} />
                            </button>
                            {showNip49Tooltip && (
                              <div className={styles.tooltip}>
                                <strong>NIP-49 Encryption</strong>
                                <p>Uses XChaCha20-Poly1305 with scrypt. The ncryptsec format is portable to other Nostr tools.</p>
                              </div>
                            )}
                          </label>
                          <label className={styles.radioLabel}>
                            <input
                              type="radio"
                              name="encryptFormat"
                              value="legacy"
                              checked={encryptFormat === 'legacy'}
                              onChange={() => setEncryptFormat('legacy')}
                              className={styles.radioInput}
                            />
                            <span>Legacy</span>
                            <button
                              type="button"
                              className={styles.tooltipButton}
                              onMouseEnter={() => setShowLegacyTooltip(true)}
                              onMouseLeave={() => setShowLegacyTooltip(false)}
                              onFocus={() => setShowLegacyTooltip(true)}
                              onBlur={() => setShowLegacyTooltip(false)}
                              aria-label="More info about Legacy encryption"
                            >
                              <HelpCircle size={14} />
                            </button>
                            {showLegacyTooltip && (
                              <div className={styles.tooltip}>
                                <strong>Legacy Encryption</strong>
                                <p>Uses AES-256-GCM with PBKDF2. Signet-specific, not portable.</p>
                              </div>
                            )}
                          </label>
                        </div>
                        <input
                          type="password"
                          className={styles.input}
                          value={encryptPassphrase}
                          onChange={(e) => setEncryptPassphrase(e.target.value)}
                          placeholder="Passphrase"
                          aria-label="Encryption passphrase"
                          autoFocus
                        />
                        <input
                          type="password"
                          className={styles.input}
                          value={encryptConfirmPassphrase}
                          onChange={(e) => setEncryptConfirmPassphrase(e.target.value)}
                          placeholder="Confirm passphrase"
                          aria-label="Confirm encryption passphrase"
                          aria-invalid={encryptPassphrase && encryptConfirmPassphrase && encryptPassphrase !== encryptConfirmPassphrase ? true : undefined}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && encryptPassphrase && encryptPassphrase === encryptConfirmPassphrase) {
                              handleEncrypt();
                            }
                            if (e.key === 'Escape') cancelEncrypt();
                          }}
                        />
                        {encryptPassphrase && encryptConfirmPassphrase && encryptPassphrase !== encryptConfirmPassphrase && (
                          <span className={styles.passphraseMismatch} role="alert">Passphrases do not match</span>
                        )}
                        <div className={styles.setPassphraseActions}>
                          <button
                            type="button"
                            className={styles.saveButton}
                            onClick={handleEncrypt}
                            disabled={encrypting || !encryptPassphrase.trim() || encryptPassphrase !== encryptConfirmPassphrase}
                          >
                            {encrypting ? 'Encrypting...' : 'Encrypt Key'}
                          </button>
                          <button type="button" className={styles.cancelButton} onClick={cancelEncrypt}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className={styles.securityWarning}>
                        <p>This key is stored unencrypted. Anyone with access to the config file can read it.</p>
                        <button type="button" className={styles.setPassphraseButton} onClick={startEncrypt}>
                          <Lock size={14} />
                          Add Encryption
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* Legacy encrypted - show migrate option */}
                {key.isEncrypted && key.encryptionFormat === 'legacy' && (
                  <>
                    {isMigrating ? (
                      <div className={styles.migrateForm}>
                        <p className={styles.migrateHint}>
                          Upgrade to NIP-49 encryption for better portability. Enter your current passphrase.
                        </p>
                        <input
                          type="password"
                          className={styles.input}
                          value={migratePassphrase}
                          onChange={(e) => setMigratePassphrase(e.target.value)}
                          placeholder="Current passphrase"
                          aria-label="Current passphrase for migration"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && migratePassphrase) handleMigrate();
                            if (e.key === 'Escape') cancelMigrate();
                          }}
                        />
                        <div className={styles.setPassphraseActions}>
                          <button
                            type="button"
                            className={styles.saveButton}
                            onClick={handleMigrate}
                            disabled={migrating || !migratePassphrase.trim()}
                          >
                            {migrating ? 'Migrating...' : 'Migrate to NIP-49'}
                          </button>
                          <button type="button" className={styles.cancelButton} onClick={cancelMigrate}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className={styles.migrateInfo}>
                        <p>Using legacy encryption. Consider upgrading to NIP-49 for portability.</p>
                        <button type="button" className={styles.migrateButton} onClick={startMigrate}>
                          <ArrowUpCircle size={14} />
                          Migrate to NIP-49
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* NIP-49 encrypted - show badge info */}
                {key.isEncrypted && key.encryptionFormat === 'nip49' && (
                  <p className={styles.encryptionInfo}>
                    Using NIP-49 encryption. Key can be exported as portable ncryptsec.
                  </p>
                )}
              </div>

              {/* Export section - for all keys */}
              <div className={styles.detailSection}>
                <button
                  type="button"
                  className={styles.expandableLabel}
                  onClick={() => isExporting ? cancelExport() : startExport()}
                  aria-expanded={isExporting}
                >
                  <span className={styles.expandableLabelLeft}>
                    <Download size={14} />
                    Export
                  </span>
                  <ChevronDown size={14} className={isExporting ? styles.chevronExpanded : ''} />
                </button>
                {isExporting && (
                  <div className={styles.exportForm}>
                    <div className={styles.radioGroup}>
                      <label className={styles.radioLabel}>
                        <input
                          type="radio"
                          name="exportFormat"
                          value="nip49"
                          checked={exportFormat === 'nip49'}
                          onChange={() => setExportFormat('nip49')}
                          className={styles.radioInput}
                        />
                        <span>NIP-49 (ncryptsec)</span>
                      </label>
                      <label className={styles.radioLabel}>
                        <input
                          type="radio"
                          name="exportFormat"
                          value="nsec"
                          checked={exportFormat === 'nsec'}
                          onChange={() => setExportFormat('nsec')}
                          className={styles.radioInput}
                        />
                        <span>Plain nsec</span>
                      </label>
                    </div>

                    {/* Export passphrase for NIP-49 export */}
                    {exportFormat === 'nip49' && (
                      <>
                        <input
                          type="password"
                          className={styles.input}
                          value={exportNewPassphrase}
                          onChange={(e) => setExportNewPassphrase(e.target.value)}
                          placeholder="Export passphrase"
                          aria-label="Passphrase for exported key"
                          autoFocus
                        />
                        <input
                          type="password"
                          className={styles.input}
                          value={exportConfirmPassphrase}
                          onChange={(e) => setExportConfirmPassphrase(e.target.value)}
                          placeholder="Confirm export passphrase"
                          aria-label="Confirm export passphrase"
                          aria-invalid={exportNewPassphrase && exportConfirmPassphrase && exportNewPassphrase !== exportConfirmPassphrase ? true : undefined}
                        />
                        {exportNewPassphrase && exportConfirmPassphrase && exportNewPassphrase !== exportConfirmPassphrase && (
                          <span className={styles.passphraseMismatch} role="alert">Passphrases do not match</span>
                        )}
                      </>
                    )}

                    {exportFormat === 'nsec' && (
                      <p className={styles.exportWarning}>
                        Warning: Plain nsec can be read by anyone who sees it.
                      </p>
                    )}

                    <button
                      type="button"
                      className={styles.saveButton}
                      onClick={handleExport}
                      disabled={
                        exporting ||
                        (exportFormat === 'nip49' && (!exportNewPassphrase.trim() || exportNewPassphrase !== exportConfirmPassphrase))
                      }
                    >
                      {exporting ? 'Exporting...' : 'Download'}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {apps.length > 0 && (
            <div className={styles.detailSection}>
              <button
                type="button"
                className={styles.expandableLabel}
                onClick={() => setShowAllApps(!showAllApps)}
                aria-expanded={showAllApps}
              >
                <span className={styles.expandableLabelLeft}>
                  <Users size={14} />
                  Connected Apps
                </span>
                <span className={styles.expandableLabelRight}>
                  <span className={styles.countBadge}>{apps.length}</span>
                  <ChevronDown size={14} className={showAllApps ? styles.chevronExpanded : ''} />
                </span>
              </button>
              {showAllApps && (
                <div className={styles.appsList}>
                  {apps.map(app => {
                    const trustInfo = getTrustLevelInfo(app.trustLevel);
                    const displayName = app.description || toNpub(app.userPubkey).slice(0, 12) + '...';
                    return (
                      <div key={app.id} className={styles.appItem}>
                        <span className={styles.appName}>{displayName}</span>
                        <span className={`${styles.appTrust} ${styles[app.trustLevel]}`}>
                          {trustInfo.label}
                        </span>
                        <span className={styles.appRequests}>
                          {app.requestCount} req
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className={styles.actions}>
            {isRenaming ? (
              <div className={styles.renameRow}>
                <input
                  type="text"
                  className={styles.input}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="New key name"
                  aria-label="New key name"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename();
                    if (e.key === 'Escape') cancelRename();
                  }}
                />
                <button
                  type="button"
                  className={styles.saveButton}
                  onClick={handleRename}
                  disabled={renaming || !editName.trim() || editName.trim() === key.name}
                >
                  {renaming ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  className={styles.cancelButton}
                  onClick={cancelRename}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className={styles.renameButton}
                  onClick={startRename}
                >
                  <Pencil size={16} />
                  Rename
                </button>
                {key.status === 'online' && key.isEncrypted && (
                  <button
                    type="button"
                    className={styles.lockButton}
                    onClick={onLock}
                    disabled={locking === key.name}
                    title="Lock key to remove it from memory"
                  >
                    <Lock size={16} />
                    {locking === key.name ? 'Locking...' : 'Lock'}
                  </button>
                )}
                <button
                  type="button"
                  className={styles.deleteButton}
                  onClick={onDelete}
                >
                  <Trash2 size={16} />
                  Delete Key
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Bunker URI Modal */}
      <BunkerURIModal
        open={showBunkerModal}
        keyName={key.name}
        onClose={() => setShowBunkerModal(false)}
      />
    </div>
  );
}
