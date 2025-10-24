import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nip19 } from 'nostr-tools';
import type { ConnectionInfo } from './lib/connection.js';

type EventPreview = {
  kind: number;
  content: string;
  tags: string[][];
};

type PendingRequest = {
  id: string;
  keyName: string | null;
  method: string;
  remotePubkey: string;
  params: string | null;
  eventPreview?: EventPreview | null;
  createdAt: string;
  expiresAt: string;
  ttlSeconds: number;
  requiresPassword: boolean;
  processedAt?: string | null;
};

type RequestMeta =
  | { state: 'idle' }
  | { state: 'approving' }
  | { state: 'success'; message: string }
  | { state: 'error'; message: string };

const REQUEST_LIMIT = 10;
const POLL_INTERVAL_MS = 4000;

type Tab = 'dashboard' | 'requests' | 'keys' | 'apps' | 'settings';

type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

type UserSettings = {
  autoRefresh: boolean;
  refreshInterval: number; // in seconds
  notificationsEnabled: boolean;
};

type DashboardStats = {
  totalKeys: number;
  activeKeys: number;
  connectedApps: number;
  pendingRequests: number;
  recentActivity24h: number;
};

type ActivityEntry = {
  id: number;
  timestamp: string;
  type: string;
  method?: string;
  keyName?: string;
  userPubkey?: string;
  appName?: string;
};

type PendingRequestWire = Omit<PendingRequest, 'requiresPassword'> & {
  requiresPassword?: boolean;
};

type RequestFilter = 'pending' | 'approved' | 'expired';

const REQUEST_FILTER_TABS: Array<{ id: RequestFilter; label: string }> = [
  { id: 'pending', label: 'Pending' },
  { id: 'approved', label: 'Approved' },
  { id: 'expired', label: 'Expired' }
];

type DisplayRequest = PendingRequest & {
  ttl: number;
  npub: string;
  createdLabel: string;
  state: 'pending' | 'expired' | 'approved';
  approvedAt?: string;
};

type KeyInfo = {
  name: string;
  npub?: string;
  bunkerUri?: string;
  status: 'online' | 'locked' | 'offline';
  userCount: number;
  tokenCount: number;
};

type ConnectedApp = {
  id: number;
  keyName: string;
  userPubkey: string;
  description?: string;
  permissions: string[];
  connectedAt: string;
  lastUsedAt: string | null;
  requestCount: number;
};

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

const buildErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
};

const toNpub = (hex: string): string => {
  try {
    return nip19.npubEncode(hex);
  } catch {
    return hex;
  }
};

const formatRelativeTime = (iso: string, now: number): string => {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const diffSeconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (diffSeconds < 1) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  const diffWeeks = Math.floor(diffDays / 7);
  return `${diffWeeks}w ago`;
};

const formatTtl = (seconds: number): string => {
  if (seconds <= 0) return 'Expired';
  if (seconds < 60) return `${seconds}s remaining`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}m ${secs.toString().padStart(2, '0')}s remaining`;
};

const getEventKindLabel = (kind: number): string => {
  const kinds: Record<number, string> = {
    0: 'Profile metadata',
    1: 'Note',
    2: 'Relay recommendation',
    3: 'Contacts',
    4: 'Encrypted DM',
    5: 'Event deletion',
    6: 'Repost',
    7: 'Reaction',
    8: 'Badge award',
    40: 'Channel creation',
    41: 'Channel metadata',
    42: 'Channel message',
    43: 'Channel hide',
    44: 'Channel mute',
    1063: 'File metadata',
    1984: 'Report',
    9734: 'Zap request',
    9735: 'Zap',
    10002: 'Relay list',
    30023: 'Long-form content',
    30078: 'App-specific data',
  };
  return kinds[kind] || `Event (kind ${kind})`;
};

const truncateContent = (content: string, maxLength: number = 200): string => {
  if (content.length <= maxLength) return content;
  return content.substring(0, maxLength) + '…';
};

// Helper function to get permission risk level
function getPermissionRisk(permission: string): 'high' | 'medium' | 'low' {
  const perm = permission.toLowerCase();

  // High risk: Can sign events, send DMs, access keys
  if (perm.includes('sign') || perm === 'sign_event' || perm.includes('nip04') || perm.includes('nip44')) {
    return 'high';
  }

  // Medium risk: Can get public key info
  if (perm.includes('get_public_key') || perm.includes('pubkey')) {
    return 'medium';
  }

  // Low risk: Read-only operations
  return 'low';
}

// Helper function to get method icon and category
function getMethodInfo(method: string): { icon: string; category: 'sign' | 'encrypt' | 'decrypt' | 'auth' | 'other' } {
  const methodLower = method.toLowerCase();

  if (methodLower.includes('sign') || methodLower === 'sign_event') {
    return { icon: '✍️', category: 'sign' };
  }
  if (methodLower.includes('encrypt') || methodLower === 'nip04_encrypt' || methodLower === 'nip44_encrypt') {
    return { icon: '🔐', category: 'encrypt' };
  }
  if (methodLower.includes('decrypt') || methodLower === 'nip04_decrypt' || methodLower === 'nip44_decrypt') {
    return { icon: '🔓', category: 'decrypt' };
  }
  if (methodLower.includes('auth') || methodLower.includes('connect')) {
    return { icon: '🔑', category: 'auth' };
  }
  return { icon: '⚡', category: 'other' };
}

const App = () => {
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [requestFilter, setRequestFilter] = useState<RequestFilter>('pending');
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [requestsOffset, setRequestsOffset] = useState(0);
  const [hasMoreRequests, setHasMoreRequests] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState<Record<string, RequestMeta>>({});
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [keysError, setKeysError] = useState<string | null>(null);
  const [showCreateKeyForm, setShowCreateKeyForm] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyPassphrase, setNewKeyPassphrase] = useState('');
  const [newKeyNsec, setNewKeyNsec] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [appsError, setAppsError] = useState<string | null>(null);
  const [editingAppId, setEditingAppId] = useState<number | null>(null);
  const [editingAppName, setEditingAppName] = useState<string>('');
  const [expandedAppId, setExpandedAppId] = useState<number | null>(null);
  const [dashboardStats, setDashboardStats] = useState<DashboardStats | null>(null);
  const [dashboardActivity, setDashboardActivity] = useState<ActivityEntry[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<{ field: string; type: 'success' | 'error'; message: string } | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermissionState>(() => {
    if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
      return 'unsupported';
    }
    return Notification.permission;
  });
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [notificationToast, setNotificationToast] = useState<{ message: string; action?: () => void } | null>(null);
  const [successToast, setSuccessToast] = useState<{ message: string; undo?: () => void } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; action: () => void; danger?: boolean } | null>(null);
  const [userSettings, setUserSettings] = useState<UserSettings>(() => {
    // Load settings from localStorage
    const saved = localStorage.getItem('signet_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Provide default for notificationsEnabled if it doesn't exist (for backwards compatibility)
        return {
          autoRefresh: parsed.autoRefresh ?? true,
          refreshInterval: parsed.refreshInterval ?? 30,
          notificationsEnabled: parsed.notificationsEnabled ?? false
        };
      } catch {
        return { autoRefresh: true, refreshInterval: 30, notificationsEnabled: false };
      }
    }
    return { autoRefresh: true, refreshInterval: 30, notificationsEnabled: false };
  });
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<string>>(new Set());
  const [bulkApproving, setBulkApproving] = useState(false);
  const lastKnownRequestIdsRef = useRef<Set<string>>(new Set());
  const apiBases = useMemo(() => buildApiBases(), []);

  // Save settings to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('signet_settings', JSON.stringify(userSettings));
  }, [userSettings]);

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!copyFeedback) return;
    const timer = setTimeout(() => setCopyFeedback(null), 2000);
    return () => clearTimeout(timer);
  }, [copyFeedback]);

  useEffect(() => {
    if (!notificationToast) return;
    const timer = setTimeout(() => setNotificationToast(null), 5000);
    return () => clearTimeout(timer);
  }, [notificationToast]);

  useEffect(() => {
    if (!successToast) return;
    const timer = setTimeout(() => setSuccessToast(null), 4000);
    return () => clearTimeout(timer);
  }, [successToast]);

  useEffect(() => {
    if (!showQuickActions) return;
    const handleClickOutside = () => setShowQuickActions(false);
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showQuickActions]);

  const requestNotificationPermission = useCallback(async () => {
    if (notificationPermission !== 'default') {
      return notificationPermission;
    }

    if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
      setNotificationPermission('unsupported');
      return 'unsupported';
    }

    try {
      const result = await Notification.requestPermission();
      setNotificationPermission(result);
      return result;
    } catch (err) {
      setNotificationPermission('denied');
      return 'denied';
    }
  }, [notificationPermission]);

  const composeUrl = useCallback((base: string, path: string) => {
    if (!base) {
      return path.startsWith('/') ? path : `/${path}`;
    }
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }, []);

  const callApi = useCallback(
    async (path: string, init?: RequestInit, options?: { expectJson?: boolean }): Promise<Response> => {
      const attempts: string[] = [];

      for (const base of apiBases) {
        const target = composeUrl(base, path);
        try {
          const response = await fetch(target, init);

          if (!response.ok) {
            const body = await response.text().catch(() => '');
            const detail = `${response.status} ${response.statusText}${body ? ` – ${body}` : ''}`;
            if ([404, 502, 503].includes(response.status)) {
              attempts.push(`${target}: ${detail}`);
              continue;
            }
            throw new Error(`${target}: ${detail}`);
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
          if (error instanceof TypeError) {
            attempts.push(`${target}: ${error.message}`);
            continue;
          }
          throw error;
        }
      }

      throw new Error(attempts.length ? attempts.join('; ') : 'No API endpoints reachable');
    },
    [apiBases, composeUrl]
  );

  const loadConnectionInfo = useCallback(async () => {
    setConnectionLoading(true);
    try {
      const response = await callApi('/connection', undefined, { expectJson: true });
      const payload = (await response.json()) as ConnectionInfo;
      setConnectionInfo(payload);
      setConnectionError(null);
    } catch (err) {
      setConnectionError(buildErrorMessage(err, 'Unable to load connection info'));
    } finally {
      setConnectionLoading(false);
    }
  }, [callApi]);

  const loadKeys = useCallback(async () => {
    setKeysLoading(true);
    try {
      const response = await callApi('/keys', undefined, { expectJson: true });
      const payload = (await response.json()) as { keys: KeyInfo[] };
      setKeys(payload.keys);
      setKeysError(null);
    } catch (err) {
      setKeysError(buildErrorMessage(err, 'Unable to load keys'));
    } finally {
      setKeysLoading(false);
    }
  }, [callApi]);

  const handleCreateKey = useCallback(async () => {
    if (!newKeyName.trim() || !newKeyPassphrase) {
      setKeysError('Key name and passphrase are required');
      return;
    }

    setCreatingKey(true);
    setKeysError(null);

    try {
      const body: { keyName: string; passphrase: string; nsec?: string } = {
        keyName: newKeyName.trim(),
        passphrase: newKeyPassphrase,
      };

      if (newKeyNsec.trim()) {
        body.nsec = newKeyNsec.trim();
      }

      const response = await callApi('/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, { expectJson: true });

      const result = (await response.json()) as { ok?: boolean; error?: string };

      if (!result.ok) {
        throw new Error(result.error || 'Failed to create key');
      }

      // Reset form and reload keys
      setNewKeyName('');
      setNewKeyPassphrase('');
      setNewKeyNsec('');
      setShowCreateKeyForm(false);
      await loadKeys();
    } catch (err) {
      setKeysError(buildErrorMessage(err, 'Failed to create key'));
    } finally {
      setCreatingKey(false);
    }
  }, [newKeyName, newKeyPassphrase, newKeyNsec, callApi, loadKeys]);

  const loadApps = useCallback(async () => {
    setAppsLoading(true);
    try {
      const response = await callApi('/apps', undefined, { expectJson: true });
      const payload = (await response.json()) as { apps: ConnectedApp[] };
      setApps(payload.apps);
      setAppsError(null);
    } catch (err) {
      setAppsError(buildErrorMessage(err, 'Unable to load connected apps'));
    } finally {
      setAppsLoading(false);
    }
  }, [callApi]);

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    try {
      const response = await callApi('/dashboard', undefined, { expectJson: true });
      const payload = (await response.json()) as {
        stats: DashboardStats;
        activity: ActivityEntry[];
      };
      setDashboardStats(payload.stats);
      setDashboardActivity(payload.activity);
      setDashboardError(null);
    } catch (err) {
      setDashboardError(buildErrorMessage(err, 'Unable to load dashboard'));
    } finally {
      setDashboardLoading(false);
    }
  }, [callApi]);

  const fetchLatest = useCallback(async (status: RequestFilter = 'pending', offset: number = 0, append: boolean = false) => {
    const response = await callApi(`/requests?limit=${REQUEST_LIMIT}&status=${status}&offset=${offset}`, undefined, {
      expectJson: true
    });

    const payload = (await response.json()) as { requests?: PendingRequestWire[] };
    const list = Array.isArray(payload.requests)
      ? payload.requests.map((request) => ({
          ...request,
          requiresPassword: Boolean(request.requiresPassword)
        }))
      : [];

    if (append) {
      setRequests((prev) => [...prev, ...list]);
    } else {
      setRequests(list);
      setRequestsOffset(REQUEST_LIMIT);
    }

    setHasMoreRequests(list.length === REQUEST_LIMIT);
  }, [callApi]);

  const loadMoreRequests = useCallback(async () => {
    if (loadingMore || !hasMoreRequests) {
      return;
    }

    setLoadingMore(true);
    try {
      await fetchLatest(requestFilter, requestsOffset, true);
      setRequestsOffset((prev) => prev + REQUEST_LIMIT);
    } catch (err) {
      console.error('Failed to load more requests:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMoreRequests, requestFilter, requestsOffset, fetchLatest]);

  // Intersection Observer for infinite scrolling
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && hasMoreRequests && !loadingMore && activeTab === 'requests') {
          loadMoreRequests();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(sentinel);

    return () => {
      observer.disconnect();
    };
  }, [hasMoreRequests, loadingMore, loadMoreRequests, activeTab]);

  useEffect(() => {
    let cancelled = false;
    let firstLoad = true;

    // Reset pagination state when filter changes
    setRequestsOffset(0);
    setHasMoreRequests(true);

    const load = async () => {
      if (firstLoad) {
        setLoading(true);
      }

      try {
        await fetchLatest(requestFilter);
        if (!cancelled) {
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(buildErrorMessage(err, 'Unable to load requests'));
        }
      } finally {
        if (firstLoad && !cancelled) {
          setLoading(false);
        }
        firstLoad = false;
      }
    };

    load();

    // Only poll for pending requests since approved/expired are historical
    let interval: ReturnType<typeof setInterval> | undefined;
    if (requestFilter === 'pending' && userSettings.autoRefresh) {
      interval = setInterval(() => {
        fetchLatest(requestFilter).catch((err) => {
          if (!cancelled) {
            setError(buildErrorMessage(err, 'Unable to refresh requests'));
          }
        });
      }, userSettings.refreshInterval * 1000);
    }

    return () => {
      cancelled = true;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [fetchLatest, requestFilter, userSettings.autoRefresh, userSettings.refreshInterval]);

  useEffect(() => {
    setPasswords((previous) => {
      const next: Record<string, string> = {};
      for (const request of requests) {
        if (request.requiresPassword && previous[request.id]) {
          next[request.id] = previous[request.id];
        }
      }
      return next;
    });

    setMeta((previous) => {
      const next: Record<string, RequestMeta> = {};
      for (const request of requests) {
        const details = previous[request.id];
        if (details && details.state !== 'success') {
          next[request.id] = details;
        }
      }
      return next;
    });
  }, [requests]);

  useEffect(() => {
    if (activeTab !== 'keys') {
      return;
    }

    if (keysLoading) {
      return;
    }

    if (keys.length === 0 || keysError) {
      loadKeys().catch(() => {
        /* handled via state */
      });
    }
  }, [activeTab, keys.length, keysLoading, keysError, loadKeys]);

  useEffect(() => {
    if (activeTab !== 'apps') {
      return;
    }

    if (appsLoading) {
      return;
    }

    if (apps.length === 0 || appsError) {
      loadApps().catch(() => {
        /* handled via state */
      });
    }
  }, [activeTab, apps.length, appsLoading, appsError, loadApps]);

  useEffect(() => {
    if (activeTab !== 'dashboard') {
      return;
    }

    // Initial load
    loadDashboard().catch(() => {
      /* handled via state */
    });

    // Auto-refresh dashboard based on user settings
    let interval: ReturnType<typeof setInterval> | undefined;
    if (userSettings.autoRefresh) {
      interval = setInterval(() => {
        loadDashboard().catch(() => {
          /* handled via state */
        });
      }, userSettings.refreshInterval * 1000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [activeTab, loadDashboard, userSettings.autoRefresh, userSettings.refreshInterval]);

  const decoratedRequests = useMemo<DisplayRequest[]>(() => {
    return requests.map((request) => {
      const expires = Date.parse(request.expiresAt);
      const ttl = Number.isFinite(expires)
        ? Math.max(0, Math.round((expires - now) / 1000))
        : Math.max(0, request.ttlSeconds);

      // Determine state based on current filter and request properties
      let state: DisplayRequest['state'];
      if (requestFilter === 'approved' || request.processedAt) {
        state = 'approved';
      } else if (requestFilter === 'expired' || ttl === 0) {
        state = 'expired';
      } else {
        state = 'pending';
      }

      return {
        ...request,
        ttl,
        npub: toNpub(request.remotePubkey),
        createdLabel: formatRelativeTime(request.createdAt, now),
        state,
        approvedAt: request.processedAt ?? undefined
      };
    });
  }, [requests, now, requestFilter]);
  // Since we're now fetching based on filter, decoratedRequests already contains
  // the filtered results from the backend
  const filteredRequests = decoratedRequests;
  const requestFilterCounts: Record<RequestFilter, number> = {
    pending: requestFilter === 'pending' ? filteredRequests.length : 0,
    approved: requestFilter === 'approved' ? filteredRequests.length : 0,
    expired: requestFilter === 'expired' ? filteredRequests.length : 0
  };

  const showNotification = useCallback((request: { id: string; method: string; npub: string }) => {
    if (typeof window === 'undefined' || typeof window.Notification === 'undefined') {
      return;
    }

    const safeMethod = request.method || 'bunker request';
    const safeBody = request.npub ? `${safeMethod} from ${request.npub}` : safeMethod;

    try {
      new Notification('New bunker request', {
        body: safeBody,
        tag: request.id
      });
    } catch (err) {
      console.debug('notification error', err);
    }
  }, []);

  const { statusLabel, statusTone } = useMemo(() => {
    if (loading) {
      return { statusLabel: 'Starting…', statusTone: 'starting' };
    }

    if (error || connectionError) {
      return { statusLabel: 'Offline', statusTone: 'offline' };
    }

    return { statusLabel: 'Connected', statusTone: 'online' };
  }, [loading, error, connectionError]);

  useEffect(() => {
    const currentIds = new Set(decoratedRequests.map((request) => request.id));
    const previousIds = lastKnownRequestIdsRef.current;
    const isInitial = previousIds.size === 0;
    const unseen = decoratedRequests.filter((request) => !previousIds.has(request.id));

    if (notificationPermission !== 'granted') {
      lastKnownRequestIdsRef.current = currentIds;
      return;
    }

    if (!isInitial && unseen.length > 0 && userSettings.notificationsEnabled) {
      const notify = () => {
        unseen.forEach((request) => {
          showNotification({ id: request.id, method: request.method, npub: request.npub });
        });
      };

      notify();
    }

    lastKnownRequestIdsRef.current = currentIds;
  }, [decoratedRequests, notificationPermission, showNotification, userSettings.notificationsEnabled]);

  const handleTabChange = useCallback(
    (tab: Tab) => {
      setActiveTab(tab);
      if (tab === 'requests' && notificationPermission === 'default') {
        setNotificationToast({
          message: 'Enable notifications to stay updated on new requests',
          action: () => {
            void requestNotificationPermission();
            setNotificationToast(null);
          }
        });
      }
    },
    [notificationPermission, requestNotificationPermission]
  );

  const handleCopy = useCallback(async (field: string, value: string) => {
    if (!value) {
      return;
    }

    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else if (typeof document !== 'undefined') {
        const textArea = document.createElement('textarea');
        textArea.value = value;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (!successful) {
          throw new Error('Clipboard copy unavailable');
        }
      } else {
        throw new Error('Clipboard unavailable');
      }

      setCopyFeedback({ field, type: 'success', message: `${field} copied` });
    } catch (err) {
      setCopyFeedback({
        field,
        type: 'error',
        message: buildErrorMessage(err, 'Unable to copy to clipboard')
      });
    }
  }, []);

  const handlePasswordChange = useCallback((id: string, value: string) => {
    setPasswords((previous) => ({ ...previous, [id]: value }));
  }, []);

  const copyToClipboard = useCallback((text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopyFeedback({ field: label, type: 'success', message: `${label} copied!` });
      })
      .catch(() => {
        setCopyFeedback({ field: label, type: 'error', message: `Failed to copy ${label}` });
      });
  }, []);

  const handleRevokeApp = useCallback(
    async (appId: number, appName: string) => {
      setConfirmDialog({
        title: 'Revoke App Access',
        message: `Are you sure you want to revoke access for "${appName}"? This app will no longer be able to make signing requests.`,
        danger: true,
        action: async () => {
          setConfirmDialog(null);
          try {
            const response = await callApi(
              `/apps/${appId}/revoke`,
              {
                method: 'POST',
              },
              { expectJson: true }
            );

            const result = (await response.json()) as { ok?: boolean; error?: string };

            if (!result?.ok) {
              throw new Error(result?.error ?? 'Failed to revoke app access');
            }

            // Show success toast
            setSuccessToast({
              message: `✓ "${appName}" access revoked`
            });

            // Reload apps after revoking
            await loadApps();
          } catch (err) {
            setAppsError(buildErrorMessage(err, 'Failed to revoke app access'));
          }
        }
      });
    },
    [callApi, loadApps]
  );

  const handleStartEditApp = useCallback((app: ConnectedApp) => {
    setEditingAppId(app.id);
    setEditingAppName(app.description || '');
  }, []);

  const handleCancelEditApp = useCallback(() => {
    setEditingAppId(null);
    setEditingAppName('');
  }, []);

  const handleSaveAppName = useCallback(
    async (appId: number) => {
      if (!editingAppName.trim()) {
        setAppsError('App name cannot be empty');
        return;
      }

      try {
        const response = await callApi(
          `/apps/${appId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ description: editingAppName.trim() }),
          },
          { expectJson: true }
        );

        const result = (await response.json()) as { ok?: boolean; error?: string };

        if (!result?.ok) {
          throw new Error(result?.error ?? 'Failed to rename app');
        }

        setEditingAppId(null);
        setEditingAppName('');
        await loadApps();
      } catch (err) {
        setAppsError(buildErrorMessage(err, 'Failed to rename app'));
      }
    },
    [callApi, editingAppName, loadApps]
  );

  const handleApprove = useCallback(
    async (id: string) => {
      const requestDetails = requests.find((item) => item.id === id);
      const requiresPassword = requestDetails?.requiresPassword ?? false;
      const passwordRaw = passwords[id]?.trim() ?? '';

      if (requiresPassword && passwordRaw.length === 0) {
        setMeta((previous) => ({
          ...previous,
          [id]: { state: 'error', message: 'Password required to authorize this request' }
        }));
        return;
      }

      setMeta((previous) => ({ ...previous, [id]: { state: 'approving' } }));

      try {
        const payload = requiresPassword ? { password: passwordRaw } : {};
        const response = await callApi(
          `/requests/${id}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          },
          { expectJson: true }
        );

        const text = await response.text();
        let result: { ok?: boolean; error?: string } = {};
        if (text) {
          try {
            result = JSON.parse(text);
          } catch {
            throw new Error(text);
          }
        }

        if (!result?.ok) {
          throw new Error(result?.error ?? 'Authorization failed');
        }

        setMeta((previous) => ({ ...previous, [id]: { state: 'success', message: 'Approved' } }));
        setPasswords((previous) => {
          const next = { ...previous };
          delete next[id];
          return next;
        });

        // Show success toast
        const methodName = requestDetails?.method ?? 'Request';
        setSuccessToast({
          message: `✓ ${methodName} approved successfully`
        });

        await fetchLatest(requestFilter);
      } catch (err) {
        setMeta((previous) => ({
          ...previous,
          [id]: { state: 'error', message: buildErrorMessage(err, 'Authorization failed') }
        }));
      }
    },
    [callApi, fetchLatest, passwords, requestFilter, requests]
  );

  const toggleSelectionMode = useCallback(() => {
    setSelectionMode(!selectionMode);
    setSelectedRequestIds(new Set());
  }, [selectionMode]);

  const toggleRequestSelection = useCallback((id: string) => {
    setSelectedRequestIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const selectAllVisible = useCallback(() => {
    const visiblePendingIds = filteredRequests
      .filter((req) => req.state === 'pending')
      .map((req) => req.id);
    setSelectedRequestIds(new Set(visiblePendingIds));
  }, [filteredRequests]);

  const deselectAll = useCallback(() => {
    setSelectedRequestIds(new Set());
  }, []);

  const handleBulkApprove = useCallback(async () => {
    if (selectedRequestIds.size === 0) return;

    const requestsToApprove = Array.from(selectedRequestIds);
    const requestsWithPassword = requestsToApprove.filter((id) => {
      const req = requests.find((r) => r.id === id);
      return req?.requiresPassword && (!passwords[id] || passwords[id].trim().length === 0);
    });

    if (requestsWithPassword.length > 0) {
      setError(`${requestsWithPassword.length} selected ${requestsWithPassword.length === 1 ? 'request requires' : 'requests require'} a password`);
      return;
    }

    setBulkApproving(true);
    let approvedCount = 0;
    let failedCount = 0;

    for (const id of requestsToApprove) {
      try {
        await handleApprove(id);
        approvedCount++;
      } catch {
        failedCount++;
      }
    }

    setBulkApproving(false);
    setSelectedRequestIds(new Set());
    setSelectionMode(false);

    if (approvedCount > 0) {
      setSuccessToast({
        message: `✓ ${approvedCount} ${approvedCount === 1 ? 'request' : 'requests'} approved${failedCount > 0 ? ` (${failedCount} failed)` : ''}`
      });
    }
  }, [selectedRequestIds, requests, passwords, handleApprove]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="header-panel">
          <div className="app-header__top">
            <button
              type="button"
              className="app-brand"
              onClick={() => handleTabChange('dashboard')}
              aria-label="Return to dashboard"
            >
              <img src="/logo.svg" alt="Signet logo" className="app-brand__logo" />
              <span className="app-brand__title">Signet</span>
            </button>
            <div className="app-meta">
              <span className={`app-meta__badge app-meta__badge--${statusTone}`}>
                <span className="status-dot" aria-hidden="true" />
                {statusLabel}
              </span>
              <div className="quick-actions">
                <button
                  type="button"
                  className="quick-actions__trigger"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowQuickActions(!showQuickActions);
                  }}
                  aria-label="Quick actions menu"
                  aria-expanded={showQuickActions}
                >
                  ⋮
                </button>
                {showQuickActions && (
                  <div className="quick-actions__menu" onClick={(e) => e.stopPropagation()}>
                    <a
                      href="https://github.com/Letdown2491/signet"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="quick-actions__item"
                    >
                      Documentation
                    </a>
                    <button
                      type="button"
                      className="quick-actions__item"
                      onClick={() => {
                        window.location.reload();
                      }}
                    >
                      Refresh
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <nav className="tab-bar" aria-label="Admin navigation">
            <button
              type="button"
              className={`tab-bar__button${activeTab === 'dashboard' ? ' tab-bar__button--active' : ''}`}
              onClick={() => handleTabChange('dashboard')}
              aria-current={activeTab === 'dashboard' ? 'page' : undefined}
            >
              <span className="tab-bar__label">Dashboard</span>
            </button>
            <button
              type="button"
              className={`tab-bar__button${activeTab === 'requests' ? ' tab-bar__button--active' : ''}`}
              onClick={() => handleTabChange('requests')}
              aria-current={activeTab === 'requests' ? 'page' : undefined}
            >
              <span className="tab-bar__label">Requests</span>
              {dashboardStats && dashboardStats.pendingRequests > 0 && (
                <span className="tab-bar__badge">{dashboardStats.pendingRequests}</span>
              )}
            </button>
            <button
              type="button"
              className={`tab-bar__button${activeTab === 'keys' ? ' tab-bar__button--active' : ''}`}
              onClick={() => handleTabChange('keys')}
              aria-current={activeTab === 'keys' ? 'page' : undefined}
            >
              <span className="tab-bar__label">Keys</span>
              {dashboardStats && dashboardStats.totalKeys - dashboardStats.activeKeys > 0 && (
                <span className="tab-bar__badge tab-bar__badge--warning">
                  {dashboardStats.totalKeys - dashboardStats.activeKeys}
                </span>
              )}
            </button>
            <button
              type="button"
              className={`tab-bar__button${activeTab === 'apps' ? ' tab-bar__button--active' : ''}`}
              onClick={() => handleTabChange('apps')}
              aria-current={activeTab === 'apps' ? 'page' : undefined}
            >
              <span className="tab-bar__label">Apps</span>
              {dashboardStats && dashboardStats.connectedApps > 0 && (
                <span className="tab-bar__badge tab-bar__badge--info">{dashboardStats.connectedApps}</span>
              )}
            </button>
            <button
              type="button"
              className={`tab-bar__button${activeTab === 'settings' ? ' tab-bar__button--active' : ''}`}
              onClick={() => handleTabChange('settings')}
              aria-current={activeTab === 'settings' ? 'page' : undefined}
            >
              <span className="tab-bar__label">Settings</span>
            </button>
          </nav>
        </div>
      </header>

      <main className="app-main">
        {activeTab === 'dashboard' ? (
          <section className="panel">
            <div className="panel__intro">
              <div>
                <h1>Dashboard</h1>
                <p>
                  Overview of your Signet activity, keys, and connected applications.
                </p>
              </div>
            </div>

            {dashboardError && <p className="alert alert--error">{dashboardError}</p>}

            {dashboardStats && (
              <div className="stat-cards">
                <button
                  type="button"
                  className="stat-card stat-card--clickable"
                  onClick={() => handleTabChange('keys')}
                >
                  <div className="stat-card__icon">🔑</div>
                  <div className="stat-card__content">
                    <div className="stat-card__value">{dashboardStats.activeKeys} / {dashboardStats.totalKeys}</div>
                    <div className="stat-card__label">Active Keys</div>
                  </div>
                </button>
                <button
                  type="button"
                  className="stat-card stat-card--clickable"
                  onClick={() => handleTabChange('apps')}
                >
                  <div className="stat-card__icon">📱</div>
                  <div className="stat-card__content">
                    <div className="stat-card__value">{dashboardStats.connectedApps}</div>
                    <div className="stat-card__label">Connected Apps</div>
                  </div>
                </button>
                <button
                  type="button"
                  className="stat-card stat-card--clickable"
                  onClick={() => handleTabChange('requests')}
                >
                  <div className="stat-card__icon">⏳</div>
                  <div className="stat-card__content">
                    <div className="stat-card__value">{dashboardStats.pendingRequests}</div>
                    <div className="stat-card__label">Pending Requests</div>
                  </div>
                </button>
              </div>
            )}

            {dashboardActivity.length > 0 && (
              <div className="activity-section">
                <h2 className="activity-section__title">Recent Activity</h2>
                <div className="activity-timeline">
                  {dashboardActivity.map((activity) => {
                    const timeAgo = formatRelativeTime(activity.timestamp, now);
                    const displayName = activity.appName || (activity.userPubkey ? toNpub(activity.userPubkey).substring(0, 16) + '…' : undefined);
                    return (
                      <div key={activity.id} className="activity-item">
                        {activity.keyName && (
                          <div className="activity-item__key">
                            <span className="activity-item__key-icon">🔑</span>
                            {activity.keyName}
                          </div>
                        )}
                        {displayName && (
                          <div className="activity-item__name">{displayName}</div>
                        )}
                        <div className={`activity-item__type activity-item__type--${activity.type}`}>{activity.type}</div>
                        <div className="activity-item__time">{timeAgo}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {!dashboardLoading && dashboardStats && dashboardStats.pendingRequests > 0 && (
              <div className="dashboard-alert">
                <div className="dashboard-alert__icon">⚠️</div>
                <div className="dashboard-alert__content">
                  <strong>You have {dashboardStats.pendingRequests} pending {dashboardStats.pendingRequests === 1 ? 'request' : 'requests'}</strong>
                  <button
                    type="button"
                    className="dashboard-alert__action"
                    onClick={() => handleTabChange('requests')}
                  >
                    View requests →
                  </button>
                </div>
              </div>
            )}

            {!dashboardLoading && !dashboardStats && (
              <p className="alert alert--info">Loading dashboard...</p>
            )}
          </section>
        ) : activeTab === 'requests' ? (
          <section className="panel panel--requests">
          <div className="panel__intro">
            <div>
              <h1>{requestFilter === 'pending' ? 'Pending Requests' : requestFilter === 'approved' ? 'Approved Requests' : 'Expired Requests'}</h1>
              <p>
                Review NIP-46 calls as they arrive. Pending requests expire after 60&nbsp;seconds, so handle them
                promptly.
              </p>
            </div>
            {requestFilter === 'pending' && filteredRequests.length > 0 && (
              <button
                type="button"
                className={`btn ${selectionMode ? 'btn--secondary' : 'btn--primary'}`}
                onClick={toggleSelectionMode}
              >
                {selectionMode ? 'Cancel' : 'Select'}
              </button>
            )}
          </div>

          {error && <p className="alert alert--error">{error}</p>}

          <div className="request-filters" role="tablist" aria-label="Filter requests by status">
            {REQUEST_FILTER_TABS.map(({ id, label }) => {
              const count = requestFilterCounts[id];
              const isActive = requestFilter === id;
              return (
                <button
                  key={id}
                  type="button"
                  className={`request-filter__button${isActive ? ' request-filter__button--active' : ''}`}
                  onClick={() => setRequestFilter(id)}
                  aria-pressed={isActive}
                >
                  {label}
                  <span className="request-filter__count">{count}</span>
                </button>
              );
            })}
          </div>

          {selectionMode && (
            <div className="bulk-actions-toolbar">
              <div className="bulk-actions-toolbar__info">
                <span className="bulk-actions-toolbar__count">
                  {selectedRequestIds.size} {selectedRequestIds.size === 1 ? 'request' : 'requests'} selected
                </span>
                {selectedRequestIds.size > 0 && (
                  <button
                    type="button"
                    className="bulk-actions-toolbar__link"
                    onClick={deselectAll}
                  >
                    Deselect all
                  </button>
                )}
                {selectedRequestIds.size < filteredRequests.filter((r) => r.state === 'pending').length && (
                  <button
                    type="button"
                    className="bulk-actions-toolbar__link"
                    onClick={selectAllVisible}
                  >
                    Select all pending
                  </button>
                )}
              </div>
              {selectedRequestIds.size > 0 && (
                <div className="bulk-actions-toolbar__actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={handleBulkApprove}
                    disabled={bulkApproving}
                  >
                    {bulkApproving ? 'Approving…' : `Approve ${selectedRequestIds.size}`}
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="request-list">
            {loading && (
              <div className="empty-state">
                <span className="spinner" aria-hidden />
                <p>Loading requests…</p>
              </div>
            )}

            {!loading && filteredRequests.length === 0 && (
              <div className="empty-state">
                <p>
                  {requestFilter === 'pending'
                    ? 'No pending requests.'
                    : requestFilter === 'approved'
                    ? 'No approved requests yet.'
                    : 'No expired requests.'}
                </p>
                <p className="empty-state__hint">
                  {requestFilter === 'pending'
                    ? 'Leave this view open—new requests will appear instantly.'
                    : requestFilter === 'approved'
                    ? 'Approvals you grant will appear here for quick reference.'
                    : 'Authorize within 60 seconds to keep this tab empty.'}
                </p>
              </div>
            )}

            {!loading &&
              filteredRequests.map((request) => {
                const password = passwords[request.id] ?? '';
                const status = meta[request.id] ?? { state: 'idle' };
                const isPending = request.state === 'pending';
                const isExpired = request.state === 'expired';
                const isApproved = request.state === 'approved';
                const approving = isPending && status.state === 'approving';
                const ttlLabel = isPending ? formatTtl(request.ttl) : 'Expired';
                const isExpiringSoon = isPending && request.ttl <= 10 && request.ttl > 0;
                const approvedAgo =
                  isApproved && request.approvedAt ? formatRelativeTime(request.approvedAt, now) : null;
                const requiresPassword = request.requiresPassword && isPending;
                const passwordMissing = requiresPassword && password.trim().length === 0;

                const methodInfo = getMethodInfo(request.method);
                const isSelected = selectedRequestIds.has(request.id);

                return (
                  <article className={`request-card request-card--${methodInfo.category}${selectionMode ? ' request-card--selectable' : ''}${isSelected ? ' request-card--selected' : ''}`} key={request.id}>
                    {selectionMode && isPending && (
                      <div className="request-card__checkbox">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRequestSelection(request.id)}
                          aria-label={`Select request ${request.method}`}
                        />
                      </div>
                    )}
                    <header className="request-card__header">
                      <div>
                        <div className="request-card__method">
                          <span className="request-card__method-icon">{methodInfo.icon}</span>
                          <span className="request-card__method-name">{request.method}</span>
                          {request.keyName && <span className="request-card__key">Key: {request.keyName}</span>}
                        </div>
                        <span className="request-card__meta">
                          {isApproved ? (
                            <>
                              Approved {approvedAgo ?? 'just now'}
                            </>
                          ) : (
                            <>
                              Requested {request.createdLabel} ·{' '}
                              <span
                                className={
                                  isExpiringSoon
                                    ? 'request-card__ttl request-card__ttl--soon'
                                    : 'request-card__ttl'
                                }
                              >
                                {ttlLabel}
                              </span>
                            </>
                          )}
                        </span>
                      </div>
                    </header>

                    <div className="request-card__body">
                      <div className="request-card__row">
                        <span className="request-card__label">Requester</span>
                        <span className="request-card__value">{request.npub}</span>
                      </div>

                      {request.eventPreview && (
                        <div className="event-preview">
                          <div className="event-preview__header">
                            <span className="event-preview__kind">{getEventKindLabel(request.eventPreview.kind)}</span>
                          </div>
                          {request.eventPreview.kind === 4 ? (
                            <div className="event-preview__encrypted">
                              🔒 Encrypted message (content hidden)
                            </div>
                          ) : request.eventPreview.content ? (
                            <div className="event-preview__content">
                              {truncateContent(request.eventPreview.content)}
                            </div>
                          ) : (
                            <div className="event-preview__no-content">
                              (No content)
                            </div>
                          )}
                          {request.eventPreview.tags && request.eventPreview.tags.length > 0 && (
                            <div className="event-preview__tags">
                              {request.eventPreview.tags.slice(0, 5).map((tag, idx) => (
                                tag[0] === 't' ? (
                                  <span key={idx} className="event-preview__tag">#{tag[1]}</span>
                                ) : tag[0] === 'p' ? (
                                  <span key={idx} className="event-preview__tag">@{tag[1].substring(0, 8)}…</span>
                                ) : null
                              ))}
                              {request.eventPreview.tags.length > 5 && (
                                <span className="event-preview__tag">+{request.eventPreview.tags.length - 5} more</span>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {!request.eventPreview && request.params && (
                        <div className="request-card__payload">
                          <span className="request-card__label">Payload</span>
                          <pre>{request.params}</pre>
                        </div>
                      )}
                    </div>

                    <footer className="request-card__footer">
                      {requiresPassword && (
                        <label className="request-card__password">
                          <span>Password</span>
                          <input
                            type="password"
                            autoComplete="current-password"
                            value={password}
                            placeholder="Enter the account password to authorize"
                            onChange={(event) => handlePasswordChange(request.id, event.target.value)}
                            disabled={approving}
                          />
                        </label>
                      )}
                      {isPending ? (
                        <button
                          type="button"
                          className="approve-btn"
                          onClick={() => handleApprove(request.id)}
                          disabled={approving || request.ttl === 0 || passwordMissing}
                        >
                          {approving ? 'Authorising…' : 'Authorize'}
                        </button>
                      ) : (
                        <span
                          className={`request-card__status request-card__status--${
                            isApproved ? 'approved' : 'expired'
                          }`}
                        >
                          {isApproved ? 'Authorized' : 'Expired'}
                        </span>
                      )}
                    </footer>

                    {isPending && status.state === 'error' && (
                      <p className="inline-feedback inline-feedback--error">{status.message}</p>
                    )}
                    {isPending && status.state === 'success' && (
                      <p className="inline-feedback inline-feedback--success">{status.message}</p>
                    )}
                  </article>
                );
              })}

            {!loading && filteredRequests.length > 0 && hasMoreRequests && (
              <div ref={loadMoreSentinelRef} style={{ height: '20px', margin: '10px 0' }} />
            )}

            {loadingMore && (
              <div className="empty-state" style={{ padding: '20px' }}>
                <span className="spinner" aria-hidden />
                <p>Loading more requests…</p>
              </div>
            )}
          </div>
        </section>
        ) : activeTab === 'keys' ? (
          <section className="panel">
            <div className="panel__intro">
              <div>
                <h1>Keys</h1>
                <p>
                  Manage your signing keys. View bunker URIs to connect apps, and unlock encrypted keys when needed.
                </p>
              </div>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => setShowCreateKeyForm(!showCreateKeyForm)}
              >
                {showCreateKeyForm ? 'Cancel' : '+ Create New Key'}
              </button>
            </div>

            {showCreateKeyForm && (
              <div className="create-key-form">
                <h3>Create New Key</h3>
                <p className="create-key-form__hint">
                  Generate a new key or import an existing one. The key will be encrypted with your passphrase.
                </p>
                <div className="form-group">
                  <label htmlFor="keyName">
                    Key Name <span className="required">*</span>
                  </label>
                  <input
                    id="keyName"
                    type="text"
                    className="form-input"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="e.g., personal, work"
                    disabled={creatingKey}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="keyPassphrase">
                    Passphrase (Optional)
                  </label>
                  <input
                    id="keyPassphrase"
                    type="password"
                    className="form-input"
                    value={newKeyPassphrase}
                    onChange={(e) => setNewKeyPassphrase(e.target.value)}
                    placeholder="Leave empty to store unencrypted"
                    disabled={creatingKey}
                  />
                  <span className="form-hint">Encrypts your key if provided. Leave empty to store in plain text.</span>
                </div>
                <div className="form-group">
                  <label htmlFor="keyNsec">
                    Import Existing Key (Optional)
                  </label>
                  <input
                    id="keyNsec"
                    type="password"
                    className="form-input"
                    value={newKeyNsec}
                    onChange={(e) => setNewKeyNsec(e.target.value)}
                    placeholder="nsec1... (leave empty to generate new)"
                    disabled={creatingKey}
                  />
                  <span className="form-hint">Leave empty to generate a brand new key</span>
                </div>
                <div className="form-actions">
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={handleCreateKey}
                    disabled={creatingKey || !newKeyName.trim() || !newKeyPassphrase}
                  >
                    {creatingKey ? 'Creating...' : 'Create Key'}
                  </button>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => {
                      setShowCreateKeyForm(false);
                      setNewKeyName('');
                      setNewKeyPassphrase('');
                      setNewKeyNsec('');
                      setKeysError(null);
                    }}
                    disabled={creatingKey}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {keysError && <p className="alert alert--error">{keysError}</p>}

            {keysLoading && (
              <div className="loading-skeleton">
                <div className="skeleton-card">
                  <div className="skeleton-header">
                    <div className="skeleton-title"></div>
                    <div className="skeleton-badge"></div>
                  </div>
                  <div className="skeleton-line"></div>
                  <div className="skeleton-line"></div>
                </div>
                <div className="skeleton-card">
                  <div className="skeleton-header">
                    <div className="skeleton-title"></div>
                    <div className="skeleton-badge"></div>
                  </div>
                  <div className="skeleton-line"></div>
                  <div className="skeleton-line"></div>
                </div>
              </div>
            )}

            {!keysLoading && keys.length === 0 && !keysError && (
              <div className="empty-state empty-state--large">
                <div className="empty-state__icon">🔑</div>
                <h3 className="empty-state__title">No keys yet</h3>
                <p className="empty-state__message">
                  Create your first signing key to start using Signet. Keys can be generated or imported from an existing nsec.
                </p>
                <button
                  type="button"
                  className="btn btn--primary"
                  onClick={() => setShowCreateKeyForm(true)}
                >
                  Create Your First Key
                </button>
              </div>
            )}

            {!keysLoading && keys.length > 0 && (
              <div className="key-list">
                {keys.map((key) => {
                  const statusBadgeClass =
                    key.status === 'online'
                      ? 'status-badge--online'
                      : key.status === 'locked'
                        ? 'status-badge--locked'
                        : 'status-badge--offline';

                  const statusIcon = key.status === 'online' ? '🟢' : key.status === 'locked' ? '🔒' : '⚠️';
                  const usageText = key.userCount > 0
                    ? `Used by ${key.userCount} ${key.userCount === 1 ? 'app' : 'apps'}`
                    : 'No apps connected';

                  return (
                    <article className="key-card" key={key.name}>
                      <header className="key-card__header">
                        <div>
                          <h2 className="key-card__name">{key.name}</h2>
                          <div className="key-card__status">
                            <span className={`status-badge ${statusBadgeClass}`}>
                              <span className="status-badge__icon">{statusIcon}</span>
                              {key.status}
                            </span>
                            <span className="key-card__usage">{usageText}</span>
                          </div>
                        </div>
                      </header>

                      <div className="key-card__body">
                        {key.npub && (
                          <div className="key-card__row">
                            <span className="key-card__label">Public Key</span>
                            <div className="key-card__value-container">
                              <code className="key-card__value">{key.npub}</code>
                              <button
                                type="button"
                                className="copy-btn"
                                onClick={() => copyToClipboard(key.npub!, 'npub')}
                                title="Copy npub"
                              >
                                📋
                              </button>
                            </div>
                          </div>
                        )}

                        {key.bunkerUri && (
                          <div className="key-card__row">
                            <span className="key-card__label">Bunker URI</span>
                            <div className="key-card__value-container">
                              <code className="key-card__value key-card__value--bunker">
                                {key.bunkerUri.substring(0, 60)}…
                              </code>
                              <button
                                type="button"
                                className="copy-btn"
                                onClick={() => copyToClipboard(key.bunkerUri!, 'bunker URI')}
                                title="Copy bunker URI"
                              >
                                📋
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="key-card__stats">
                          <span className="key-card__stat">
                            <strong>{key.userCount}</strong> {key.userCount === 1 ? 'app' : 'apps'}
                          </span>
                          <span className="key-card__stat">
                            <strong>{key.tokenCount}</strong> {key.tokenCount === 1 ? 'token' : 'tokens'}
                          </span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}

            {copyFeedback && (
              <p
                className={`inline-feedback ${
                  copyFeedback.type === 'success' ? 'inline-feedback--success' : 'inline-feedback--error'
                }`}
              >
                {copyFeedback.message}
              </p>
            )}
          </section>
        ) : activeTab === 'apps' ? (
          <section className="panel">
            <div className="panel__intro">
              <div>
                <h1>Connected Apps</h1>
                <p>
                  Manage apps and clients that have access to your keys. Click any row to see full details.
                </p>
              </div>
            </div>

            {appsError && <p className="alert alert--error">{appsError}</p>}

            {appsLoading && (
              <div className="loading-skeleton">
                <table className="apps-table">
                  <thead>
                    <tr>
                      <th>App Name</th>
                      <th>Key</th>
                      <th>Last Used</th>
                      <th>Requests</th>
                      <th>Permissions</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td colSpan={6}><div className="skeleton-line"></div></td></tr>
                    <tr><td colSpan={6}><div className="skeleton-line"></div></td></tr>
                    <tr><td colSpan={6}><div className="skeleton-line"></div></td></tr>
                  </tbody>
                </table>
              </div>
            )}

            {!appsLoading && apps.length === 0 && (
              <div className="empty-state empty-state--large">
                <div className="empty-state__icon">📱</div>
                <h3 className="empty-state__title">No connected apps</h3>
                <p className="empty-state__message">
                  Connect your first app using a bunker URI from the Keys page. Apps will appear here once connected.
                </p>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() => handleTabChange('keys')}
                >
                  Go to Keys →
                </button>
              </div>
            )}

            {!appsLoading && apps.length > 0 && (
              <div className="apps-table-container">
                <table className="apps-table">
                  <thead>
                    <tr>
                      <th>App Name</th>
                      <th>Key</th>
                      <th>Last Used</th>
                      <th>Requests</th>
                      <th>Permissions</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apps.map((app) => {
                      const appName = app.description || `${toNpub(app.userPubkey).substring(0, 16)}…`;
                      // Show lastUsedAt if available, otherwise show connection time
                      const lastUsedLabel = formatRelativeTime(app.lastUsedAt || app.connectedAt, now);
                      const isExpanded = expandedAppId === app.id;
                      const isEditing = editingAppId === app.id;

                      return (
                        <React.Fragment key={app.id}>
                          <tr className={`apps-table__row${isExpanded ? ' apps-table__row--expanded' : ''}`}>
                            <td className="apps-table__name-cell">
                              {isEditing ? (
                                <div className="apps-table__inline-edit">
                                  <input
                                    type="text"
                                    className="apps-table__name-input"
                                    value={editingAppName}
                                    onChange={(e) => setEditingAppName(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        handleSaveAppName(app.id);
                                      } else if (e.key === 'Escape') {
                                        handleCancelEditApp();
                                      }
                                    }}
                                    placeholder="Enter app name"
                                    autoFocus
                                  />
                                  <button
                                    type="button"
                                    className="apps-table__edit-btn apps-table__edit-btn--save"
                                    onClick={() => handleSaveAppName(app.id)}
                                    title="Save"
                                  >
                                    ✓
                                  </button>
                                  <button
                                    type="button"
                                    className="apps-table__edit-btn apps-table__edit-btn--cancel"
                                    onClick={handleCancelEditApp}
                                    title="Cancel"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  className="apps-table__name-button"
                                  onClick={() => setExpandedAppId(isExpanded ? null : app.id)}
                                >
                                  <span className="apps-table__expand-icon">{isExpanded ? '▼' : '▶'}</span>
                                  <span className="apps-table__name">{appName}</span>
                                </button>
                              )}
                            </td>
                            <td>
                              <code className="apps-table__key">{app.keyName}</code>
                            </td>
                            <td className="apps-table__time">{lastUsedLabel}</td>
                            <td className="apps-table__count">{app.requestCount}</td>
                            <td>
                              <span className="apps-table__permission-count">
                                {app.permissions.length} {app.permissions.length === 1 ? 'permission' : 'permissions'}
                              </span>
                            </td>
                            <td className="apps-table__actions">
                              {!isEditing && (
                                <>
                                  <button
                                    type="button"
                                    className="apps-table__action-btn apps-table__action-btn--edit"
                                    onClick={() => handleStartEditApp(app)}
                                    title="Rename app"
                                  >
                                    ✏️
                                  </button>
                                  <button
                                    type="button"
                                    className="apps-table__action-btn apps-table__action-btn--revoke"
                                    onClick={() => handleRevokeApp(app.id, appName)}
                                    title="Revoke access"
                                  >
                                    🗑️
                                  </button>
                                </>
                              )}
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr className="apps-table__details-row">
                              <td colSpan={6}>
                                <div className="apps-table__details">
                                  <div className="apps-table__details-section">
                                    <h3>App Details</h3>
                                    <dl className="apps-table__details-list">
                                      <div>
                                        <dt>Public Key</dt>
                                        <dd><code>{toNpub(app.userPubkey)}</code></dd>
                                      </div>
                                      <div>
                                        <dt>Connected</dt>
                                        <dd>{formatRelativeTime(app.connectedAt, now)}</dd>
                                      </div>
                                      <div>
                                        <dt>Last Activity</dt>
                                        <dd>
                                          {app.lastUsedAt
                                            ? formatRelativeTime(app.lastUsedAt, now)
                                            : 'No requests yet'}
                                        </dd>
                                      </div>
                                      <div>
                                        <dt>Total Requests</dt>
                                        <dd>{app.requestCount}</dd>
                                      </div>
                                    </dl>
                                  </div>
                                  <div className="apps-table__details-section apps-table__details-section--full">
                                    <h3>Permissions</h3>
                                    <ul className="apps-table__permissions-list">
                                      {app.permissions.map((perm, idx) => {
                                        const riskLevel = getPermissionRisk(perm);
                                        const riskIcon = riskLevel === 'high' ? '⚠️' : riskLevel === 'medium' ? '🔶' : '✓';
                                        return (
                                          <li key={idx} className={`permission-item permission-item--${riskLevel}`}>
                                            <span className="permission-item__risk-icon" title={`${riskLevel} risk`}>
                                              {riskIcon}
                                            </span>
                                            <span className="permission-item__name">{perm}</span>
                                            <button
                                              type="button"
                                              className="apps-table__permission-delete"
                                              onClick={() => {
                                                // TODO: Implement permission deletion
                                                console.log('Delete permission:', perm, 'for app:', app.id);
                                              }}
                                              title="Remove this permission"
                                            >
                                              🗑️
                                            </button>
                                          </li>
                                        );
                                      })}
                                    </ul>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ) : activeTab === 'settings' ? (
          <section className="panel">
            <div className="panel__intro">
              <div>
                <h1>Settings</h1>
                <p>
                  Configure your Signet preferences and behavior.
                </p>
              </div>
            </div>

            <div className="settings-section">
              <h2 className="settings-section__title">General</h2>
              <div className="settings-group">
                <div className="setting-item">
                  <div className="setting-item__info">
                    <label htmlFor="auto-refresh" className="setting-item__label">
                      Auto-refresh data
                    </label>
                    <p className="setting-item__description">
                      Automatically refresh dashboard data and requests at regular intervals
                    </p>
                  </div>
                  <div className="setting-item__control">
                    <label className="toggle-switch">
                      <input
                        id="auto-refresh"
                        type="checkbox"
                        checked={userSettings.autoRefresh}
                        onChange={(e) => setUserSettings({ ...userSettings, autoRefresh: e.target.checked })}
                      />
                      <span className="toggle-switch__slider"></span>
                    </label>
                  </div>
                </div>

                {userSettings.autoRefresh && (
                  <div className="setting-item">
                    <div className="setting-item__info">
                      <label htmlFor="refresh-interval" className="setting-item__label">
                        Refresh interval
                      </label>
                      <p className="setting-item__description">
                        How often to refresh data (in seconds)
                      </p>
                    </div>
                    <div className="setting-item__control">
                      <select
                        id="refresh-interval"
                        className="setting-select"
                        value={userSettings.refreshInterval}
                        onChange={(e) => setUserSettings({ ...userSettings, refreshInterval: Number(e.target.value) })}
                      >
                        <option value={10}>10 seconds</option>
                        <option value={30}>30 seconds</option>
                        <option value={60}>1 minute</option>
                        <option value={300}>5 minutes</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="settings-section">
              <h2 className="settings-section__title">Notifications</h2>
              <div className="settings-group">
                <div className="setting-item">
                  <div className="setting-item__info">
                    <label htmlFor="notifications-enabled" className="setting-item__label">
                      Enable notifications
                    </label>
                    <p className="setting-item__description">
                      Get browser notifications when new requests arrive
                      {notificationPermission === 'denied' && ' (Permission denied by browser)'}
                      {notificationPermission === 'unsupported' && ' (Not supported by browser)'}
                    </p>
                  </div>
                  <div className="setting-item__control">
                    <label className="toggle-switch">
                      <input
                        id="notifications-enabled"
                        type="checkbox"
                        checked={userSettings.notificationsEnabled}
                        disabled={notificationPermission === 'denied' || notificationPermission === 'unsupported'}
                        onChange={async (e) => {
                          if (e.target.checked && notificationPermission === 'default') {
                            const permission = await requestNotificationPermission();
                            if (permission === 'granted') {
                              setUserSettings({ ...userSettings, notificationsEnabled: true });
                            }
                          } else {
                            setUserSettings({ ...userSettings, notificationsEnabled: e.target.checked });
                          }
                        }}
                      />
                      <span className="toggle-switch__slider"></span>
                    </label>
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-section">
              <h2 className="settings-section__title">About</h2>
              <div className="settings-group">
                <div className="setting-item">
                  <div className="setting-item__info">
                    <p className="setting-item__label">Version</p>
                    <p className="setting-item__description">Signet 1.0.0</p>
                  </div>
                </div>
                <div className="setting-item">
                  <div className="setting-item__info">
                    <p className="setting-item__label">Documentation</p>
                    <p className="setting-item__description">
                      <a
                        href="https://github.com/Letdown2491/signet"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="setting-link"
                      >
                        View on GitHub →
                      </a>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}
      </main>

      {notificationToast && (
        <div className="notification-toast">
          <div className="notification-toast__content">
            <span className="notification-toast__message">{notificationToast.message}</span>
            {notificationToast.action && (
              <button
                type="button"
                className="notification-toast__action"
                onClick={notificationToast.action}
              >
                Enable
              </button>
            )}
            <button
              type="button"
              className="notification-toast__close"
              onClick={() => setNotificationToast(null)}
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {successToast && (
        <div className="success-toast">
          <div className="success-toast__content">
            <span className="success-toast__message">{successToast.message}</span>
            {successToast.undo && (
              <button
                type="button"
                className="success-toast__undo"
                onClick={() => {
                  successToast.undo?.();
                  setSuccessToast(null);
                }}
              >
                Undo
              </button>
            )}
            <button
              type="button"
              className="success-toast__close"
              onClick={() => setSuccessToast(null)}
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {confirmDialog && (
        <div className="confirm-dialog-overlay" onClick={() => setConfirmDialog(null)}>
          <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
            <h3 className="confirm-dialog__title">{confirmDialog.title}</h3>
            <p className="confirm-dialog__message">{confirmDialog.message}</p>
            <div className="confirm-dialog__actions">
              <button
                type="button"
                className="btn btn--secondary"
                onClick={() => setConfirmDialog(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={`btn ${confirmDialog.danger ? 'btn--danger' : 'btn--primary'}`}
                onClick={confirmDialog.action}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
