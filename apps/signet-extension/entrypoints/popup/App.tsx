import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { browser } from '#imports';
import { ArrowLeft, Inbox, KeyRound, Lock, Plus, Settings, WifiOff } from 'lucide-react';
import { DaemonClient, type DaemonTarget } from '../../src/lib/client';
import { describeError } from '../../src/lib/errors';
import { useStreamedResource } from '../../src/lib/useStreamedResource';
import { getActiveServer } from '../../src/lib/storage';
import { getUnlocked, hasVault, lock, touchActivity, unlock } from '../../src/lib/vault';
import { ActivityList } from './Activity';
import { AppsList } from './Apps';
import { ConnectView } from './ConnectView';
import { ServerSwitcher } from './ServerSwitcher';
import { RequestItem } from './RequestItem';
import { SettingsView } from './SettingsView';

type View = 'loading' | 'needs-setup' | 'locked' | 'unlocked';
type Tab = 'pending' | 'activity' | 'apps';

export function App() {
  const [view, setView] = useState<View>('loading');
  const [target, setTarget] = useState<DaemonTarget | null>(null);

  const evaluate = useCallback(async () => {
    const server = await getActiveServer();
    if (!server || !(await hasVault())) {
      setView('needs-setup');
      return;
    }
    const secrets = await getUnlocked();
    if (!secrets) {
      setView('locked');
      return;
    }
    // Opening the popup while unlocked counts as activity (resets the idle clock).
    await touchActivity();
    setTarget({ url: server.url, token: secrets.tokens?.[server.id] ?? secrets.token });
    setView('unlocked');
  }, []);

  useEffect(() => {
    void evaluate();
  }, [evaluate]);

  switch (view) {
    case 'loading':
      return (
        <div className="app">
          <div className="center muted">Loading…</div>
        </div>
      );
    case 'needs-setup':
      return <NeedsSetup />;
    case 'locked':
      return <LockScreen onChanged={evaluate} />;
    case 'unlocked':
      return (
        <Dashboard
          target={target!}
          onChanged={evaluate}
          onLock={async () => {
            await lock();
            await evaluate();
          }}
        />
      );
  }
}

function openSetup() {
  void browser.tabs.create({ url: browser.runtime.getURL('/setup.html') });
}

function NeedsSetup() {
  return (
    <div className="app">
      <div className="center">
        <div className="hero-mark">
          <KeyRound size={26} />
        </div>
        <h1>Connect Signet</h1>
        <p>Point the extension at your server and set a PIN to approve requests from here.</p>
        <button
          className="btn btn-primary"
          onClick={() => {
            openSetup();
            window.close();
          }}
        >
          Set up Signet
        </button>
      </div>
    </div>
  );
}

function LockScreen({ onChanged }: { onChanged: () => void | Promise<void> }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const res = await unlock(pin);
    setBusy(false);
    setPin('');
    if (res.ok || res.wiped) {
      await onChanged();
      return;
    }
    setError(`Incorrect PIN — ${res.remaining} ${res.remaining === 1 ? 'try' : 'tries'} left.`);
  };

  return (
    <div className="app">
      <div className="center">
        <div className="hero-mark">
          <Lock size={24} />
        </div>
        <h1>Locked</h1>
        <p>Enter your PIN to unlock.</p>
        <input
          className="input"
          type="password"
          inputMode="numeric"
          autoFocus
          placeholder="PIN"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && pin && !busy && submit()}
        />
        <button className="btn btn-primary" disabled={busy || !pin} onClick={submit}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
        {error && <p className="error-banner">{error}</p>}
      </div>
    </div>
  );
}

type Panel = 'main' | 'connect' | 'settings';

function PanelShell({
  title,
  onBack,
  children,
}: {
  title: string;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <button className="icon-btn" title="Back" onClick={onBack}>
            <ArrowLeft size={17} />
          </button>
          {title}
        </span>
      </header>
      <main className="body">{children}</main>
    </div>
  );
}

function Dashboard({
  target,
  onLock,
  onChanged,
}: {
  target: DaemonTarget;
  onLock: () => void;
  onChanged: () => void | Promise<void>;
}) {
  const client = useMemo(() => new DaemonClient(target), [target]);
  const [tab, setTab] = useState<Tab>('pending');
  const [panel, setPanel] = useState<Panel>('main');

  if (panel === 'connect') {
    return (
      <PanelShell title="Connect an app" onBack={() => setPanel('main')}>
        <ConnectView client={client} />
      </PanelShell>
    );
  }
  if (panel === 'settings') {
    return (
      <PanelShell title="Settings" onBack={() => setPanel('main')}>
        <SettingsView client={client} onLock={onLock} onChanged={onChanged} />
      </PanelShell>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <ServerSwitcher onSwitched={onChanged} />
        <span className="topbar-actions">
          <button className="icon-btn" title="Connect an app" onClick={() => setPanel('connect')}>
            <Plus size={17} />
          </button>
          <button className="icon-btn" title="Settings" onClick={() => setPanel('settings')}>
            <Settings size={16} />
          </button>
          <button className="icon-btn" title="Lock" onClick={onLock}>
            <Lock size={16} />
          </button>
        </span>
      </header>

      <nav className="tabs">
        <button
          className={`tab ${tab === 'pending' ? 'active' : ''}`}
          onClick={() => setTab('pending')}
        >
          Pending
        </button>
        <button
          className={`tab ${tab === 'activity' ? 'active' : ''}`}
          onClick={() => setTab('activity')}
        >
          Activity
        </button>
        <button className={`tab ${tab === 'apps' ? 'active' : ''}`} onClick={() => setTab('apps')}>
          Apps
        </button>
      </nav>

      <main className="body">
        {tab === 'pending' && <PendingList client={client} />}
        {tab === 'activity' && <ActivityList client={client} />}
        {tab === 'apps' && <AppsList client={client} />}
      </main>
    </div>
  );
}

function PendingList({ client }: { client: DaemonClient }) {
  const {
    data: requests,
    error,
    refresh,
    setError,
  } = useStreamedResource(client, (c) => c.listPending().then((r) => r.requests));
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Drives the live TTL countdown bars.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setPendingId(id);
    try {
      await touchActivity();
      await fn();
      await refresh();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setPendingId(null);
    }
  };

  // Initial load failed (server unreachable) → a clear offline state with retry.
  if (requests === null && error) {
    return (
      <div className="empty">
        <WifiOff className="empty-mark" size={28} />
        <span>{error}</span>
        <button className="btn" onClick={refresh}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      {error && <p className="error-banner">{error}</p>}
      {requests === null && <p className="muted">Loading requests…</p>}
      {requests?.length === 0 && (
        <div className="empty">
          <Inbox className="empty-mark" size={28} />
          <span>No pending requests.</span>
        </div>
      )}
      {requests?.map((r) => (
        <RequestItem
          key={r.id}
          request={r}
          now={now}
          busy={pendingId === r.id}
          onApprove={(opts) => act(r.id, () => client.approve(r.id, opts))}
          onDeny={() => act(r.id, () => client.deny(r.id))}
        />
      ))}
    </>
  );
}
