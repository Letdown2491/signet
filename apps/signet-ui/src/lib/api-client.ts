// Default request timeout (30 seconds)
const DEFAULT_TIMEOUT_MS = 30_000;

const CSRF_COOKIE_NAME = 'signet_csrf';

/**
 * Custom error class that preserves HTTP status code for better error handling.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusText: string,
    public readonly body?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isCsrfError(): boolean {
    return this.status === 403 && (
      this.body?.toLowerCase().includes('csrf') ?? false
    );
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }
}

/**
 * Error thrown when a request times out.
 */
export class TimeoutError extends Error {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * In-flight request tracker for deduplication.
 * Prevents multiple simultaneous identical requests.
 */
const inFlightRequests = new Map<string, Promise<Response>>();

function getRequestKey(path: string, method: string, body?: unknown): string {
  const bodyKey = body ? JSON.stringify(body) : '';
  return `${method}:${path}:${bodyKey}`;
}

function getCsrfTokenFromCookie(): string | null {
  const match = document.cookie.match(new RegExp(`${CSRF_COOKIE_NAME}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

async function ensureCsrfToken(): Promise<string> {
  const existing = getCsrfTokenFromCookie();
  if (existing) return existing;

  // Fetch sets the cookie as a side effect
  await callApi('/csrf-token');
  const token = getCsrfTokenFromCookie();
  if (!token) throw new Error('Failed to obtain CSRF token');
  return token;
}

const buildApiBases = (): string[] => {
  const bases: string[] = [];
  const seen = new Set<string>();

  const add = (value: string | null | undefined) => {
    if (value === undefined || value === null) {
      return;
    }
    const trimmed = value === '' ? '' : value.replace(/\/+$/, '');
    if (seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    bases.push(trimmed);
  };

  const envBase = import.meta.env.VITE_DAEMON_API_URL ?? import.meta.env.VITE_BUNKER_API_URL;
  if (typeof envBase === 'string' && envBase.trim().length > 0) {
    add(envBase.trim());
  }

  add('');

  if (typeof window !== 'undefined') {
    try {
      const current = new URL(window.location.href);
      const protocol = current.protocol || 'http:';
      const hostname = current.hostname || 'localhost';
      const defaultHost = `${protocol}//${hostname}`;

      add(`${defaultHost}:3000`);
      add(defaultHost);

      if (hostname !== 'localhost') {
        add(`${protocol}//localhost:3000`);
      }
      if (hostname !== '127.0.0.1') {
        add(`${protocol}//127.0.0.1:3000`);
      }
    } catch {
      add('http://localhost:3000');
    }
  } else {
    add('http://localhost:3000');
  }

  return bases;
};

const apiBases = buildApiBases();

function composeUrl(base: string, path: string): string {
  if (!base) {
    return path.startsWith('/') ? path : `/${path}`;
  }
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

export interface ApiOptions {
  expectJson?: boolean;
  /** Request timeout in milliseconds. Defaults to 30 seconds. */
  timeoutMs?: number;
  /** Skip deduplication for this request. */
  skipDedup?: boolean;
}

/**
 * Create an AbortController with a timeout.
 * Returns both the controller and a cleanup function.
 */
function createTimeoutController(timeoutMs: number): {
  controller: AbortController;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    controller,
    cleanup: () => clearTimeout(timeoutId),
  };
}

export async function callApi(
  path: string,
  init?: RequestInit,
  options?: ApiOptions
): Promise<Response> {
  const attempts: string[] = [];
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  for (const base of apiBases) {
    const target = composeUrl(base, path);
    const { controller, cleanup } = createTimeoutController(timeoutMs);

    try {
      const response = await fetch(target, {
        ...init,
        credentials: 'include',
        signal: controller.signal,
      });

      cleanup();

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        // For certain status codes, try the next endpoint
        if ([404, 502, 503].includes(response.status)) {
          const detail = `${response.status} ${response.statusText}${body ? ` – ${body}` : ''}`;
          attempts.push(`${target}: ${detail}`);
          continue;
        }
        // Throw structured error with status code preserved
        throw new ApiError(
          `${target}: ${response.status} ${response.statusText}${body ? ` – ${body}` : ''}`,
          response.status,
          response.statusText,
          body
        );
      }

      if (options?.expectJson) {
        const contentType = response.headers.get('content-type') ?? '';
        if (!contentType.toLowerCase().includes('application/json')) {
          const body = await response.text().catch(() => '');
          const detail = body || 'Unexpected non-JSON response';
          attempts.push(`${target}: ${detail}`);
          continue;
        }
      }

      return response;
    } catch (error) {
      cleanup();

      // Handle abort (timeout)
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new TimeoutError(
          `Request to ${target} timed out after ${timeoutMs}ms`,
          timeoutMs
        );
      }

      // Network errors - try next endpoint
      if (error instanceof TypeError) {
        attempts.push(`${target}: ${error.message}`);
        continue;
      }

      // Re-throw ApiError and other errors
      throw error;
    }
  }

  throw new ApiError(
    attempts.length ? attempts.join('; ') : 'No API endpoints reachable',
    0,
    'Network Error'
  );
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await callApi(path, undefined, { expectJson: true });
  return response.json();
}

async function mutationRequest(
  path: string,
  method: string,
  body?: unknown,
  isRetry = false
): Promise<Response> {
  const csrfToken = await ensureCsrfToken();
  const requestKey = getRequestKey(path, method, body);

  // Check for in-flight duplicate request
  const existingRequest = inFlightRequests.get(requestKey);
  if (existingRequest) {
    // Return a clone of the response since Response body can only be read once
    const response = await existingRequest;
    return response.clone();
  }

  const requestPromise = (async (): Promise<Response> => {
    try {
      const response = await callApi(
        path,
        {
          method,
          headers: {
            ...(body ? { 'Content-Type': 'application/json' } : {}),
            'X-CSRF-Token': csrfToken,
          },
          body: body ? JSON.stringify(body) : undefined,
        },
        { expectJson: true }
      );
      return response;
    } catch (error) {
      // If CSRF failed and not already retrying, refresh token and retry once
      if (!isRetry && error instanceof ApiError && error.isCsrfError) {
        await callApi('/csrf-token'); // Refresh cookie
        // Remove from in-flight before retry to allow retry to be tracked
        inFlightRequests.delete(requestKey);
        return mutationRequest(path, method, body, true);
      }
      throw error;
    }
  })();

  // Track in-flight request
  inFlightRequests.set(requestKey, requestPromise);

  try {
    const response = await requestPromise;
    return response;
  } finally {
    // Clean up after request completes (success or failure)
    inFlightRequests.delete(requestKey);
  }
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const response = await mutationRequest(path, 'POST', body);
  return response.json();
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const response = await mutationRequest(path, 'PATCH', body);
  return response.json();
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  const response = await mutationRequest(path, 'DELETE', body);
  return response.json();
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const response = await mutationRequest(path, 'PUT', body);
  return response.json();
}

/**
 * Generate a one-time connection token for a key.
 * Returns a bunker URI with a token that expires in 5 minutes and can only be used once.
 */
export async function generateConnectionToken(keyName: string): Promise<{
  ok: boolean;
  bunkerUri?: string;
  expiresAt?: string;
  error?: string;
}> {
  return apiPost(`/keys/${encodeURIComponent(keyName)}/connection-token`);
}

/**
 * Lock an active key, removing it from memory.
 * The key remains encrypted on disk; all apps and permissions are preserved.
 */
export async function lockKey(keyName: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  return apiPost(`/keys/${encodeURIComponent(keyName)}/lock`);
}

/**
 * Suspend an app, preventing all requests until unsuspended.
 */
export async function suspendApp(appId: number): Promise<{
  ok: boolean;
  error?: string;
}> {
  return apiPost(`/apps/${appId}/suspend`);
}

/**
 * Unsuspend an app, allowing requests again.
 */
export async function unsuspendApp(appId: number): Promise<{
  ok: boolean;
  error?: string;
}> {
  return apiPost(`/apps/${appId}/unsuspend`);
}

/**
 * Permission requested by a nostrconnect client.
 */
export interface NostrconnectPermission {
  method: string;
  kind?: number;
}

/**
 * Connect to an app via nostrconnect:// URI.
 */
export async function connectViaNostrconnect(params: {
  uri: string;
  keyName: string;
  trustLevel: 'paranoid' | 'reasonable' | 'full';
  description?: string;
}): Promise<{
  ok: boolean;
  appId?: number;
  clientPubkey?: string;
  relays?: string[];
  connectResponseSent?: boolean;
  connectResponseError?: string;
  error?: string;
  errorType?: string;
}> {
  return apiPost('/nostrconnect', params);
}

// Dead Man's Switch types
export interface DeadManSwitchStatus {
  enabled: boolean;
  timeframeSec: number;
  lastResetAt: number | null;
  remainingSec: number | null;
  panicTriggeredAt: number | null;
  remainingAttempts: number;
}

/**
 * Get Dead Man's Switch status.
 */
export async function getDeadManSwitchStatus(): Promise<DeadManSwitchStatus> {
  return apiGet('/dead-man-switch');
}

/**
 * Enable the Dead Man's Switch.
 */
export async function enableDeadManSwitch(timeframeSec?: number): Promise<{
  ok: boolean;
  status: DeadManSwitchStatus;
  error?: string;
}> {
  return apiPut('/dead-man-switch', { enabled: true, timeframeSec });
}

/**
 * Disable the Dead Man's Switch.
 */
export async function disableDeadManSwitch(keyName: string, passphrase: string): Promise<{
  ok: boolean;
  status: DeadManSwitchStatus;
  error?: string;
  remainingAttempts?: number;
}> {
  return apiPut('/dead-man-switch', {
    enabled: false,
    keyName,
    passphrase,
  });
}

/**
 * Update Dead Man's Switch timeframe.
 */
export async function updateDeadManSwitchTimeframe(
  keyName: string,
  passphrase: string,
  timeframeSec: number
): Promise<{
  ok: boolean;
  status: DeadManSwitchStatus;
  error?: string;
  remainingAttempts?: number;
}> {
  return apiPut('/dead-man-switch', {
    timeframeSec,
    keyName,
    passphrase,
  });
}

/**
 * Reset the Dead Man's Switch timer.
 */
export async function resetDeadManSwitch(keyName: string, passphrase: string): Promise<{
  ok: boolean;
  status: DeadManSwitchStatus;
  error?: string;
  remainingAttempts?: number;
}> {
  return apiPost('/dead-man-switch/reset', { keyName, passphrase });
}

/**
 * Test the panic functionality (for testing).
 */
export async function testDeadManSwitchPanic(keyName: string, passphrase: string): Promise<{
  ok: boolean;
  status: DeadManSwitchStatus;
  error?: string;
  remainingAttempts?: number;
}> {
  return apiPost('/dead-man-switch/test-panic', { keyName, passphrase });
}

/**
 * Lock all active encrypted keys.
 */
export async function lockAllKeys(): Promise<{
  ok: boolean;
  lockedCount: number;
  error?: string;
}> {
  return apiPost('/keys/lock-all');
}

/**
 * Suspend all active apps.
 * @param until - Optional ISO date string when suspension should automatically end
 */
export async function suspendAllApps(until?: string): Promise<{
  ok: boolean;
  suspendedCount: number;
  error?: string;
}> {
  return apiPost('/apps/suspend-all', until ? { until } : undefined);
}

/**
 * Resume all suspended apps.
 */
export async function resumeAllApps(): Promise<{
  ok: boolean;
  resumedCount: number;
  error?: string;
}> {
  return apiPost('/apps/resume-all');
}

/**
 * Encrypt an unencrypted key with a passphrase.
 */
export async function encryptKey(
  keyName: string,
  encryption: 'nip49' | 'legacy',
  passphrase: string,
  confirmPassphrase: string
): Promise<{
  ok: boolean;
  error?: string;
}> {
  return apiPost(`/keys/${encodeURIComponent(keyName)}/encrypt`, {
    encryption,
    passphrase,
    confirmPassphrase,
  });
}

/**
 * Migrate a legacy-encrypted key to NIP-49 format.
 */
export async function migrateKeyToNip49(
  keyName: string,
  passphrase: string
): Promise<{
  ok: boolean;
  error?: string;
}> {
  return apiPost(`/keys/${encodeURIComponent(keyName)}/migrate`, {
    passphrase,
  });
}

/**
 * Export a key in nsec or NIP-49 (ncryptsec) format.
 */
export async function exportKey(
  keyName: string,
  format: 'nsec' | 'nip49',
  currentPassphrase?: string,
  exportPassphrase?: string,
  confirmExportPassphrase?: string
): Promise<{
  ok: boolean;
  key?: string;
  format?: 'nsec' | 'ncryptsec';
  error?: string;
}> {
  return apiPost(`/keys/${encodeURIComponent(keyName)}/export`, {
    format,
    currentPassphrase,
    exportPassphrase,
    confirmExportPassphrase,
  });
}

/**
 * Fetch trust scores for arbitrary relay URLs.
 * Used by NostrConnect modal to show scores for app-specified relays.
 */
export async function getRelayTrustScores(relays: string[]): Promise<{
  scores: Record<string, number | null>;
}> {
  return apiPost('/relays/trust-scores', { relays });
}
