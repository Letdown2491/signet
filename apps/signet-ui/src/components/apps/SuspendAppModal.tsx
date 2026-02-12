import React, { useState, useEffect, useCallback } from 'react';
import { Pause, Loader2 } from 'lucide-react';
import styles from './SuspendAppModal.module.css';

interface SuspendAppModalProps {
  open: boolean;
  /** Single app name for individual suspend */
  appName?: string;
  /** Number of apps for bulk suspend (mutually exclusive with appName) */
  appCount?: number;
  loading: boolean;
  error: string | null;
  onSubmit: (until?: Date) => void;
  onCancel: () => void;
}

export function SuspendAppModal({
  open,
  appName,
  appCount,
  loading,
  error,
  onSubmit,
  onCancel,
}: SuspendAppModalProps) {
  const isBulkMode = appCount !== undefined && appCount > 0;
  const [suspendType, setSuspendType] = useState<'indefinite' | 'until'>('indefinite');
  const [dateValue, setDateValue] = useState('');
  const [timeValue, setTimeValue] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reset form when modal opens/closes
  useEffect(() => {
    if (open) {
      setSuspendType('indefinite');
      setDateValue('');
      setTimeValue('');
      setValidationError(null);
    }
  }, [open]);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    if (suspendType === 'indefinite') {
      onSubmit(undefined);
    } else {
      if (!dateValue || !timeValue) {
        setValidationError('Please select both date and time');
        return;
      }

      const selectedDate = new Date(`${dateValue}T${timeValue}`);
      if (isNaN(selectedDate.getTime())) {
        setValidationError('Invalid date or time');
        return;
      }

      if (selectedDate.getTime() <= Date.now()) {
        setValidationError('Selected time must be in the future');
        return;
      }

      onSubmit(selectedDate);
    }
  }, [suspendType, dateValue, timeValue, onSubmit]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  }, [onCancel]);

  // Get minimum date (today) for the date picker
  const getMinDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  if (!open) return null;

  const displayError = validationError || error;

  return (
    <div className={styles.overlay} onClick={onCancel} onKeyDown={handleKeyDown}>
      <div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="suspend-modal-title"
      >
        <div className={styles.header}>
          <div className={styles.icon}>
            <Pause size={20} />
          </div>
          <h2 id="suspend-modal-title" className={styles.title}>
            {isBulkMode ? 'Suspend All Apps' : 'Suspend App'}
          </h2>
        </div>

        <p className={styles.description}>
          {isBulkMode ? (
            <>Suspend <strong>{appCount} {appCount === 1 ? 'app' : 'apps'}</strong> to temporarily block all signing requests.</>
          ) : (
            <>Suspend <strong>{appName}</strong> to temporarily block all signing requests.</>
          )}
        </p>

        <form onSubmit={handleSubmit}>
          <div className={styles.options}>
            <label className={styles.option}>
              <input
                type="radio"
                name="suspendType"
                value="indefinite"
                checked={suspendType === 'indefinite'}
                onChange={() => setSuspendType('indefinite')}
                disabled={loading}
              />
              <span className={styles.optionLabel}>Until I turn it back on</span>
            </label>

            <label className={styles.option}>
              <input
                type="radio"
                name="suspendType"
                value="until"
                checked={suspendType === 'until'}
                onChange={() => setSuspendType('until')}
                disabled={loading}
              />
              <span className={styles.optionLabel}>Until a specific date and time</span>
            </label>
          </div>

          {suspendType === 'until' && (
            <div className={styles.dateTimePicker}>
              <div className={styles.dateTimeRow}>
                <input
                  type="date"
                  className={styles.dateInput}
                  value={dateValue}
                  onChange={(e) => setDateValue(e.target.value)}
                  min={getMinDate()}
                  disabled={loading}
                  aria-label="Suspension end date"
                />
                <input
                  type="time"
                  className={styles.timeInput}
                  value={timeValue}
                  onChange={(e) => setTimeValue(e.target.value)}
                  disabled={loading}
                  aria-label="Suspension end time"
                />
              </div>
            </div>
          )}

          {displayError && (
            <p className={styles.error}>{displayError}</p>
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
              disabled={loading}
            >
              {loading ? (
                <>
                  <Loader2 size={14} className={styles.spinning} />
                  Suspending...
                </>
              ) : (
                isBulkMode ? 'Suspend All' : 'Suspend'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
