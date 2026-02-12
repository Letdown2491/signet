import React, { useState, useMemo, useEffect } from 'react';
import type { KeyInfo, ConnectedApp } from '@signet/types';
import { LoadingSpinner } from '../shared/LoadingSpinner.js';
import { ConfirmDialog } from '../shared/ConfirmDialog.js';
import { QRModal } from '../shared/QRModal.js';
import { PageHeader } from '../shared/PageHeader.js';
import { Key, Lock, Plus, Loader2 } from 'lucide-react';
import { CreateKeyModal } from './CreateKeyModal.js';
import { KeyCard } from './KeyCard.js';
import styles from './KeysPanel.module.css';

interface KeysPanelProps {
  keys: KeyInfo[];
  apps: ConnectedApp[];
  loading: boolean;
  error: string | null;
  creating: boolean;
  deleting: boolean;
  unlocking: string | null;
  locking: string | null;
  lockingAll: boolean;
  renaming: boolean;
  encrypting: boolean;
  migrating: boolean;
  exporting: boolean;
  forceShowCreateForm?: boolean;
  onCreateKey: (data: { keyName: string; passphrase?: string; nsec?: string }) => Promise<KeyInfo | null>;
  onDeleteKey: (keyName: string, passphrase?: string) => Promise<{ success: boolean; revokedApps?: number }>;
  onUnlockKey: (keyName: string, passphrase: string) => Promise<boolean>;
  onLockKey: (keyName: string) => Promise<boolean>;
  onLockAllKeys: () => Promise<{ success: boolean; lockedCount?: number }>;
  onRenameKey: (keyName: string, newName: string) => Promise<boolean>;
  onEncryptKey: (keyName: string, encryption: 'nip49' | 'legacy', passphrase: string, confirmPassphrase: string) => Promise<boolean>;
  onMigrateKey: (keyName: string, passphrase: string) => Promise<boolean>;
  onExportKey: (keyName: string, format: 'nsec' | 'nip49', currentPassphrase?: string, exportPassphrase?: string, confirmExportPassphrase?: string) => Promise<{ key?: string; format?: 'nsec' | 'ncryptsec' } | null>;
  onClearError: () => void;
  onCreateFormClose?: () => void;
}

export function KeysPanel({
  keys,
  apps,
  loading,
  error,
  creating,
  deleting,
  unlocking,
  locking,
  lockingAll,
  renaming,
  encrypting,
  migrating,
  exporting,
  forceShowCreateForm,
  onCreateKey,
  onDeleteKey,
  onUnlockKey,
  onLockKey,
  onLockAllKeys,
  onRenameKey,
  onEncryptKey,
  onMigrateKey,
  onExportKey,
  onClearError,
  onCreateFormClose,
}: KeysPanelProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<KeyInfo | null>(null);
  const [deletePassphrase, setDeletePassphrase] = useState('');
  const [qrModal, setQrModal] = useState<{ value: string; title: string } | null>(null);
  const [showLockAllConfirm, setShowLockAllConfirm] = useState(false);

  // Respond to external trigger to show create form
  useEffect(() => {
    if (forceShowCreateForm) {
      setShowCreateForm(true);
      onClearError();
    }
  }, [forceShowCreateForm, onClearError]);

  // Count lockable keys (online + encrypted)
  const lockableKeysCount = useMemo(() =>
    keys.filter(k => k.status === 'online' && k.isEncrypted).length,
    [keys]
  );

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [keys]);

  const getAppsForKey = (keyName: string): ConnectedApp[] => {
    return apps.filter(app => app.keyName === keyName);
  };

  const isKeyEncrypted = (key: KeyInfo): boolean => {
    return key.status === 'locked';
  };

  const handleCreateKey = async (data: { keyName: string; passphrase?: string; nsec?: string }): Promise<boolean> => {
    const result = await onCreateKey(data);
    if (result) {
      setShowCreateForm(false);
      onCreateFormClose?.();
      return true;
    }
    return false;
  };

  const handleDeleteClick = (key: KeyInfo) => {
    setDeleteConfirm(key);
    setDeletePassphrase('');
    onClearError();
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;

    const needsPassphrase = isKeyEncrypted(deleteConfirm);
    if (needsPassphrase && !deletePassphrase.trim()) {
      return;
    }

    const result = await onDeleteKey(
      deleteConfirm.name,
      needsPassphrase ? deletePassphrase : undefined
    );

    if (result.success) {
      setDeleteConfirm(null);
      setDeletePassphrase('');
      setExpandedKey(null);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirm(null);
    setDeletePassphrase('');
    onClearError();
  };

  const handleToggleExpand = (keyName: string) => {
    setExpandedKey(expandedKey === keyName ? null : keyName);
  };

  const handleRename = async (keyName: string, newName: string): Promise<boolean> => {
    const success = await onRenameKey(keyName, newName);
    if (success) {
      setExpandedKey(newName);
    }
    return success;
  };

  const handleLockAllConfirm = async () => {
    const result = await onLockAllKeys();
    if (result.success) {
      setShowLockAllConfirm(false);
    }
  };

  if (loading && keys.length === 0) {
    return <LoadingSpinner text="Loading keys..." />;
  }

  return (
    <div className={styles.container}>
      <PageHeader
        title="Keys"
        count={keys.length}
        action={
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => setShowLockAllConfirm(true)}
              disabled={lockableKeysCount === 0 || lockingAll}
              title="Lock all keys"
              aria-label="Lock all keys"
            >
              {lockingAll ? <Loader2 size={16} className={styles.spinning} /> : <Lock size={16} />}
            </button>
            <button
              type="button"
              className={styles.iconButton}
              onClick={() => {
                setShowCreateForm(true);
                onClearError();
              }}
              title="Add key"
              aria-label="Add key"
            >
              <Plus size={16} />
            </button>
          </div>
        }
      />

      {error && <div className={styles.error}>{error}</div>}

      <CreateKeyModal
        open={showCreateForm}
        creating={creating}
        onSubmit={handleCreateKey}
        onClose={() => {
          setShowCreateForm(false);
          onCreateFormClose?.();
        }}
      />

      {keys.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>
            <Key size={48} />
          </div>
          <p>No keys configured</p>
          <p className={styles.emptyHint}>Add your first key to get started</p>
        </div>
      ) : (
        <div className={styles.keyList}>
          {keys.map(key => (
            <KeyCard
              key={key.name}
              keyInfo={key}
              apps={getAppsForKey(key.name)}
              expanded={expandedKey === key.name}
              now={now}
              unlocking={unlocking}
              locking={locking}
              renaming={renaming}
              encrypting={encrypting}
              migrating={migrating}
              exporting={exporting}
              onToggleExpand={() => handleToggleExpand(key.name)}
              onUnlock={(passphrase) => onUnlockKey(key.name, passphrase)}
              onLock={() => onLockKey(key.name)}
              onRename={(newName) => handleRename(key.name, newName)}
              onEncrypt={(encryption, passphrase, confirmPassphrase) => onEncryptKey(key.name, encryption, passphrase, confirmPassphrase)}
              onMigrate={(passphrase) => onMigrateKey(key.name, passphrase)}
              onExport={(format, currentPassphrase, exportPassphrase, confirmExportPassphrase) => onExportKey(key.name, format, currentPassphrase, exportPassphrase, confirmExportPassphrase)}
              onDelete={() => handleDeleteClick(key)}
              onShowQR={(value, title) => setQrModal({ value, title })}
              onClearError={onClearError}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirm !== null}
        title="Delete Key"
        message={
          deleteConfirm ? (
            <div className={styles.deleteConfirmContent}>
              <p>
                Are you sure you want to delete the key <strong>{deleteConfirm.name}</strong>?
              </p>
              {deleteConfirm.userCount > 0 && (
                <p className={styles.deleteWarning}>
                  This will revoke access for {deleteConfirm.userCount} connected app{deleteConfirm.userCount !== 1 ? 's' : ''}.
                </p>
              )}
              <p className={styles.deleteWarning}>
                This action cannot be undone.
              </p>
              {isKeyEncrypted(deleteConfirm) && (
                <div className={styles.deletePassphraseInput}>
                  <label htmlFor="delete-passphrase">Enter passphrase to confirm:</label>
                  <input
                    id="delete-passphrase"
                    type="password"
                    value={deletePassphrase}
                    onChange={(e) => setDeletePassphrase(e.target.value)}
                    placeholder="Enter key passphrase"
                    className={styles.input}
                    autoComplete="off"
                  />
                </div>
              )}
              {error && <p className={styles.deleteError}>{error}</p>}
            </div>
          ) : ''
        }
        confirmLabel={deleting ? 'Deleting...' : 'Delete Key'}
        danger
        disabled={deleting || (deleteConfirm !== null && isKeyEncrypted(deleteConfirm) && !deletePassphrase.trim())}
        onConfirm={handleDeleteConfirm}
        onCancel={handleDeleteCancel}
      />

      <QRModal
        open={qrModal !== null}
        onClose={() => setQrModal(null)}
        value={qrModal?.value ?? ''}
        title={qrModal?.title}
      />

      <ConfirmDialog
        open={showLockAllConfirm}
        title="Lock All Keys"
        message={
          <div>
            <p>
              Lock all <strong>{lockableKeysCount}</strong> {lockableKeysCount === 1 ? 'key' : 'keys'}?
            </p>
            <p className={styles.deleteWarning}>
              You'll need to enter passphrases to unlock them.
            </p>
          </div>
        }
        confirmLabel={lockingAll ? 'Locking...' : 'Lock All'}
        danger
        disabled={lockingAll}
        onConfirm={handleLockAllConfirm}
        onCancel={() => setShowLockAllConfirm(false)}
      />
    </div>
  );
}
