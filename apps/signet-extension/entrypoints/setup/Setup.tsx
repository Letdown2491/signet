import { useEffect, useState } from 'react';
import { browser } from '#imports';
import { ArrowRight, Check, KeyRound } from 'lucide-react';
import { DaemonClient } from '../../src/lib/client';
import { describeError } from '../../src/lib/errors';
import { addServer, labelFromUrl } from '../../src/lib/storage';
import { addServerToken, createVault, hasVault, MIN_PIN_LENGTH } from '../../src/lib/vault';

type Mode = 'first' | 'add';
type Step = 'connect' | 'pin' | 'seal' | 'done';

export function Setup() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [step, setStep] = useState<Step>('connect');
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [addedId, setAddedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void hasVault().then((h) => setMode(h ? 'add' : 'first'));
  }, []);

  const normalizedUrl = () => url.trim().replace(/\/+$/, '');
  const serverLabel = () => name.trim() || labelFromUrl(normalizedUrl());

  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const normalized = normalizedUrl();
      const originPattern = `${new URL(normalized).origin}/*`;
      // In a tab the permission prompt doesn't close the page, so this is one-shot.
      const granted =
        (await browser.permissions.contains({ origins: [originPattern] })) ||
        (await browser.permissions.request({ origins: [originPattern] }));
      if (!granted) throw new Error('Permission to reach the daemon was denied.');
      await new DaemonClient({ url: normalized, token: token.trim() || undefined }).health();

      if (mode === 'first') {
        setStep('pin');
        return;
      }
      // Add mode: the PIN already exists, so just append the server.
      const server = await addServer({ label: serverLabel(), url: normalized });
      if (token.trim()) {
        setAddedId(server.id);
        setStep('seal'); // need the PIN to seal the token into the vault
      } else {
        setStep('done');
      }
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const finishFirst = async () => {
    if (pin.length < MIN_PIN_LENGTH) {
      setError(`PIN must be at least ${MIN_PIN_LENGTH} digits.`);
      return;
    }
    if (pin !== pin2) {
      setError('PINs do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const server = await addServer({ label: serverLabel(), url: normalizedUrl() });
      const trimmed = token.trim();
      await createVault(pin, { tokens: trimmed ? { [server.id]: trimmed } : {} });
      setStep('done');
    } catch (e) {
      setError(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const seal = async () => {
    if (!addedId) return;
    setBusy(true);
    setError(null);
    const res = await addServerToken(pin, addedId, token.trim());
    setBusy(false);
    if (res.ok) setStep('done');
    else setError(res.error ?? 'Could not save the token.');
  };

  const close = async () => {
    const tab = await browser.tabs.getCurrent();
    if (tab?.id != null) await browser.tabs.remove(tab.id);
  };

  if (mode === null) return null;

  return (
    <div className="wrap">
      <div className="brand">
        <span className="brand-mark">
          <KeyRound size={19} />
        </span>
        Signet
      </div>

      <div className="card">
        {mode === 'first' && step !== 'done' && (
          <div className="steps" aria-hidden="true">
            <span className="step-dot active" />
            <span className={`step-dot ${step === 'pin' ? 'active' : ''}`} />
          </div>
        )}

        {step === 'connect' && (
          <>
            <h1>{mode === 'first' ? 'Connect your server' : 'Add a server'}</h1>
            <p className="lead">
              Enter your Signet server's URL — e.g. <code>http://localhost:3000</code> or a
              Tailscale address. You'll approve a one-time permission to reach it.
            </p>
            <label className="field" htmlFor="url">
              Server URL
            </label>
            <input
              id="url"
              className="input"
              type="url"
              inputMode="url"
              placeholder="http://localhost:3000"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <label className="field" htmlFor="name">
              Name — optional
            </label>
            <input
              id="name"
              className="input"
              placeholder={url.trim() ? labelFromUrl(normalizedUrl()) : 'e.g. Start9'}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <label className="field" htmlFor="token">
              Auth token — optional
            </label>
            <input
              id="token"
              className="input"
              type="password"
              placeholder="Only if this server requires auth"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button className="btn" disabled={busy || !url.trim()} onClick={connect}>
              {busy ? 'Connecting…' : mode === 'first' ? 'Continue' : 'Add server'}
              {!busy && <ArrowRight size={16} />}
            </button>
          </>
        )}

        {step === 'pin' && (
          <>
            <h1>Set a PIN</h1>
            <p className="lead">
              Connected. Choose a PIN ({MIN_PIN_LENGTH}+ digits) — you'll enter it to unlock the
              extension before approving requests.
            </p>
            <label className="field" htmlFor="pin">
              PIN
            </label>
            <input
              id="pin"
              className="input"
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
            />
            <label className="field" htmlFor="pin2">
              Confirm PIN
            </label>
            <input
              id="pin2"
              className="input"
              type="password"
              inputMode="numeric"
              value={pin2}
              onChange={(e) => setPin2(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && finishFirst()}
            />
            <button className="btn" disabled={busy || !pin || !pin2} onClick={finishFirst}>
              {busy ? 'Saving…' : 'Finish setup'}
            </button>
          </>
        )}

        {step === 'seal' && (
          <>
            <h1>Enter your PIN</h1>
            <p className="lead">Confirm your PIN to securely save this server's auth token.</p>
            <label className="field" htmlFor="seal-pin">
              PIN
            </label>
            <input
              id="seal-pin"
              className="input"
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && pin && seal()}
            />
            <button className="btn" disabled={busy || !pin} onClick={seal}>
              {busy ? 'Saving…' : 'Save daemon'}
            </button>
          </>
        )}

        {step === 'done' && (
          <div className="done">
            <div className="success-mark">
              <Check size={26} />
            </div>
            <h1>{mode === 'first' ? "You're all set" : 'Server added'}</h1>
            <p className="lead">
              Open the Signet popup from your toolbar to see and approve requests.
            </p>
            <button className="btn" onClick={close}>
              Close tab
            </button>
          </div>
        )}

        {error && <p className="error-banner">{error}</p>}
      </div>
    </div>
  );
}
