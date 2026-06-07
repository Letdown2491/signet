import React, { useState } from 'react';
import type { RelayStatusResponse } from '@signet/types';
import { Trash2, Plus, ChevronDown, ChevronRight } from 'lucide-react';
import styles from './RelayManager.module.css';

interface RelayManagerProps {
  relays: RelayStatusResponse | null;
  mutating: boolean;
  onAddRelay: (url: string) => Promise<{ ok: boolean; error?: string }>;
  onRemoveRelay: (url: string) => Promise<{ ok: boolean; error?: string }>;
}

export function RelayManager({ relays, mutating, onAddRelay, onRemoveRelay }: RelayManagerProps) {
  const [expanded, setExpanded] = useState(false);
  const [newRelay, setNewRelay] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const list = relays?.relays ?? [];
  const isLast = list.length <= 1;
  const summary = relays
    ? `${relays.connected}/${relays.total} connected`
    : '—';

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const url = newRelay.trim();
    if (!/^wss?:\/\/.+/i.test(url)) {
      setError('Enter a valid wss:// (or ws://) relay URL');
      return;
    }
    const result = await onAddRelay(url);
    if (result.ok) {
      setNewRelay('');
    } else {
      setError(result.error ?? 'Failed to add relay');
    }
  };

  const handleRemove = async (url: string) => {
    setError(null);
    setPendingRemove(url);
    const result = await onRemoveRelay(url);
    setPendingRemove(null);
    if (!result.ok) {
      setError(result.error ?? 'Failed to remove relay');
    }
  };

  return (
    <div className={styles.section}>
      <button
        type="button"
        className={styles.header}
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={styles.headerLeft}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span className={styles.sectionTitle}>Relays</span>
        </span>
        <span className={styles.summary}>{summary}</span>
      </button>

      {!expanded ? null : (
      <div className={styles.body}>
      <p className={styles.sectionDescription}>
        Relays Signet connects to for NIP-46 requests. Changes apply immediately.
      </p>

      <ul className={styles.list}>
        {list.length === 0 && <li className={styles.empty}>No relays configured</li>}
        {list.map((relay) => (
          <li key={relay.url} className={styles.row}>
            <span
              className={`${styles.dot} ${relay.connected ? styles.connected : styles.disconnected}`}
              title={relay.connected ? 'Connected' : 'Disconnected'}
              aria-label={relay.connected ? 'Connected' : 'Disconnected'}
            />
            <span className={styles.url}>{relay.url}</span>
            <button
              type="button"
              className={styles.removeButton}
              onClick={() => handleRemove(relay.url)}
              disabled={mutating || isLast}
              title={isLast ? 'At least one relay is required' : 'Remove relay'}
              aria-label={`Remove ${relay.url}`}
            >
              <Trash2 size={14} />
            </button>
          </li>
        ))}
      </ul>

      <form className={styles.addForm} onSubmit={handleAdd}>
        <input
          type="text"
          className={styles.input}
          value={newRelay}
          onChange={(e) => setNewRelay(e.target.value)}
          placeholder="wss://relay.example.com"
          autoComplete="off"
          spellCheck={false}
          aria-label="New relay URL"
          disabled={mutating}
        />
        <button type="submit" className={styles.addButton} disabled={mutating || !newRelay.trim()}>
          <Plus size={14} />
          Add
        </button>
      </form>

      {error && <p className={styles.error}>{error}</p>}
      {pendingRemove && <p className={styles.pending}>Removing {pendingRemove}…</p>}
      </div>
      )}
    </div>
  );
}
