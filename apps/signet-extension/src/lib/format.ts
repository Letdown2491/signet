import type { PendingRequest } from '@signet/types/api';

export type RequestState = 'pending' | 'approved' | 'denied' | 'expired';

/** Mirrors the dashboard's DisplayRequest.state derivation. */
export function requestState(r: PendingRequest, now = Date.now()): RequestState {
  if (r.allowed === true) return 'approved';
  if (r.allowed === false) return 'denied';
  return Date.parse(r.expiresAt) < now ? 'expired' : 'pending';
}

export function wasAutoApproved(r: PendingRequest): boolean {
  return (
    r.autoApproved === true ||
    r.approvalType === 'auto_trust' ||
    r.approvalType === 'auto_permission'
  );
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const s = Math.floor(diff / 1000);
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
