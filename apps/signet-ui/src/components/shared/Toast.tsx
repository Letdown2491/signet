import React from 'react';
import { useToast } from '../../contexts/ToastContext.js';
import { CloseIcon } from './Icons.js';
import styles from './Toast.module.css';

export function Toast() {
  const { toast, hideToast } = useToast();

  if (!toast) return null;

  const typeClass = toast.type === 'success' ? styles.success
    : toast.type === 'error' ? styles.error
    : toast.type === 'warning' ? styles.warning
    : styles.notification;

  return (
    <div
      className={`${styles.toast} ${typeClass}`}
      role="alert"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className={styles.message}>{toast.message}</span>
      <div className={styles.actions}>
        {toast.action && toast.actionLabel && (
          <button
            type="button"
            className={styles.actionButton}
            onClick={(e) => {
              e.stopPropagation();
              toast.action?.();
              hideToast();
            }}
          >
            {toast.actionLabel}
          </button>
        )}
        {toast.undo && (
          <button
            type="button"
            className={styles.undoButton}
            onClick={(e) => {
              e.stopPropagation();
              toast.undo?.();
              hideToast();
            }}
          >
            Undo
          </button>
        )}
        <button
          type="button"
          className={styles.closeButton}
          onClick={hideToast}
          aria-label="Dismiss notification"
        >
          <CloseIcon size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
