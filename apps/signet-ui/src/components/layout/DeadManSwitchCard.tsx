import React, { useState, useCallback, useEffect } from 'react';
import { Timer, AlertTriangle, Loader2 } from 'lucide-react';
import { useDeadManSwitch } from '../../hooks/useDeadManSwitch.js';
import styles from './Sidebar.module.css';

interface ResetModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  remainingAttempts?: number;
  onSubmit: (keyName: string, passphrase: string) => void;
  onCancel: () => void;
  keys: Array<{ name: string; status: string; isEncrypted: boolean }>;
}

function ResetModal({ open, loading, error, remainingAttempts, onSubmit, onCancel, keys }: ResetModalProps) {
  const [selectedKey, setSelectedKey] = useState(keys[0]?.name ?? '');
  const [passphrase, setPassphrase] = useState('');
  const prevOpenRef = React.useRef(false);

  // Reset form only when modal opens (transitions from closed to open)
  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setPassphrase('');
      setSelectedKey(keys[0]?.name ?? '');
    }
    prevOpenRef.current = open;
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear passphrase on unmount (security hygiene)
  useEffect(() => {
    return () => setPassphrase('');
  }, []);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedKey && passphrase) {
      onSubmit(selectedKey, passphrase);
    }
  };

  // Filter to only show encrypted keys
  const encryptedKeys = keys.filter(k => k.isEncrypted);

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.modalTitle}>Reset Inactivity Lock</h3>
        <p className={styles.modalDescription}>
          Enter your key passphrase to reset the timer.
        </p>

        <form onSubmit={handleSubmit}>
          {encryptedKeys.length > 1 && (
            <div className={styles.formGroup}>
              <label htmlFor="reset-key">Key</label>
              <select
                id="reset-key"
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                disabled={loading}
              >
                {encryptedKeys.map((key) => (
                  <option key={key.name} value={key.name}>
                    {key.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={styles.formGroup}>
            <label htmlFor="reset-passphrase">Passphrase</label>
            <input
              id="reset-passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter passphrase"
              disabled={loading}
              autoFocus
            />
          </div>

          {error && (
            <div className={styles.formError}>
              {error}
              {remainingAttempts !== undefined && remainingAttempts < 5 && (
                <span> ({remainingAttempts} attempts remaining)</span>
              )}
            </div>
          )}

          <div className={styles.modalActions}>
            <button type="button" onClick={onCancel} disabled={loading} className={styles.btnSecondary}>
              Cancel
            </button>
            <button type="submit" disabled={loading || !passphrase} className={styles.btnPrimary}>
              {loading ? <Loader2 size={16} className={styles.spinning} /> : 'Reset Timer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface DeadManSwitchCardProps {
  keys: Array<{ name: string; status: string; isEncrypted: boolean }>;
}

export function DeadManSwitchCard({ keys }: DeadManSwitchCardProps) {
  const { status, countdown, urgency, reset } = useDeadManSwitch();
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [remainingAttempts, setRemainingAttempts] = useState<number | undefined>();

  const handleResetClick = useCallback(() => {
    setResetError(null);
    setShowResetModal(true);
  }, []);

  const handleResetSubmit = useCallback(async (keyName: string, passphrase: string) => {
    setResetLoading(true);
    setResetError(null);

    const result = await reset(keyName, passphrase);

    setResetLoading(false);

    if (result.ok) {
      setShowResetModal(false);
    } else {
      setResetError(result.error ?? 'Failed to reset timer');
      setRemainingAttempts(result.remainingAttempts);
    }
  }, [reset]);

  const handleResetCancel = useCallback(() => {
    setShowResetModal(false);
    setResetError(null);
  }, []);

  // Don't show if not enabled
  if (!status?.enabled) {
    return null;
  }

  // Determine color class based on urgency
  const urgencyClass = urgency === 'critical'
    ? styles.inactivityLockCritical
    : urgency === 'warning'
      ? styles.inactivityLockWarning
      : '';

  // Show panic state as a special row
  if (status.panicTriggeredAt) {
    return (
      <>
        <button
          type="button"
          className={`${styles.navItem} ${styles.inactivityLockRow} ${styles.inactivityLockCritical}`}
          onClick={handleResetClick}
          title="Inactivity Lock triggered - click to reset"
        >
          <span className={styles.navIcon}>
            <AlertTriangle size={18} />
          </span>
          <span className={styles.navLabel}>Inactivity Lock</span>
          <span className={styles.inactivityLockBadge}>TRIGGERED</span>
        </button>

        <ResetModal
          open={showResetModal}
          loading={resetLoading}
          error={resetError}
          remainingAttempts={remainingAttempts}
          onSubmit={handleResetSubmit}
          onCancel={handleResetCancel}
          keys={keys}
        />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.navItem} ${styles.inactivityLockRow} ${urgencyClass}`}
        onClick={handleResetClick}
        title="Click to reset timer"
      >
        <span className={styles.navIcon}>
          <Timer size={18} />
        </span>
        <span className={styles.navLabel}>Inactivity Lock</span>
        <span className={`${styles.inactivityLockCountdown} ${urgencyClass}`}>
          {countdown}
        </span>
      </button>

      <ResetModal
        open={showResetModal}
        loading={resetLoading}
        error={resetError}
        remainingAttempts={remainingAttempts}
        onSubmit={handleResetSubmit}
        onCancel={handleResetCancel}
        keys={keys}
      />
    </>
  );
}
