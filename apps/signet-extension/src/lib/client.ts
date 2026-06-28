import type {
  ConnectedApp,
  HealthStatus,
  KeySummary,
  PendingRequest,
  TrustLevel,
} from '@signet/types/api';

/** A daemon to talk to: its URL plus an optional JWT (for `requireAuth: true`). */
export interface DaemonTarget {
  url: string;
  token?: string;
}

export interface ApproveOptions {
  trustLevel?: TrustLevel;
  alwaysAllow?: boolean;
  allowKind?: number;
  appName?: string;
  // Sent for locked keys to match the dashboard's payload. NOTE: the daemon's
  // approve handler currently ignores it (web/authorize.ts), so this is parity-
  // only until that's addressed daemon-side.
  password?: string;
}

/**
 * Thin client over the daemon's REST API, typed against `@signet/types` so the
 * contract can't drift from the daemon.
 *
 * Auth: a `Bearer` header is always sent. The daemon skips CSRF whenever a bearer
 * token is present, and ignores the value entirely when `requireAuth` is false.
 * For hardened (`requireAuth: true`) daemons, `target.token` carries a real JWT.
 */
export class DaemonClient {
  constructor(private readonly target: DaemonTarget) {}

  health(): Promise<HealthStatus> {
    return this.request<HealthStatus>('/health');
  }

  listRequests(
    status: 'pending' | 'all' | 'approved' | 'denied' | 'expired',
    limit = 20,
    excludeAdmin = false,
  ): Promise<{ requests: PendingRequest[] }> {
    const q = new URLSearchParams({ status, limit: String(limit) });
    // `all` otherwise merges admin events (a different shape); exclude them to
    // keep a clean PendingRequest[].
    if (excludeAdmin) q.set('excludeAdmin', 'true');
    return this.request(`/requests?${q.toString()}`);
  }

  listPending(limit = 20): Promise<{ requests: PendingRequest[] }> {
    return this.listRequests('pending', limit);
  }

  approve(id: string, opts: ApproveOptions = {}): Promise<{ ok: boolean; trustLevel: string }> {
    return this.request(`/requests/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify(opts),
    });
  }

  deny(id: string): Promise<{ ok: boolean }> {
    return this.request(`/requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  listKeys(): Promise<{ keys: KeySummary[] }> {
    return this.request('/keys');
  }

  listApps(): Promise<{ apps: ConnectedApp[] }> {
    return this.request('/apps');
  }

  revokeApp(id: number): Promise<{ ok?: boolean; error?: string }> {
    return this.requestResult(`/apps/${id}/revoke`, { method: 'POST', body: '{}' });
  }

  suspendApp(id: number): Promise<{ ok?: boolean; error?: string }> {
    return this.requestResult(`/apps/${id}/suspend`, { method: 'POST', body: '{}' });
  }

  unsuspendApp(id: number): Promise<{ ok?: boolean; error?: string }> {
    return this.requestResult(`/apps/${id}/unsuspend`, { method: 'POST', body: '{}' });
  }

  /** Mint a one-time `bunker://` URI for a key (expires in ~5 min). */
  createConnectionToken(
    keyName: string,
  ): Promise<{ ok?: boolean; bunkerUri?: string; expiresAt?: string; error?: string }> {
    return this.requestResult(`/keys/${encodeURIComponent(keyName)}/connection-token`, {
      method: 'POST',
      body: '{}',
    });
  }

  /** Connect to an app from its `nostrconnect://` URI. */
  connectNostrconnect(params: {
    uri: string;
    keyName: string;
    trustLevel: TrustLevel;
    description?: string;
  }): Promise<{ ok?: boolean; appId?: number; error?: string }> {
    return this.requestResult('/nostrconnect', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * Open the daemon's SSE stream. Uses `fetch` (not `EventSource`) so we can send
   * the `Authorization` header and consume it from a service worker, where
   * `EventSource` isn't available. The caller reads `res.body` as a stream.
   */
  openEvents(signal: AbortSignal): Promise<Response> {
    return fetch(`${this.baseUrl()}/events`, {
      headers: {
        Accept: 'text/event-stream',
        Authorization: this.authHeader(),
      },
      signal,
    });
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl()}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader(),
        ...init?.headers,
      },
    });
    if (!res.ok) {
      throw new Error(`${init?.method ?? 'GET'} ${path} failed (${res.status})`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * Like `request`, but returns the parsed body even on a non-2xx response — used
   * for endpoints that signal failure with an `{ error }` payload we want to show.
   */
  private async requestResult<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl()}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader(),
        ...init?.headers,
      },
    });
    const text = await res.text();
    const data = (text ? JSON.parse(text) : {}) as Record<string, unknown>;
    if (!res.ok && data.error == null) data.error = `Request failed (${res.status})`;
    return data as T;
  }

  private authHeader(): string {
    return `Bearer ${this.target.token ?? 'signet-extension'}`;
  }

  private baseUrl(): string {
    return this.target.url.replace(/\/+$/, '');
  }
}
