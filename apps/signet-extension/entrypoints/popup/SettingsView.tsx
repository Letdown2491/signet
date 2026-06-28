import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { ChevronDown, ChevronRight, Lock, Pencil, Plus, Trash2 } from 'lucide-react';
import type { HealthStatus } from '@signet/types/api';
import type { DaemonClient } from '../../src/lib/client';
import {
  getActiveServer,
  getActiveServerId,
  getServers,
  removeServer,
  renameServer,
  type Server,
} from '../../src/lib/storage';
import { changePin, getAutoLockMinutes, setAutoLockMinutes, wipe } from '../../src/lib/vault';

const AUTO_LOCK_OPTIONS = [
  { value: 1, label: '1 minute' },
  { value: 5, label: '5 minutes' },
  { value: 15, label: '15 minutes' },
  { value: 30, label: '30 minutes' },
  { value: 60, label: '1 hour' },
  { value: 0, label: 'Never' },
];

export function SettingsView({
  client,
  onLock,
  onChanged,
}: {
  client: DaemonClient;
  onLock: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  useEffect(() => {
    void getActiveServer().then((s) => setUrl(s?.url ?? null));
  }, []);

  return (
    <>
      <section className="set-section">
        <span className="set-group-label">Active server</span>
        <div className="set-group">
          <div className="set-row">
            <span className="set-row-label">Server</span>
            <span className="set-row-value mono" title={url ?? undefined}>
              {url ?? '…'}
            </span>
          </div>
          <div className="set-row">
            <span className="set-row-label">Status</span>
            <ConnectionStatus client={client} />
          </div>
        </div>
      </section>

      <ServersSection onChanged={onChanged} />

      <section className="set-section">
        <span className="set-group-label">Security</span>
        <div className="set-group">
          <div className="set-row">
            <span className="set-row-label">Auto-lock</span>
            <AutoLockSelect />
          </div>
          <ChangePin />
          <button className="set-row" onClick={onLock}>
            <span className="set-row-label">Lock now</span>
            <Lock className="set-row-icon" size={15} />
          </button>
        </div>
      </section>

      <section className="set-section">
        <span className="set-group-label">Danger zone</span>
        {confirmDisconnect ? (
          <div className="set-confirm">
            <p className="small">
              This removes all profiles and your PIN from this browser. You'll set up again.
            </p>
            <div className="actions">
              <button
                className="btn btn-danger btn-grow"
                onClick={async () => {
                  await wipe();
                  await onChanged();
                }}
              >
                Reset
              </button>
              <button className="btn" onClick={() => setConfirmDisconnect(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button className="set-danger-btn" onClick={() => setConfirmDisconnect(true)}>
            Reset extension
          </button>
        )}
      </section>
    </>
  );
}

function ServersSection({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const [servers, setServers] = useState<Server[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const load = async () => {
    setServers(await getServers());
    setActiveId(await getActiveServerId());
  };

  useEffect(() => {
    void load();
  }, []);

  const startRename = (s: Server) => {
    setEditingId(s.id);
    setDraft(s.label);
  };

  const saveRename = async (id: string) => {
    const label = draft.trim();
    setEditingId(null);
    if (label) {
      await renameServer(id, label);
      await load();
    }
  };

  const remove = async (id: string) => {
    await removeServer(id);
    await load();
    await onChanged(); // the active server may have changed
  };

  const add = () => {
    void browser.tabs.create({ url: browser.runtime.getURL('/setup.html') });
  };

  return (
    <section className="set-section">
      <span className="set-group-label">Servers</span>
      <div className="set-group">
        {servers.map((s) => (
          <div className="set-row" key={s.id}>
            {editingId === s.id ? (
              <input
                className="input rename-input"
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => saveRename(s.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void saveRename(s.id);
                  if (e.key === 'Escape') setEditingId(null);
                }}
              />
            ) : (
              <span className="set-row-label profile-name">{s.label}</span>
            )}
            <span className="set-row-value">
              {s.id === activeId && <span className="badge-active">Active</span>}
              {editingId !== s.id && (
                <button className="row-remove" title="Rename" onClick={() => startRename(s)}>
                  <Pencil size={13} />
                </button>
              )}
              <button
                className="row-remove"
                title="Remove server"
                disabled={servers.length === 1}
                onClick={() => remove(s.id)}
              >
                <Trash2 size={14} />
              </button>
            </span>
          </div>
        ))}
        <button className="set-row" onClick={add}>
          <span className="set-row-label">Add server</span>
          <Plus className="set-row-icon" size={15} />
        </button>
      </div>
    </section>
  );
}

function ConnectionStatus({ client }: { client: DaemonClient }) {
  const [health, setHealth] = useState<HealthStatus | 'checking' | 'error'>('checking');

  useEffect(() => {
    let alive = true;
    client
      .health()
      .then((h) => alive && setHealth(h))
      .catch(() => alive && setHealth('error'));
    return () => {
      alive = false;
    };
  }, [client]);

  if (health === 'checking') {
    return (
      <span className="set-row-value">
        <span className="dot checking" /> Checking…
      </span>
    );
  }
  if (health === 'error') {
    return (
      <span className="set-row-value">
        <span className="dot offline" /> Unreachable
      </span>
    );
  }
  const degraded = health.status === 'degraded';
  const keys = health.keys.active;
  return (
    <span className="set-row-value col">
      <span className="set-row-value">
        <span className={`dot ${degraded ? 'degraded' : 'online'}`} />
        {degraded ? 'Degraded' : 'Connected'}
      </span>
      <span className="set-detail">
        {health.relays.connected}/{health.relays.total} relays · {keys} {keys === 1 ? 'key' : 'keys'}
      </span>
    </span>
  );
}

function AutoLockSelect() {
  const [minutes, setMinutes] = useState<number | null>(null);

  useEffect(() => {
    void getAutoLockMinutes().then(setMinutes);
  }, []);

  if (minutes === null) return <span className="set-row-value">…</span>;
  return (
    <span className="set-select-wrap">
      <select
        className="set-select"
        value={minutes}
        onChange={(e) => {
          const m = Number(e.target.value);
          setMinutes(m);
          void setAutoLockMinutes(m);
        }}
      >
        {AUTO_LOCK_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="set-chevron" size={14} />
    </span>
  );
}

function ChangePin() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const reset = () => {
    setOpen(false);
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
  };

  const save = async () => {
    if (next !== confirm) {
      setError('New PINs do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    const res = await changePin(current, next);
    setBusy(false);
    if (res.ok) {
      reset();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } else {
      setError(res.error ?? 'Could not change the PIN.');
    }
  };

  return (
    <>
      <button className="set-row" onClick={() => (open ? reset() : setOpen(true))}>
        <span className="set-row-label">Change PIN</span>
        {saved ? (
          <span className="set-ok">Updated</span>
        ) : (
          <ChevronRight className={`set-chevron ${open ? 'open' : ''}`} size={16} />
        )}
      </button>
      {open && (
        <div className="set-row-form">
          <input
            className="input"
            type="password"
            inputMode="numeric"
            placeholder="Current PIN"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <input
            className="input"
            type="password"
            inputMode="numeric"
            placeholder="New PIN"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
          <input
            className="input"
            type="password"
            inputMode="numeric"
            placeholder="Confirm new PIN"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <div className="actions">
            <button
              className="btn btn-primary btn-grow"
              disabled={busy || !current || !next || !confirm}
              onClick={save}
            >
              {busy ? 'Saving…' : 'Save PIN'}
            </button>
            <button className="btn" onClick={reset}>
              Cancel
            </button>
          </div>
          {error && <p className="error-banner">{error}</p>}
        </div>
      )}
    </>
  );
}
