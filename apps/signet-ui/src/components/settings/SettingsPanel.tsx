import React, { useState, useCallback } from 'react';
import type { TrustLevel, KeyInfo, RelayStatusResponse } from '@signet/types';
import { Loader2 } from 'lucide-react';
import { useSettings } from '../../contexts/SettingsContext.js';
import { getTrustLevelInfo } from '../../lib/event-labels.js';
import { useDeadManSwitch } from '../../hooks/useDeadManSwitch.js';
import { RelayManager } from './RelayManager.js';
import styles from './SettingsPanel.module.css';

const TRUST_LEVELS: TrustLevel[] = ['paranoid', 'reasonable', 'full'];

type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

type TimeUnit = 'minutes' | 'hours' | 'days';

const TIME_UNIT_SECONDS: Record<TimeUnit, number> = {
  minutes: 60,
  hours: 60 * 60,
  days: 24 * 60 * 60,
};

// Convert seconds to value + unit (picks the most natural unit)
function secondsToValueUnit(seconds: number): { value: number; unit: TimeUnit } {
  if (seconds % TIME_UNIT_SECONDS.days === 0) {
    return { value: seconds / TIME_UNIT_SECONDS.days, unit: 'days' };
  }
  if (seconds % TIME_UNIT_SECONDS.hours === 0) {
    return { value: seconds / TIME_UNIT_SECONDS.hours, unit: 'hours' };
  }
  return { value: seconds / TIME_UNIT_SECONDS.minutes, unit: 'minutes' };
}

// Convert value + unit to seconds
function valueUnitToSeconds(value: number, unit: TimeUnit): number {
  return Math.max(60, Math.round(value * TIME_UNIT_SECONDS[unit])); // Minimum 1 minute
}

// Get human-readable timeframe label
function getTimeframeLabel(seconds: number): string {
  const { value, unit } = secondsToValueUnit(seconds);
  if (value === 1) {
    return `1 ${unit.slice(0, -1)}`; // Remove 's' for singular
  }
  return `${value} ${unit}`;
}

interface SettingsPanelProps {
  notificationPermission: NotificationPermissionState;
  onRequestNotificationPermission: () => void;
  keys: KeyInfo[];
  relays: RelayStatusResponse | null;
  relaysMutating: boolean;
  onAddRelay: (url: string) => Promise<{ ok: boolean; error?: string }>;
  onRemoveRelay: (url: string) => Promise<{ ok: boolean; error?: string }>;
}

export function SettingsPanel({
  notificationPermission,
  onRequestNotificationPermission,
  keys,
  relays,
  relaysMutating,
  onAddRelay,
  onRemoveRelay,
}: SettingsPanelProps) {
  const { settings, updateSettings } = useSettings();
  const deadman = useDeadManSwitch();

  // DMS state
  const [dmsLoading, setDmsLoading] = useState(false);
  const [dmsError, setDmsError] = useState<string | null>(null);
  const [showEnableModal, setShowEnableModal] = useState(false);
  const [showDisableModal, setShowDisableModal] = useState(false);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [pendingTimeframe, setPendingTimeframe] = useState<number>(7 * 24 * 60 * 60);

  // Check if any encrypted key exists
  const hasEncryptedKey = keys.some(k => k.isEncrypted);
  const encryptedKeys = keys.filter(k => k.isEncrypted);

  const handleEnableDMS = useCallback(async (timeframeSec: number) => {
    setDmsLoading(true);
    setDmsError(null);
    const result = await deadman.enable(timeframeSec);
    setDmsLoading(false);
    if (result.ok) {
      setShowEnableModal(false);
    } else {
      setDmsError(result.error ?? 'Failed to enable');
    }
  }, [deadman]);

  const handleDisableDMS = useCallback(async (keyName: string, passphrase: string) => {
    setDmsLoading(true);
    setDmsError(null);
    const result = await deadman.disable(keyName, passphrase);
    setDmsLoading(false);
    if (result.ok) {
      setShowDisableModal(false);
    } else {
      setDmsError(result.error ?? 'Failed to disable');
    }
  }, [deadman]);

  const handleUpdateTimeframe = useCallback(async (keyName: string, passphrase: string, timeframeSec: number) => {
    setDmsLoading(true);
    setDmsError(null);
    const result = await deadman.updateTimeframe(keyName, passphrase, timeframeSec);
    setDmsLoading(false);
    if (result.ok) {
      setShowConfigModal(false);
    } else {
      setDmsError(result.error ?? 'Failed to update');
    }
  }, [deadman]);

  const handleToggleClick = useCallback(() => {
    if (!hasEncryptedKey) return;

    setDmsError(null);
    if (deadman.status?.enabled) {
      setShowDisableModal(true);
    } else {
      setPendingTimeframe(deadman.status?.timeframeSec ?? 7 * 24 * 60 * 60);
      setShowEnableModal(true);
    }
  }, [hasEncryptedKey, deadman.status?.enabled, deadman.status?.timeframeSec]);

  const handleConfigClick = useCallback(() => {
    if (!deadman.status?.enabled) return;
    setDmsError(null);
    setPendingTimeframe(deadman.status.timeframeSec);
    setShowConfigModal(true);
  }, [deadman.status?.enabled, deadman.status?.timeframeSec]);

  // Build DMS description
  const getDmsDescription = () => {
    if (!hasEncryptedKey) {
      return 'Requires an encrypted key';
    }
    if (deadman.status?.panicTriggeredAt) {
      return 'Panic triggered - all keys locked';
    }
    if (deadman.status?.enabled) {
      const timeframeLabel = getTimeframeLabel(deadman.status.timeframeSec);
      return `${deadman.countdown} remaining · ${timeframeLabel} timeframe`;
    }
    return 'Lock keys and suspend apps after inactivity';
  };

  return (
    <div className={styles.container}>
      <h2 className={styles.title}>Settings</h2>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Default Trust Level</h3>
        <p className={styles.sectionDescription}>
          Pre-selected trust level when approving new app connections.
          You can still change this per-request.
        </p>

        <div className={styles.trustLevelOptions}>
          {TRUST_LEVELS.map((level) => {
            const info = getTrustLevelInfo(level);
            return (
              <label key={level} className={styles.trustLevelOption}>
                <input
                  type="radio"
                  name="defaultTrustLevel"
                  value={level}
                  checked={settings.defaultTrustLevel === level}
                  onChange={() => updateSettings({ defaultTrustLevel: level })}
                  className={styles.trustLevelRadio}
                />
                <span className={`${styles.trustLevelLabel} ${styles[level]}`}>
                  <info.Icon size={16} aria-hidden="true" />
                  <span className={styles.trustLevelName}>{info.label}</span>
                </span>
                <span className={styles.trustLevelDescription}>{info.description}</span>
              </label>
            );
          })}
        </div>
      </div>

      <RelayManager
        relays={relays}
        mutating={relaysMutating}
        onAddRelay={onAddRelay}
        onRemoveRelay={onRemoveRelay}
      />

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>Security & Alerts</h3>

        <div className={styles.setting}>
          <div className={styles.settingInfo}>
            <span className={styles.settingLabel}>Browser notifications</span>
            <span className={styles.settingDescription}>
              Get notified when new requests arrive
            </span>
          </div>

          {notificationPermission === 'unsupported' ? (
            <span className={styles.unsupported}>Not supported</span>
          ) : notificationPermission === 'denied' ? (
            <span className={styles.denied}>Blocked by browser</span>
          ) : notificationPermission === 'granted' ? (
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={settings.notificationsEnabled}
                onChange={(e) => updateSettings({ notificationsEnabled: e.target.checked })}
                aria-label="Enable browser notifications"
              />
              <span className={styles.toggleSlider} />
            </label>
          ) : (
            <button
              type="button"
              className={styles.enableButton}
              onClick={onRequestNotificationPermission}
            >
              Enable
            </button>
          )}
        </div>

        <div className={styles.setting}>
          <div
            className={styles.settingInfo}
            onClick={deadman.status?.enabled ? handleConfigClick : undefined}
            style={{ cursor: deadman.status?.enabled ? 'pointer' : 'default' }}
          >
            <span className={styles.settingLabel}>
              Inactivity Lock
              {deadman.status?.enabled && (
                <span className={styles.configLink}> · Configure</span>
              )}
            </span>
            <span className={`${styles.settingDescription} ${
              deadman.status?.panicTriggeredAt ? styles.settingDescriptionDanger :
              deadman.status?.enabled && deadman.urgency === 'critical' ? styles.settingDescriptionDanger :
              deadman.status?.enabled && deadman.urgency === 'warning' ? styles.settingDescriptionWarning :
              ''
            }`}>
              {getDmsDescription()}
            </span>
          </div>

          {hasEncryptedKey ? (
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={deadman.status?.enabled ?? false}
                onChange={handleToggleClick}
                disabled={dmsLoading || deadman.loading}
                aria-label="Enable Inactivity Lock"
              />
              <span className={styles.toggleSlider} />
            </label>
          ) : (
            <span className={styles.unsupported}>No encrypted key</span>
          )}
        </div>
      </div>

      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>About</h3>
        <div className={styles.about}>
          <p>
            <strong>Signet</strong> is a NIP-46 remote signer for Nostr.
          </p>
          <p className={styles.version}>
            Version {__APP_VERSION__}
          </p>
          <p>
            <a
              href="https://github.com/Letdown2491/signet"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
            >
              GitHub Repository
            </a>
          </p>
        </div>
      </div>

      {/* Enable DMS Modal */}
      <EnableDmsModal
        open={showEnableModal}
        loading={dmsLoading}
        error={dmsError}
        timeframe={pendingTimeframe}
        onTimeframeChange={setPendingTimeframe}
        onEnable={() => handleEnableDMS(pendingTimeframe)}
        onCancel={() => {
          setShowEnableModal(false);
          setDmsError(null);
        }}
      />

      {/* Disable DMS Modal */}
      <PassphraseModal
        open={showDisableModal}
        title="Disable Inactivity Lock"
        description="Enter your key passphrase to disable."
        loading={dmsLoading}
        error={dmsError}
        keys={encryptedKeys}
        onSubmit={handleDisableDMS}
        onCancel={() => {
          setShowDisableModal(false);
          setDmsError(null);
        }}
      />

      {/* Config DMS Modal */}
      <ConfigDmsModal
        open={showConfigModal}
        loading={dmsLoading}
        error={dmsError}
        timeframe={pendingTimeframe}
        keys={encryptedKeys}
        onTimeframeChange={setPendingTimeframe}
        onSubmit={(keyName, passphrase) => handleUpdateTimeframe(keyName, passphrase, pendingTimeframe)}
        onCancel={() => {
          setShowConfigModal(false);
          setDmsError(null);
        }}
      />
    </div>
  );
}

// Enable DMS Modal - no passphrase needed, just timeframe selection
interface EnableDmsModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  timeframe: number;
  onTimeframeChange: (value: number) => void;
  onEnable: () => void;
  onCancel: () => void;
}

function EnableDmsModal({
  open,
  loading,
  error,
  timeframe,
  onTimeframeChange,
  onEnable,
  onCancel,
}: EnableDmsModalProps) {
  const initial = secondsToValueUnit(timeframe);
  const [value, setValue] = React.useState(initial.value);
  const [unit, setUnit] = React.useState<TimeUnit>(initial.unit);

  // Update parent when value or unit changes
  React.useEffect(() => {
    if (open) {
      onTimeframeChange(valueUnitToSeconds(value, unit));
    }
  }, [value, unit, open, onTimeframeChange]);

  // Reset to initial values when modal opens
  React.useEffect(() => {
    if (open) {
      const init = secondsToValueUnit(timeframe);
      setValue(init.value);
      setUnit(init.unit);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.modalTitle}>Enable Inactivity Lock</h3>
        <p className={styles.modalDescription}>
          If you don't interact with Signet within the timeframe, all keys will be
          locked and apps suspended automatically.
        </p>

        <div className={styles.formGroup}>
          <label htmlFor="enable-dms-value">Inactivity timeframe</label>
          <div className={styles.durationInput}>
            <input
              id="enable-dms-value"
              type="number"
              min="1"
              value={value}
              onChange={(e) => setValue(Math.max(1, parseInt(e.target.value, 10) || 1))}
              disabled={loading}
              className={styles.durationValue}
            />
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as TimeUnit)}
              disabled={loading}
              className={styles.durationUnit}
              aria-label="Time unit"
            >
              <option value="minutes">minutes</option>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </div>
        </div>

        {error && <div className={styles.formError}>{error}</div>}

        <div className={styles.modalActions}>
          <button type="button" onClick={onCancel} disabled={loading} className={styles.btnSecondary}>
            Cancel
          </button>
          <button type="button" onClick={onEnable} disabled={loading} className={styles.btnPrimary}>
            {loading ? <Loader2 size={16} className={styles.spinning} /> : 'Enable'}
          </button>
        </div>
      </div>
    </div>
  );
}

// Config DMS Modal - requires passphrase to change timeframe
interface ConfigDmsModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  timeframe: number;
  keys: KeyInfo[];
  onTimeframeChange: (value: number) => void;
  onSubmit: (keyName: string, passphrase: string) => void;
  onCancel: () => void;
}

function ConfigDmsModal({
  open,
  loading,
  error,
  timeframe,
  keys,
  onTimeframeChange,
  onSubmit,
  onCancel,
}: ConfigDmsModalProps) {
  const initial = secondsToValueUnit(timeframe);
  const [value, setValue] = React.useState(initial.value);
  const [unit, setUnit] = React.useState<TimeUnit>(initial.unit);
  const [selectedKey, setSelectedKey] = useState(keys[0]?.name ?? '');
  const [passphrase, setPassphrase] = useState('');

  // Update parent when value or unit changes
  React.useEffect(() => {
    if (open) {
      onTimeframeChange(valueUnitToSeconds(value, unit));
    }
  }, [value, unit, open, onTimeframeChange]);

  // Reset form when modal opens
  React.useEffect(() => {
    if (open) {
      const init = secondsToValueUnit(timeframe);
      setValue(init.value);
      setUnit(init.unit);
      setSelectedKey(keys[0]?.name ?? '');
      setPassphrase('');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedKey && passphrase) {
      onSubmit(selectedKey, passphrase);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.modalTitle}>Configure Inactivity Lock</h3>
        <p className={styles.modalDescription}>
          Change the inactivity timeframe. This resets the countdown timer.
        </p>

        <form onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label htmlFor="config-dms-value">Inactivity timeframe</label>
            <div className={styles.durationInput}>
              <input
                id="config-dms-value"
                type="number"
                min="1"
                value={value}
                onChange={(e) => setValue(Math.max(1, parseInt(e.target.value, 10) || 1))}
                disabled={loading}
                className={styles.durationValue}
              />
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value as TimeUnit)}
                disabled={loading}
                className={styles.durationUnit}
                aria-label="Time unit"
              >
                <option value="minutes">minutes</option>
                <option value="hours">hours</option>
                <option value="days">days</option>
              </select>
            </div>
          </div>

          {keys.length > 1 && (
            <div className={styles.formGroup}>
              <label htmlFor="config-dms-key">Key</label>
              <select
                id="config-dms-key"
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                disabled={loading}
              >
                {keys.map((key) => (
                  <option key={key.name} value={key.name}>
                    {key.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={styles.formGroup}>
            <label htmlFor="config-dms-passphrase">Passphrase</label>
            <input
              id="config-dms-passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter passphrase to confirm"
              disabled={loading}
              autoFocus
            />
          </div>

          {error && <div className={styles.formError}>{error}</div>}

          <div className={styles.modalActions}>
            <button type="button" onClick={onCancel} disabled={loading} className={styles.btnSecondary}>
              Cancel
            </button>
            <button type="submit" disabled={loading || !passphrase} className={styles.btnPrimary}>
              {loading ? <Loader2 size={16} className={styles.spinning} /> : 'Update'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Passphrase Modal for disable
interface PassphraseModalProps {
  open: boolean;
  title: string;
  description: string;
  loading: boolean;
  error: string | null;
  keys: KeyInfo[];
  onSubmit: (keyName: string, passphrase: string) => void;
  onCancel: () => void;
}

function PassphraseModal({
  open,
  title,
  description,
  loading,
  error,
  keys,
  onSubmit,
  onCancel,
}: PassphraseModalProps) {
  const [selectedKey, setSelectedKey] = useState(keys[0]?.name ?? '');
  const [passphrase, setPassphrase] = useState('');

  React.useEffect(() => {
    if (open) {
      setSelectedKey(keys[0]?.name ?? '');
      setPassphrase('');
    }
  }, [open, keys]);

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedKey && passphrase) {
      onSubmit(selectedKey, passphrase);
    }
  };

  return (
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h3 className={styles.modalTitle}>{title}</h3>
        <p className={styles.modalDescription}>{description}</p>

        <form onSubmit={handleSubmit}>
          {keys.length > 1 && (
            <div className={styles.formGroup}>
              <label htmlFor="dms-key">Key</label>
              <select
                id="dms-key"
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                disabled={loading}
              >
                {keys.map((key) => (
                  <option key={key.name} value={key.name}>
                    {key.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={styles.formGroup}>
            <label htmlFor="dms-passphrase">Passphrase</label>
            <input
              id="dms-passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter passphrase"
              disabled={loading}
              autoFocus
            />
          </div>

          {error && <div className={styles.formError}>{error}</div>}

          <div className={styles.modalActions}>
            <button type="button" onClick={onCancel} disabled={loading} className={styles.btnSecondary}>
              Cancel
            </button>
            <button type="submit" disabled={loading || !passphrase} className={styles.btnPrimary}>
              {loading ? <Loader2 size={16} className={styles.spinning} /> : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
