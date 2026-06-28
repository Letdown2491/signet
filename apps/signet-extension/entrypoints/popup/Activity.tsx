import { History } from 'lucide-react';
import type { PendingRequest } from '@signet/types/api';
import { getMethodLabel } from '@signet/types';
import type { DaemonClient } from '../../src/lib/client';
import { relativeTime, requestState, wasAutoApproved } from '../../src/lib/format';
import { useStreamedResource } from '../../src/lib/useStreamedResource';
import { Avatar } from './Avatar';

export function ActivityList({ client }: { client: DaemonClient }) {
  const { data: items, error } = useStreamedResource(client, async (c) => {
    const { requests } = await c.listRequests('all', 25, true);
    const now = Date.now();
    // Show only resolved requests here; live pending ones live in the Pending tab.
    return requests.filter((r) => requestState(r, now) !== 'pending');
  });

  if (error) return <p className="error-banner">{error}</p>;
  if (items === null) return <p className="muted">Loading…</p>;
  if (items.length === 0) {
    return (
      <div className="empty">
        <History className="empty-mark" size={28} />
        <span>No recent activity.</span>
      </div>
    );
  }

  return (
    <div className="act-list">
      {items.map((r) => (
        <ActivityRow key={r.id} request={r} />
      ))}
    </div>
  );
}

function ActivityRow({ request }: { request: PendingRequest }) {
  const state = requestState(request);
  const badge =
    state === 'approved'
      ? wasAutoApproved(request)
        ? { label: 'Auto', cls: 'auto' }
        : { label: 'Approved', cls: 'approved' }
      : state === 'denied'
        ? { label: 'Denied', cls: 'denied' }
        : { label: 'Expired', cls: 'expired' };

  return (
    <div className="act-row">
      <Avatar pubkey={request.remotePubkey} size={22} />
      <div className="act-text">
        <div className="act-method">{getMethodLabel(request.method, request.eventPreview?.kind)}</div>
        <div className="act-sub">{request.appName ?? `${request.remotePubkey.slice(0, 12)}…`}</div>
      </div>
      <div className="act-meta">
        <span className={`act-badge ${badge.cls}`}>{badge.label}</span>
        <span className="act-time">{relativeTime(request.processedAt ?? request.createdAt)}</span>
      </div>
    </div>
  );
}
