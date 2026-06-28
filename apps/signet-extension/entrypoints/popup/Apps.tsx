import { useState } from 'react';
import { AppWindow, ChevronRight, Pause, Play, Trash2 } from 'lucide-react';
import type { ConnectedApp } from '@signet/types/api';
import type { DaemonClient } from '../../src/lib/client';
import { describeError } from '../../src/lib/errors';
import { relativeTime } from '../../src/lib/format';
import { useStreamedResource } from '../../src/lib/useStreamedResource';
import { Avatar } from './Avatar';

export function AppsList({ client }: { client: DaemonClient }) {
  // app:connected / app:revoked arrive on the same stream → refresh live.
  const {
    data: apps,
    error,
    refresh,
    setError,
  } = useStreamedResource(client, (c) => c.listApps().then((r) => r.apps));
  const [busyId, setBusyId] = useState<number | null>(null);

  const act = async (id: number, fn: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusyId(null);
    }
  };

  if (error) return <p className="error-banner">{error}</p>;
  if (apps === null) return <p className="muted">Loading…</p>;
  if (apps.length === 0) {
    return (
      <div className="empty">
        <AppWindow className="empty-mark" size={28} />
        <span>No connected apps.</span>
      </div>
    );
  }

  return (
    <div className="apps-list">
      {apps.map((app) => (
        <AppRow key={app.id} app={app} client={client} busy={busyId === app.id} onAct={act} />
      ))}
    </div>
  );
}

function AppRow({
  app,
  client,
  busy,
  onAct,
}: {
  app: ConnectedApp;
  client: DaemonClient;
  busy: boolean;
  onAct: (id: number, fn: () => Promise<unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const suspended = app.suspendedAt != null;

  return (
    <div className="app-card">
      <button className="app-head" onClick={() => setOpen((o) => !o)}>
        <Avatar pubkey={app.userPubkey} size={26} />
        <span className="app-text">
          <span className="app-name">{app.description || `${app.userPubkey.slice(0, 12)}…`}</span>
          <span className="app-sub">
            {app.keyName} · {app.requestCount} {app.requestCount === 1 ? 'request' : 'requests'}
          </span>
        </span>
        {suspended ? (
          <span className="badge-suspended">Suspended</span>
        ) : (
          <span className={`trust-badge ${app.trustLevel}`}>{app.trustLevel}</span>
        )}
        <ChevronRight className={`set-chevron ${open ? 'open' : ''}`} size={16} />
      </button>

      {open && (
        <div className="app-detail">
          <div className="app-meta">
            <span className="muted">Last used</span>
            <span>{app.lastUsedAt ? relativeTime(app.lastUsedAt) : 'never'}</span>
            <span className="muted">Connected</span>
            <span>{relativeTime(app.connectedAt)}</span>
          </div>
          {app.permissions.length > 0 && (
            <div className="perm-badges">
              {app.permissions.map((p, i) => (
                <span key={i} className="perm-badge">
                  {p}
                </span>
              ))}
            </div>
          )}
          <div className="actions">
            {suspended ? (
              <button
                className="btn btn-grow"
                disabled={busy}
                onClick={() => onAct(app.id, () => client.unsuspendApp(app.id))}
              >
                <Play size={15} /> Resume
              </button>
            ) : (
              <button
                className="btn btn-grow"
                disabled={busy}
                onClick={() => onAct(app.id, () => client.suspendApp(app.id))}
              >
                <Pause size={15} /> Suspend
              </button>
            )}
            {confirmRevoke ? (
              <button
                className="btn btn-danger btn-grow"
                disabled={busy}
                onClick={() => onAct(app.id, () => client.revokeApp(app.id))}
              >
                Confirm revoke
              </button>
            ) : (
              <button className="btn btn-danger" disabled={busy} onClick={() => setConfirmRevoke(true)}>
                <Trash2 size={15} /> Revoke
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
