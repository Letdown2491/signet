import { useMemo, useState } from 'react';
import {
  Check,
  KeyRound,
  Link2,
  Lock,
  PenLine,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Unlock,
  X,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { PendingRequest } from '@signet/types/api';
import {
  formatPermission,
  getKindLabel,
  getMethodLabel,
  getTrustLevelBehavior,
  parseConnectPermissions,
  type TrustLevel,
} from '@signet/types';
import type { ApproveOptions } from '../../src/lib/client';
import { Avatar } from './Avatar';

const TRUST_LEVELS: TrustLevel[] = ['paranoid', 'reasonable', 'full'];

// Labels/descriptions come from the shared getTrustLevelBehavior (single source of
// truth across the dashboard and extension); only the icon is local.
const TRUST_ICONS: Record<TrustLevel, LucideIcon> = {
  paranoid: ShieldAlert,
  reasonable: Shield,
  full: ShieldCheck,
};

function methodIcon(method: string): LucideIcon {
  if (method === 'connect') return Link2;
  if (method === 'sign_event') return PenLine;
  if (method.includes('decrypt')) return Unlock;
  if (method.includes('encrypt')) return Lock;
  if (method === 'get_public_key') return KeyRound;
  return Zap;
}

/**
 * Full per-request approval controls, mirroring the dashboard's RequestCard.
 * connect → trust level + requested perms + what that level auto-approves;
 * other methods → optional "always allow" (scoped to the event kind); locked
 * keys → a passphrase field.
 */
export function RequestItem({
  request,
  now,
  busy,
  onApprove,
  onDeny,
}: {
  request: PendingRequest;
  now: number;
  busy: boolean;
  onApprove: (opts: ApproveOptions) => void;
  onDeny: () => void;
}) {
  const eventKind = request.eventPreview?.kind;
  const isConnect = request.method === 'connect';
  const [trustLevel, setTrustLevel] = useState<TrustLevel>('reasonable');
  const [alwaysAllow, setAlwaysAllow] = useState(false);
  const [password, setPassword] = useState('');
  const [showDetail, setShowDetail] = useState(false);

  // The daemon surfaces the connect request's `optional_requested_perms` as
  // `requestedPerms` (the raw `params` is the metadata blob, not the original array).
  const perms = useMemo(() => {
    if (!isConnect || !request.requestedPerms?.length) return [];
    return parseConnectPermissions(request.requestedPerms.join(','));
  }, [isConnect, request.requestedPerms]);

  const remaining = Math.max(0, Math.round((Date.parse(request.expiresAt) - now) / 1000));
  const frac = request.ttlSeconds ? Math.min(1, remaining / request.ttlSeconds) : 0;
  const ttlColor = frac > 0.5 ? 'var(--accent)' : frac > 0.2 ? 'var(--warning)' : 'var(--danger)';

  const behavior = getTrustLevelBehavior(trustLevel);
  const pw = request.requiresPassword ? { password: password.trim() } : {};
  const expired = remaining <= 0;
  const blocked = busy || expired || (request.requiresPassword && !password.trim());

  const MethodIcon = methodIcon(request.method);

  return (
    <div className="card">
      <div className="ttl-track">
        <div className="ttl-fill" style={{ width: `${frac * 100}%`, background: ttlColor }} />
      </div>
      <div className="card-inner">
        <div className="id-row">
          <Avatar pubkey={request.remotePubkey} />
          <span className="id-text">
            <div className="id-name">{request.appName ?? 'Unknown app'}</div>
            <div className="id-sub">{request.remotePubkey.slice(0, 12)}…</div>
          </span>
          <span className="ttl-pill" style={{ color: ttlColor }}>
            {remaining}s
          </span>
        </div>

        <span className="method-chip">
          <MethodIcon size={13} />
          {getMethodLabel(request.method, eventKind)}
        </span>

        {request.eventPreview && (
          <div className="preview">
            <div className="preview-kind">{getKindLabel(request.eventPreview.kind)}</div>
            {request.eventPreview.content && (
              <div className="preview-body">{truncate(request.eventPreview.content)}</div>
            )}
          </div>
        )}

        {(request.eventPreview || request.params) && (
          <>
            <button className="detail-toggle" onClick={() => setShowDetail((s) => !s)}>
              {showDetail ? 'Hide details' : 'View details'}
            </button>
            {showDetail && (
              <div className="detail-box">
                {request.eventPreview ? (
                  <>
                    <div className="detail-row">
                      <span className="muted">Kind</span>
                      <span>
                        {request.eventPreview.kind} · {getKindLabel(request.eventPreview.kind)}
                      </span>
                    </div>
                    {request.eventPreview.content && (
                      <div className="detail-section">
                        <span className="muted small">Content</span>
                        <div className="detail-mono">{request.eventPreview.content}</div>
                      </div>
                    )}
                    {request.eventPreview.tags.length > 0 && (
                      <div className="detail-section">
                        <span className="muted small">Tags</span>
                        <div className="detail-tags">
                          {request.eventPreview.tags.map((t, i) => (
                            <code key={i} className="detail-tag">
                              {t.join('  ')}
                            </code>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <pre className="detail-mono">{prettyParams(request.params!)}</pre>
                )}
              </div>
            )}
          </>
        )}

        {request.requiresPassword && (
          <input
            className="input"
            type="password"
            placeholder="Key passphrase"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
        )}

        {isConnect ? (
          <>
            {perms.length > 0 && (
              <div>
                <span className="field-label">App requests</span>
                <div className="perm-badges">
                  {perms.map((p, i) => (
                    <span key={i} className="perm-badge">
                      {formatPermission(p)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <span className="field-label">Trust level</span>
              <div className="trust-list">
                {TRUST_LEVELS.map((level) => {
                  const { label, description } = getTrustLevelBehavior(level);
                  const Icon = TRUST_ICONS[level];
                  return (
                    <label key={level} className={`trust-opt ${trustLevel === level ? 'active' : ''}`}>
                      <input
                        type="radio"
                        name={`trust-${request.id}`}
                        checked={trustLevel === level}
                        onChange={() => setTrustLevel(level)}
                        disabled={busy}
                      />
                      <Icon size={16} />
                      <span className="trust-opt-text">
                        <span className="trust-opt-label">{label}</span>
                        <span className="trust-opt-desc">{description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
            <div className="behavior">
              {behavior.autoApprove.length > 0 && (
                <div>
                  <b>Auto-approves:</b> {behavior.autoApprove.join(', ')}
                </div>
              )}
              {behavior.requiresApproval.length > 0 && (
                <div>
                  <b>Will ask:</b> {behavior.requiresApproval.join(', ')}
                </div>
              )}
            </div>
            <div className="actions">
              <button
                className="btn btn-primary btn-grow"
                disabled={blocked}
                onClick={() => onApprove({ trustLevel, ...pw })}
              >
                <Check size={15} /> Connect
              </button>
              <button className="btn btn-danger" disabled={busy || expired} onClick={onDeny}>
                <X size={15} /> Deny
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="always">
              <input
                type="checkbox"
                checked={alwaysAllow}
                onChange={(e) => setAlwaysAllow(e.target.checked)}
                disabled={busy}
              />
              <span>
                {request.method === 'sign_event' && eventKind !== undefined
                  ? `Always allow ${getKindLabel(eventKind)}`
                  : 'Always allow this action'}
              </span>
            </label>
            <div className="actions">
              <button
                className="btn btn-primary btn-grow"
                disabled={blocked}
                onClick={() =>
                  onApprove({ alwaysAllow, allowKind: alwaysAllow ? eventKind : undefined, ...pw })
                }
              >
                <Check size={15} /> Approve
              </button>
              <button className="btn btn-danger" disabled={busy || expired} onClick={onDeny}>
                <X size={15} /> Deny
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function truncate(s: string, n = 140): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function prettyParams(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
