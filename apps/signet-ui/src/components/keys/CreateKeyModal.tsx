import React, { useEffect, useRef } from 'react';
import { Key, X } from 'lucide-react';
import type { EncryptionFormat } from '@signet/types';
import { CreateKeyForm } from './CreateKeyForm.js';
import styles from './CreateKeyModal.module.css';

interface CreateKeyModalProps {
  open: boolean;
  creating: boolean;
  onSubmit: (data: {
    keyName: string;
    passphrase?: string;
    confirmPassphrase?: string;
    nsec?: string;
    encryption?: EncryptionFormat;
  }) => Promise<boolean>;
  onClose: () => void;
}

export function CreateKeyModal({
  open,
  creating,
  onSubmit,
  onClose,
}: CreateKeyModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Handle escape key
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !creating) {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, creating, onClose]);

  // Focus trap
  useEffect(() => {
    if (!open) return;

    const modal = modalRef.current;
    if (!modal) return;

    const focusableElements = modal.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTab);
    firstElement?.focus();

    return () => document.removeEventListener('keydown', handleTab);
  }, [open]);

  if (!open) return null;

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !creating) {
      onClose();
    }
  };

  return (
    <div
      className={styles.overlay}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-key-title"
    >
      <div className={styles.modal} ref={modalRef}>
        <div className={styles.header}>
          <div className={styles.icon}>
            <Key size={20} />
          </div>
          <div>
            <h2 id="create-key-title" className={styles.title}>Add Key</h2>
            <p className={styles.subtitle}>Generate a new key or import an existing one</p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            disabled={creating}
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        <div className={styles.content}>
          <CreateKeyForm
            creating={creating}
            onSubmit={onSubmit}
            onCancel={onClose}
          />
        </div>
      </div>
    </div>
  );
}
