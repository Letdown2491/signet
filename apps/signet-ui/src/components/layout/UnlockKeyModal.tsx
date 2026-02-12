import React, { useState, useEffect, useCallback } from 'react';
import { Key, Loader2 } from 'lucide-react';
import styles from './UnlockKeyModal.module.css';

interface UnlockKeyModalProps {
  open: boolean;
  keyName: string;
  loading: boolean;
  error: string | null;
  onSubmit: (passphrase: string) => void;
  onCancel: () => void;
}

export function UnlockKeyModal({
  open,
  keyName,
  loading,
  error,
  onSubmit,
  onCancel,
}: UnlockKeyModalProps) {
  const [passphrase, setPassphrase] = useState('');

  // Reset passphrase when modal opens/closes
  useEffect(() => {
    if (open) {
      setPassphrase('');
    }
  }, [open]);

  // Clear passphrase on unmount (security hygiene)
  useEffect(() => {
    return () => setPassphrase('');
  }, []);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (passphrase.trim()) {
      onSubmit(passphrase);
    }
  }, [passphrase, onSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  }, [onCancel]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onCancel} onKeyDown={handleKeyDown}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="unlock-modal-title"
      >
        <div className={styles.header}>
          <div className={styles.icon}>
            <Key size={20} />
          </div>
          <h2 id="unlock-modal-title" className={styles.title}>
            Unlock Key
          </h2>
        </div>

        <p className={styles.description}>
          Enter the passphrase for <strong>{keyName}</strong> to unlock it.
        </p>

        <form onSubmit={handleSubmit}>
          <input
            type="password"
            className={styles.input}
            placeholder="Passphrase"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoFocus
            disabled={loading}
            aria-label="Passphrase"
          />

          {error && (
            <p className={styles.error}>{error}</p>
          )}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={onCancel}
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={loading || !passphrase.trim()}
            >
              {loading ? (
                <>
                  <Loader2 size={14} className={styles.spinning} />
                  Unlocking...
                </>
              ) : (
                'Unlock'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
