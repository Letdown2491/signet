import { useState, useCallback, useEffect } from 'react';
import type { ConnectedApp, TrustLevel } from '@signet/types';
import { apiGet, apiPost, apiPatch, suspendAllApps as suspendAllAppsApi, resumeAllApps as resumeAllAppsApi } from '../lib/api-client.js';
import { buildErrorMessage } from '../lib/formatters.js';
import { useSSESubscription } from '../contexts/ServerEventsContext.js';
import { useMutation } from './useMutation.js';
import type { ServerEvent } from './useServerEvents.js';

interface UseAppsResult {
    apps: ConnectedApp[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    revokeApp: (appId: number) => Promise<boolean>;
    updateDescription: (appId: number, description: string) => Promise<boolean>;
    updateTrustLevel: (appId: number, trustLevel: TrustLevel) => Promise<boolean>;
    suspendApp: (appId: number, until?: Date) => Promise<boolean>;
    unsuspendApp: (appId: number) => Promise<boolean>;
    suspendAllApps: (until?: Date) => Promise<{ success: boolean; suspendedCount?: number }>;
    resumeAllApps: () => Promise<{ success: boolean; resumedCount?: number }>;
    suspendingAll: boolean;
    resumingAll: boolean;
    clearError: () => void;
}

export function useApps(): UseAppsResult {
    const [apps, setApps] = useState<ConnectedApp[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [initialFetchDone, setInitialFetchDone] = useState(false);

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            const response = await apiGet<{ apps: ConnectedApp[] }>('/apps');
            setApps(response.apps);
            setError(null);
        } catch (err) {
            setError(buildErrorMessage(err, 'Unable to load connected apps'));
        } finally {
            setLoading(false);
        }
    }, []);

    // Initial fetch on mount
    useEffect(() => {
        if (!initialFetchDone) {
            refresh();
            setInitialFetchDone(true);
        }
    }, [initialFetchDone, refresh]);

    // Subscribe to SSE events for real-time updates
    const handleSSEEvent = useCallback((event: ServerEvent) => {
        // Refresh data on reconnection to ensure consistency
        if (event.type === 'reconnected') {
            refresh();
            return;
        }

        if (event.type === 'app:connected') {
            // Add new app to the list (or replace if already exists)
            setApps(prev => {
                const exists = prev.some(app => app.id === event.app.id);
                if (exists) {
                    return prev.map(app => app.id === event.app.id ? event.app : app);
                }
                // Add new app at the beginning (most recent)
                return [event.app, ...prev];
            });
        } else if (event.type === 'app:revoked') {
            // Remove the revoked app from the list
            setApps(prev => prev.filter(app => app.id !== event.appId));
        } else if (event.type === 'app:updated') {
            // Update the app in the list
            setApps(prev => prev.map(app =>
                app.id === event.app.id ? event.app : app
            ));
        }
    }, [refresh]);

    useSSESubscription(handleSSEEvent);

    // Revoke app mutation
    const revokeMutation = useMutation(
        async (appId: number) => {
            const result = await apiPost<{ ok?: boolean; error?: string }>(`/apps/${appId}/revoke`, {});
            if (!result?.ok) {
                throw new Error(result?.error ?? 'Failed to revoke app access');
            }
            return true;
        },
        { errorPrefix: 'Failed to revoke app access', onSuccess: refresh, onError: setError }
    );

    // Update description mutation
    const descriptionMutation = useMutation(
        async ({ appId, description }: { appId: number; description: string }) => {
            if (!description.trim()) {
                throw new Error('Description is required');
            }
            const result = await apiPatch<{ ok?: boolean; error?: string }>(`/apps/${appId}`, {
                description: description.trim()
            });
            if (!result?.ok) {
                throw new Error(result?.error ?? 'Failed to rename app');
            }
            return true;
        },
        { errorPrefix: 'Failed to rename app', onSuccess: refresh, onError: setError }
    );

    // Update trust level mutation
    const trustLevelMutation = useMutation(
        async ({ appId, trustLevel }: { appId: number; trustLevel: TrustLevel }) => {
            const result = await apiPatch<{ ok?: boolean; error?: string }>(`/apps/${appId}`, { trustLevel });
            if (!result?.ok) {
                throw new Error(result?.error ?? 'Failed to update trust level');
            }
            return true;
        },
        { errorPrefix: 'Failed to update trust level', onSuccess: refresh, onError: setError }
    );

    // Suspend app mutation
    const suspendMutation = useMutation(
        async ({ appId, until }: { appId: number; until?: Date }) => {
            const body = until ? { until: until.toISOString() } : {};
            const result = await apiPost<{ ok?: boolean; error?: string }>(`/apps/${appId}/suspend`, body);
            if (!result?.ok) {
                throw new Error(result?.error ?? 'Failed to suspend app');
            }
            return true;
        },
        { errorPrefix: 'Failed to suspend app', onSuccess: refresh, onError: setError }
    );

    // Unsuspend app mutation
    const unsuspendMutation = useMutation(
        async (appId: number) => {
            const result = await apiPost<{ ok?: boolean; error?: string }>(`/apps/${appId}/unsuspend`, {});
            if (!result?.ok) {
                throw new Error(result?.error ?? 'Failed to unsuspend app');
            }
            return true;
        },
        { errorPrefix: 'Failed to unsuspend app', onSuccess: refresh, onError: setError }
    );

    // Suspend all apps mutation
    const suspendAllMutation = useMutation(
        async (until?: Date) => {
            const result = await suspendAllAppsApi(until?.toISOString());
            if (!result?.ok) {
                throw new Error(result?.error ?? 'Failed to suspend all apps');
            }
            return { success: true, suspendedCount: result.suspendedCount };
        },
        { errorPrefix: 'Failed to suspend all apps', onSuccess: refresh, onError: setError }
    );

    // Resume all apps mutation
    const resumeAllMutation = useMutation(
        async () => {
            const result = await resumeAllAppsApi();
            if (!result?.ok) {
                throw new Error(result?.error ?? 'Failed to resume all apps');
            }
            return { success: true, resumedCount: result.resumedCount };
        },
        { errorPrefix: 'Failed to resume all apps', onSuccess: refresh, onError: setError }
    );

    // Wrapper functions to maintain the same API
    const revokeApp = useCallback(async (appId: number): Promise<boolean> => {
        const result = await revokeMutation.mutate(appId);
        return result ?? false;
    }, [revokeMutation]);

    const updateDescription = useCallback(async (appId: number, description: string): Promise<boolean> => {
        const result = await descriptionMutation.mutate({ appId, description });
        return result ?? false;
    }, [descriptionMutation]);

    const updateTrustLevel = useCallback(async (appId: number, trustLevel: TrustLevel): Promise<boolean> => {
        const result = await trustLevelMutation.mutate({ appId, trustLevel });
        return result ?? false;
    }, [trustLevelMutation]);

    const suspendApp = useCallback(async (appId: number, until?: Date): Promise<boolean> => {
        const result = await suspendMutation.mutate({ appId, until });
        return result ?? false;
    }, [suspendMutation]);

    const unsuspendApp = useCallback(async (appId: number): Promise<boolean> => {
        const result = await unsuspendMutation.mutate(appId);
        return result ?? false;
    }, [unsuspendMutation]);

    const suspendAllApps = useCallback(async (until?: Date) => {
        const result = await suspendAllMutation.mutate(until);
        return result ?? { success: false };
    }, [suspendAllMutation]);

    const resumeAllApps = useCallback(async () => {
        const result = await resumeAllMutation.mutate(undefined);
        return result ?? { success: false };
    }, [resumeAllMutation]);

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    // Combine errors from all mutations
    const combinedError = error
        || revokeMutation.error
        || descriptionMutation.error
        || trustLevelMutation.error
        || suspendMutation.error
        || unsuspendMutation.error
        || suspendAllMutation.error
        || resumeAllMutation.error;

    return {
        apps,
        loading,
        error: combinedError,
        refresh,
        revokeApp,
        updateDescription,
        updateTrustLevel,
        suspendApp,
        unsuspendApp,
        suspendAllApps,
        resumeAllApps,
        suspendingAll: suspendAllMutation.loading,
        resumingAll: resumeAllMutation.loading,
        clearError,
    };
}
