import React, { useState, useEffect, useMemo } from 'react';
import type { EncryptionFormat } from '@signet/types';
import styles from './KeysPanel.module.css';
import { HelpCircle } from 'lucide-react';

interface CreateKeyFormProps {
  creating: boolean;
  onSubmit: (data: {
    keyName: string;
    passphrase?: string;
    confirmPassphrase?: string;
    nsec?: string;
    encryption?: EncryptionFormat;
  }) => Promise<boolean>;
  onCancel: () => void;
}

export function CreateKeyForm({ creating, onSubmit, onCancel }: CreateKeyFormProps) {
  const [keyName, setKeyName] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [nsec, setNsec] = useState('');
  const [createMode, setCreateMode] = useState<'generate' | 'import'>('generate');
  const [encryption, setEncryption] = useState<EncryptionFormat>('none');
  const [showNip49Tooltip, setShowNip49Tooltip] = useState(false);
  const [showLegacyTooltip, setShowLegacyTooltip] = useState(false);

  // Detect if importing ncryptsec (already encrypted)
  const isNcryptsecImport = useMemo(() => {
    return nsec.trim().startsWith('ncryptsec1');
  }, [nsec]);

  // Clear sensitive data on unmount
  useEffect(() => {
    return () => {
      setPassphrase('');
      setConfirmPassphrase('');
      setNsec('');
    };
  }, []);

  // Reset encryption when switching modes or when ncryptsec detected
  useEffect(() => {
    if (isNcryptsecImport) {
      setEncryption('nip49');
      setConfirmPassphrase(''); // No confirm needed for ncryptsec verify
    }
  }, [isNcryptsecImport]);

  // Clear passphrase fields when encryption set to none
  useEffect(() => {
    if (encryption === 'none' && !isNcryptsecImport) {
      setPassphrase('');
      setConfirmPassphrase('');
    }
  }, [encryption, isNcryptsecImport]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // For ncryptsec import, we only verify the passphrase (no confirmation)
    const submitData = isNcryptsecImport
      ? {
          keyName: keyName.trim(),
          passphrase: passphrase.trim(),
          nsec: nsec.trim(),
          encryption: 'nip49' as EncryptionFormat,
        }
      : {
          keyName: keyName.trim(),
          passphrase: encryption !== 'none' ? passphrase.trim() : undefined,
          confirmPassphrase: encryption !== 'none' ? confirmPassphrase.trim() : undefined,
          nsec: createMode === 'import' ? nsec.trim() : undefined,
          encryption,
        };

    const success = await onSubmit(submitData);

    if (success) {
      setKeyName('');
      setPassphrase('');
      setConfirmPassphrase('');
      setNsec('');
      setEncryption('none');
      onCancel();
    }
  };

  const showEncryptionOptions = !isNcryptsecImport;
  const showPassphraseFields = encryption !== 'none' || isNcryptsecImport;

  return (
    <form className={styles.createForm} onSubmit={handleSubmit}>
      <div className={styles.formGroup}>
        <label className={styles.label} htmlFor="keyName">Key Name</label>
        <input
          id="keyName"
          type="text"
          value={keyName}
          onChange={(e) => setKeyName(e.target.value)}
          placeholder="e.g., main-key"
          className={styles.input}
          required
        />
      </div>

      <div className={styles.modeSelector}>
        <button
          type="button"
          className={`${styles.modeButton} ${createMode === 'generate' ? styles.active : ''}`}
          onClick={() => {
            setCreateMode('generate');
            setNsec('');
          }}
        >
          Generate New
        </button>
        <button
          type="button"
          className={`${styles.modeButton} ${createMode === 'import' ? styles.active : ''}`}
          onClick={() => setCreateMode('import')}
        >
          Import Existing
        </button>
      </div>

      {createMode === 'import' && (
        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="nsec">
            Private Key (nsec or ncryptsec)
          </label>
          <input
            id="nsec"
            type="password"
            value={nsec}
            onChange={(e) => setNsec(e.target.value)}
            placeholder="nsec1... or ncryptsec1..."
            className={styles.input}
            required
          />
          {isNcryptsecImport && (
            <span className={styles.hint}>
              Importing NIP-49 encrypted key. Enter passphrase to verify.
            </span>
          )}
        </div>
      )}

      {showEncryptionOptions && (
        <div className={styles.formGroup}>
          <label className={styles.label}>Encryption</label>
          <div className={styles.radioGroup}>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="encryption"
                value="none"
                checked={encryption === 'none'}
                onChange={() => setEncryption('none')}
                className={styles.radioInput}
              />
              <span>None</span>
            </label>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="encryption"
                value="nip49"
                checked={encryption === 'nip49'}
                onChange={() => setEncryption('nip49')}
                className={styles.radioInput}
              />
              <span>NIP-49</span>
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
                  <p>
                    Uses XChaCha20-Poly1305 with scrypt key derivation. The resulting
                    ncryptsec format is a Nostr standard, making your key portable to
                    other tools that support it.
                  </p>
                  <p>
                    Trade-off: Uses 64 MiB of memory during unlock. Not recommended
                    for very low-memory systems.
                  </p>
                </div>
              )}
            </label>
            <label className={styles.radioLabel}>
              <input
                type="radio"
                name="encryption"
                value="legacy"
                checked={encryption === 'legacy'}
                onChange={() => setEncryption('legacy')}
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
                  <p>
                    Uses AES-256-GCM with PBKDF2 key derivation. This format is
                    specific to Signet and cannot be exported to other tools.
                  </p>
                </div>
              )}
            </label>
          </div>
          {encryption === 'none' && (
            <span className={styles.hint}>
              Keys without encryption are stored in plain text and auto-unlock on startup
            </span>
          )}
        </div>
      )}

      {showPassphraseFields && (
        <>
          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor="passphrase">
              {isNcryptsecImport ? 'Passphrase (to verify)' : 'Passphrase'}
            </label>
            <input
              id="passphrase"
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              placeholder="Enter passphrase"
              className={styles.input}
              required
            />
          </div>

          {!isNcryptsecImport && (
            <div className={styles.formGroup}>
              <label className={styles.label} htmlFor="confirmPassphrase">
                Confirm Passphrase
              </label>
              <input
                id="confirmPassphrase"
                type="password"
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                placeholder="Confirm passphrase"
                className={styles.input}
                required
              />
            </div>
          )}
        </>
      )}

      <button type="submit" className={styles.submitButton} disabled={creating}>
        {creating ? 'Creating...' : createMode === 'generate' ? 'Generate Key' : 'Import Key'}
      </button>
    </form>
  );
}
