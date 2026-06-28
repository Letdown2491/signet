import { useEffect, useState } from 'react';
import { Check, ChevronDown, Copy, Link2, RefreshCw } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import type { KeySummary, TrustLevel } from '@signet/types/api';
import { getTrustLevelBehavior } from '@signet/types';
import type { DaemonClient } from '../../src/lib/client';
import { describeError } from '../../src/lib/errors';

type Tab = 'bunker' | 'nostrconnect';

const TRUST_LEVELS: TrustLevel[] = ['paranoid', 'reasonable', 'full'];

export function ConnectView({ client }: { client: DaemonClient }) {
  const [keys, setKeys] = useState<KeySummary[] | null>(null);
  const [keyName, setKeyName] = useState('');
  const [tab, setTab] = useState<Tab>('bunker');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const { keys } = await client.listKeys();
        setKeys(keys);
        setKeyName(keys[0]?.name ?? '');
      } catch (e) {
        setError(describeError(e));
        setKeys([]);
      }
    })();
  }, [client]);

  return (
    <>
      <div className="conn-toggle">
        <button className={tab === 'bunker' ? 'active' : ''} onClick={() => setTab('bunker')}>
          Generate link
        </button>
        <button
          className={tab === 'nostrconnect' ? 'active' : ''}
          onClick={() => setTab('nostrconnect')}
        >
          Paste app link
        </button>
      </div>

      {keys === null && <p className="muted">Loading keys…</p>}
      {keys?.length === 0 && (
        <p className="muted">No keys found. Create one in the Signet dashboard first.</p>
      )}

      {keys && keys.length > 0 && (
        <>
          <div>
            <span className="field-label">Key</span>
            <div className="select-field">
              <select className="input" value={keyName} onChange={(e) => setKeyName(e.target.value)}>
                {keys.map((k) => (
                  <option key={k.name} value={k.name}>
                    {k.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="select-field-icon" size={16} />
            </div>
          </div>
          {tab === 'bunker' ? (
            <BunkerFlow client={client} keyName={keyName} />
          ) : (
            <NostrconnectFlow client={client} keyName={keyName} />
          )}
        </>
      )}

      {error && <p className="error-banner">{error}</p>}
    </>
  );
}

function BunkerFlow({ client, keyName }: { client: DaemonClient; keyName: string }) {
  const [uri, setUri] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setUri(null);
    const res = await client.createConnectionToken(keyName);
    setBusy(false);
    if (res.bunkerUri) {
      setUri(res.bunkerUri);
      setExpiresAt(res.expiresAt ?? null);
    } else {
      setError(res.error ?? 'Could not generate a connection link.');
    }
  };

  const copy = async () => {
    if (!uri) return;
    await navigator.clipboard.writeText(uri);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const msLeft = expiresAt ? Math.max(0, Date.parse(expiresAt) - now) : 0;
  const expired = uri != null && expiresAt != null && msLeft <= 0;

  if (!uri) {
    return (
      <>
        <p className="muted small-lead">
          Generate a one-time <code>bunker://</code> link and paste it into your Nostr app to
          connect it to this key.
        </p>
        <button className="btn btn-primary" disabled={busy || !keyName} onClick={generate}>
          {busy ? 'Generating…' : 'Generate link'}
        </button>
        {error && <p className="error-banner">{error}</p>}
      </>
    );
  }

  return (
    <>
      <div className={`qr ${expired ? 'expired' : ''}`}>
        <QRCodeSVG value={uri} size={176} marginSize={2} />
      </div>
      <div className="uri-box">{uri}</div>
      <div className="actions">
        <button className="btn btn-primary btn-grow" onClick={copy} disabled={expired}>
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button className="btn" onClick={generate} disabled={busy} title="New link">
          <RefreshCw size={15} />
        </button>
      </div>
      <p className="countdown">
        {expired ? 'Link expired — generate a new one.' : `Expires in ${formatMs(msLeft)}`}
      </p>
    </>
  );
}

function NostrconnectFlow({ client, keyName }: { client: DaemonClient; keyName: string }) {
  const [uri, setUri] = useState('');
  const [appName, setAppName] = useState('');
  const [trustLevel, setTrustLevel] = useState<TrustLevel>('reasonable');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    const res = await client.connectNostrconnect({
      uri: uri.trim(),
      keyName,
      trustLevel,
      description: appName.trim() || undefined,
    });
    setBusy(false);
    if (res.ok) setDone(true);
    else setError(res.error ?? 'Could not connect to the app.');
  };

  if (done) {
    return (
      <div className="conn-success">
        <div className="success-mark">
          <Check size={22} />
        </div>
        <p className="muted">Connected. The app can now request signatures from this key.</p>
      </div>
    );
  }

  return (
    <>
      <div>
        <span className="field-label">App connection link</span>
        <textarea
          className="input textarea"
          placeholder="nostrconnect://…"
          value={uri}
          onChange={(e) => setUri(e.target.value)}
        />
      </div>
      <div>
        <span className="field-label">App name — optional</span>
        <input
          className="input"
          placeholder="e.g. Damus"
          value={appName}
          onChange={(e) => setAppName(e.target.value)}
        />
      </div>
      <div>
        <span className="field-label">Trust level</span>
        <div className="select-field">
          <select
            className="input"
            value={trustLevel}
            onChange={(e) => setTrustLevel(e.target.value as TrustLevel)}
          >
            {TRUST_LEVELS.map((level) => {
              const { label, description } = getTrustLevelBehavior(level);
              return (
                <option key={level} value={level}>
                  {label} — {description}
                </option>
              );
            })}
          </select>
          <ChevronDown className="select-field-icon" size={16} />
        </div>
      </div>
      <button className="btn btn-primary" disabled={busy || !uri.trim() || !keyName} onClick={connect}>
        <Link2 size={15} />
        {busy ? 'Connecting…' : 'Connect app'}
      </button>
      {error && <p className="error-banner">{error}</p>}
    </>
  );
}

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
