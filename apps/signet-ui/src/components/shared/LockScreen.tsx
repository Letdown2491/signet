import React, { useState, useCallback, useEffect } from 'react';
import { AlertTriangle, Loader2, KeyRound } from 'lucide-react';
import type { KeyInfo } from '@signet/types';
import styles from './LockScreen.module.css';

interface LockScreenProps {
  triggeredAt: number | null | undefined;
  keys: KeyInfo[];
  onRecover: (keyName: string, passphrase: string, resumeApps: boolean) => Promise<{ ok: boolean; error?: string }>;
}

export function LockScreen({
  triggeredAt,
  keys,
  onRecover,
}: LockScreenProps) {
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [passphrase, setPassphrase] = useState('');
  const [resumeApps, setResumeApps] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Get encrypted (locked) keys that can be unlocked
  const lockedKeys = keys.filter(k => k.status === 'locked' && k.isEncrypted);

  // Set default selected key
  useEffect(() => {
    if (lockedKeys.length > 0 && !selectedKey) {
      setSelectedKey(lockedKeys[0].name);
    }
  }, [lockedKeys, selectedKey]);

  // Clear passphrase on unmount (security hygiene)
  useEffect(() => {
    return () => setPassphrase('');
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedKey || !passphrase || submitting) return;

    setError(null);
    setSubmitting(true);

    try {
      const result = await onRecover(selectedKey, passphrase, resumeApps);

      if (result.ok) {
        setPassphrase('');
      } else {
        setError(result.error ?? 'Invalid passphrase. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  }, [selectedKey, passphrase, resumeApps, onRecover, submitting]);

  // Format triggered timestamp
  const formatTriggeredTime = () => {
    if (!triggeredAt) return '';
    const date = new Date(triggeredAt * 1000);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <div className={styles.lockScreen}>
      <div className={styles.content}>
        <div className={styles.iconContainer}>
          <AlertTriangle size={48} />
        </div>

        <h1 className={styles.title}>Inactivity Lock Triggered</h1>

        <p className={styles.description}>
          All keys have been locked and all apps suspended due to inactivity.
          {triggeredAt && (
            <span className={styles.timestamp}>
              {' '}Triggered {formatTriggeredTime()}.
            </span>
          )}
        </p>

        <div className={styles.card}>
          <h2 className={styles.cardTitle}>
            <KeyRound size={18} />
            Unlock a Key to Recover
          </h2>

          {lockedKeys.length === 0 ? (
            <p className={styles.noKeys}>
              No locked keys available. All keys may already be unlocked, or no encrypted keys exist.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className={styles.form}>
              {lockedKeys.length > 1 && (
                <div className={styles.formGroup}>
                  <label htmlFor="lock-screen-key">Key</label>
                  <select
                    id="lock-screen-key"
                    value={selectedKey}
                    onChange={(e) => setSelectedKey(e.target.value)}
                    disabled={submitting}
                  >
                    {lockedKeys.map((key) => (
                      <option key={key.name} value={key.name}>
                        {key.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {lockedKeys.length === 1 && (
                <p className={styles.singleKey}>
                  Unlocking key: <strong>{lockedKeys[0].name}</strong>
                </p>
              )}

              <div className={styles.formGroup}>
                <label htmlFor="lock-screen-passphrase">Passphrase</label>
                <input
                  id="lock-screen-passphrase"
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  placeholder="Enter your key passphrase"
                  disabled={submitting}
                  autoFocus
                />
              </div>

              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={resumeApps}
                  onChange={(e) => setResumeApps(e.target.checked)}
                  disabled={submitting}
                />
                <span>Also resume all suspended apps</span>
              </label>

              {error && (
                <div className={styles.error}>{error}</div>
              )}

              <button
                type="submit"
                className={styles.submitButton}
                disabled={submitting || !passphrase}
              >
                {submitting ? (
                  <>
                    <Loader2 size={16} className={styles.spinning} />
                    Recovering...
                  </>
                ) : (
                  'Unlock & Recover'
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
