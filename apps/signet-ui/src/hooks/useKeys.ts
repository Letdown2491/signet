import { useState, useCallback, useEffect } from 'react';
import type { KeyInfo, EncryptionFormat } from '@signet/types';
import {
    apiGet,
    apiPost,
    apiPatch,
    apiDelete,
    lockAllKeys as lockAllKeysApi,
    encryptKey as encryptKeyApi,
    migrateKeyToNip49 as migrateKeyApi,
    exportKey as exportKeyApi,
    ApiError,
    TimeoutError,
} from '../lib/api-client.js';
import { buildErrorMessage } from '../lib/formatters.js';

/** Result of an unlock attempt — carries a specific failure reason for the UI. */
export interface UnlockResult {
    ok: boolean;
    error?: string;
}

/**
 * Turn an unlock failure into a specific, honest message: distinguish "can't reach the
 * signer" (network/timeout) from a wrong passphrase (the daemon now returns a clear
 * "Incorrect passphrase" error, which buildErrorMessage surfaces from the response body).
 */
function describeUnlockError(err: unknown): string {
    if (err instanceof TimeoutError) {
        return 'Couldn’t reach the signer — the request timed out. Check your connection.';
    }
    if (err instanceof ApiError && err.status === 0) {
        return 'Couldn’t reach the signer. Check your connection.';
    }
    return buildErrorMessage(err, 'Failed to unlock key.');
}
import { useMutation } from './useMutation.js';
import { useSSESubscription } from '../contexts/ServerEventsContext.js';
import type { ServerEvent } from './useServerEvents.js';

interface DeleteKeyResult {
    ok: boolean;
    revokedApps?: number;
    error?: string;
}

interface UseKeysResult {
    keys: KeyInfo[];
    loading: boolean;
    error: string | null;
    refresh: () => Promise<void>;
    createKey: (data: {
        keyName: string;
        passphrase?: string;
        confirmPassphrase?: string;
        nsec?: string;
        encryption?: EncryptionFormat;
    }) => Promise<KeyInfo | null>;
    deleteKey: (keyName: string, passphrase?: string) => Promise<{ success: boolean; revokedApps?: number }>;
    unlockKey: (keyName: string, passphrase: string) => Promise<UnlockResult>;
    lockKey: (keyName: string) => Promise<boolean>;
    lockAllKeys: () => Promise<{ success: boolean; lockedCount?: number }>;
    renameKey: (keyName: string, newName: string) => Promise<boolean>;
    setPassphrase: (keyName: string, passphrase: string) => Promise<boolean>;
    encryptKey: (keyName: string, encryption: 'nip49' | 'legacy', passphrase: string, confirmPassphrase: string) => Promise<boolean>;
    migrateKey: (keyName: string, passphrase: string) => Promise<boolean>;
    exportKey: (keyName: string, format: 'nsec' | 'nip49', currentPassphrase?: string, exportPassphrase?: string, confirmExportPassphrase?: string) => Promise<{ key?: string; format?: 'nsec' | 'ncryptsec' } | null>;
    creating: boolean;
    deleting: boolean;
    unlocking: string | null;  // Key name being unlocked, or null
    locking: string | null;    // Key name being locked, or null
    lockingAll: boolean;
    renaming: boolean;
    settingPassphrase: boolean;
    encrypting: boolean;
    migrating: boolean;
    exporting: boolean;
    clearError: () => void;
}

export function useKeys(): UseKeysResult {
    const [keys, setKeys] = useState<KeyInfo[]>([]);
    // `loading` represents the *initial* load only. Background refreshes (SSE
    // events, post-mutation) must not flip it: KeysPanel shows a full-page spinner
    // while `loading && keys.length === 0`, which would otherwise unmount the open
    // create-key modal mid-typing (resetting the form and stealing focus) whenever
    // a refresh lands while the user has no keys yet.
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [lockingKeyName, setLockingKeyName] = useState<string | null>(null);
    const [unlockingKeyName, setUnlockingKeyName] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const response = await apiGet<{ keys: KeyInfo[] }>('/keys');
            setKeys(response.keys);
            setError(null);
        } catch (err) {
            setError(buildErrorMessage(err, 'Unable to load keys'));
        } finally {
            // Only ever clears the initial-load spinner; never re-shown on refresh.
            setLoading(false);
        }
    }, []);

    // Initial load
    useEffect(() => {
        refresh();
    }, [refresh]);

    // Subscribe to SSE events for real-time updates
    const handleSSEEvent = useCallback((event: ServerEvent) => {
        // Refresh data on reconnection to ensure consistency
        if (event.type === 'reconnected') {
            refresh();
            return;
        }

        // Handle key events - refresh list on any key change
        if (
            event.type === 'key:created' ||
            event.type === 'key:unlocked' ||
            event.type === 'key:locked' ||
            event.type === 'key:deleted' ||
            event.type === 'key:renamed' ||
            event.type === 'key:updated'
        ) {
            refresh();
        }
    }, [refresh]);

    useSSESubscription(handleSSEEvent);

    // Create key mutation
    const createMutation = useMutation(
        async (data: {
            keyName: string;
            passphrase?: string;
            confirmPassphrase?: string;
            nsec?: string;
            encryption?: EncryptionFormat;
        }) => {
            if (!data.keyName.trim()) {
                throw new Error('Key name is required');
            }
            const result = await apiPost<{ ok?: boolean; key?: KeyInfo; error?: string }>('/keys', data);
            if (!result.ok) {
                throw new Error(result.error || 'Failed to create key');
            }
            return result.key ?? null;
        },
        { errorPrefix: 'Failed to create key', onSuccess: refresh, onError: setError }
    );

    // Delete key mutation
    const deleteMutation = useMutation(
        async ({ keyName, passphrase }: { keyName: string; passphrase?: string }) => {
            const result = await apiDelete<DeleteKeyResult>(
                `/keys/${encodeURIComponent(keyName)}`,
                passphrase ? { passphrase } : undefined
            );
            if (!result.ok) {
                throw new Error(result.error || 'Failed to delete key');
            }
            return { success: true, revokedApps: result.revokedApps };
        },
        { errorPrefix: 'Failed to delete key', onSuccess: refresh, onError: setError }
    );

    // Unlock key mutation. The mutation fn resolves with a discriminated result instead of
    // throwing, so unlockKey can return the specific failure reason to the UI (the daemon's
    // rate-limited unlock endpoint throws on a wrong passphrase → ApiError with the body message).
    const unlockMutation = useMutation(
        async ({ keyName, passphrase }: { keyName: string; passphrase: string }): Promise<UnlockResult> => {
            try {
                await apiPost(`/keys/${encodeURIComponent(keyName)}/unlock`, { passphrase });
                return { ok: true };
            } catch (err) {
                return { ok: false, error: describeUnlockError(err) };
            }
        },
        { onSuccess: refresh }
    );

    // Lock key mutation
    const lockMutation = useMutation(
        async ({ keyName }: { keyName: string }) => {
            const result = await apiPost<{ ok?: boolean; error?: string }>(
                `/keys/${encodeURIComponent(keyName)}/lock`
            );
            if (!result.ok) {
                throw new Error(result.error || 'Failed to lock key');
            }
            return true;
        },
        { errorPrefix: 'Failed to lock key', onSuccess: refresh, onError: setError }
    );

    // Lock all keys mutation
    const lockAllMutation = useMutation(
        async () => {
            const result = await lockAllKeysApi();
            if (!result.ok) {
                throw new Error(result.error || 'Failed to lock all keys');
            }
            return { success: true, lockedCount: result.lockedCount };
        },
        { errorPrefix: 'Failed to lock all keys', onSuccess: refresh, onError: setError }
    );

    // Rename key mutation
    const renameMutation = useMutation(
        async ({ keyName, newName }: { keyName: string; newName: string }) => {
            if (!newName.trim()) {
                throw new Error('New key name is required');
            }
            const result = await apiPatch<{ ok?: boolean; error?: string }>(
                `/keys/${encodeURIComponent(keyName)}`,
                { newName: newName.trim() }
            );
            if (!result.ok) {
                throw new Error(result.error || 'Failed to rename key');
            }
            return true;
        },
        { errorPrefix: 'Failed to rename key', onSuccess: refresh, onError: setError }
    );

    // Set passphrase mutation
    const setPassphraseMutation = useMutation(
        async ({ keyName, passphrase }: { keyName: string; passphrase: string }) => {
            if (!passphrase.trim()) {
                throw new Error('Passphrase is required');
            }
            const result = await apiPost<{ ok?: boolean; error?: string }>(
                `/keys/${encodeURIComponent(keyName)}/set-passphrase`,
                { passphrase }
            );
            if (!result.ok) {
                throw new Error(result.error || 'Failed to set passphrase');
            }
            return true;
        },
        { errorPrefix: 'Failed to set passphrase', onSuccess: refresh, onError: setError }
    );

    // Encrypt key mutation
    const encryptMutation = useMutation(
        async ({
            keyName,
            encryption,
            passphrase,
            confirmPassphrase,
        }: {
            keyName: string;
            encryption: 'nip49' | 'legacy';
            passphrase: string;
            confirmPassphrase: string;
        }) => {
            const result = await encryptKeyApi(keyName, encryption, passphrase, confirmPassphrase);
            if (!result.ok) {
                throw new Error(result.error || 'Failed to encrypt key');
            }
            return true;
        },
        { errorPrefix: 'Failed to encrypt key', onSuccess: refresh, onError: setError }
    );

    // Migrate key to NIP-49 mutation
    const migrateMutation = useMutation(
        async ({ keyName, passphrase }: { keyName: string; passphrase: string }) => {
            const result = await migrateKeyApi(keyName, passphrase);
            if (!result.ok) {
                throw new Error(result.error || 'Failed to migrate key');
            }
            return true;
        },
        { errorPrefix: 'Failed to migrate key', onSuccess: refresh, onError: setError }
    );

    // Export key mutation
    const exportMutation = useMutation(
        async ({
            keyName,
            format,
            currentPassphrase,
            exportPassphrase,
            confirmExportPassphrase,
        }: {
            keyName: string;
            format: 'nsec' | 'nip49';
            currentPassphrase?: string;
            exportPassphrase?: string;
            confirmExportPassphrase?: string;
        }) => {
            const result = await exportKeyApi(
                keyName,
                format,
                currentPassphrase,
                exportPassphrase,
                confirmExportPassphrase
            );
            if (!result.ok) {
                throw new Error(result.error || 'Failed to export key');
            }
            return { key: result.key, format: result.format };
        },
        { errorPrefix: 'Failed to export key', onError: setError }
    );

    // Wrapper functions to maintain the same API
    const createKey = useCallback(async (data: {
        keyName: string;
        passphrase?: string;
        confirmPassphrase?: string;
        nsec?: string;
        encryption?: EncryptionFormat;
    }) => {
        return createMutation.mutate(data);
    }, [createMutation]);

    const deleteKey = useCallback(async (keyName: string, passphrase?: string) => {
        const result = await deleteMutation.mutate({ keyName, passphrase });
        return result ?? { success: false };
    }, [deleteMutation]);

    const unlockKey = useCallback(async (keyName: string, passphrase: string): Promise<UnlockResult> => {
        setUnlockingKeyName(keyName);
        try {
            const result = await unlockMutation.mutate({ keyName, passphrase });
            const outcome: UnlockResult = result ?? { ok: false, error: 'Failed to unlock key.' };
            // Surface the reason in the shared error state too (matches other key mutations).
            if (!outcome.ok && outcome.error) {
                setError(outcome.error);
            }
            return outcome;
        } finally {
            setUnlockingKeyName(null);
        }
    }, [unlockMutation]);

    const lockKey = useCallback(async (keyName: string) => {
        setLockingKeyName(keyName);
        try {
            const result = await lockMutation.mutate({ keyName });
            return result ?? false;
        } finally {
            setLockingKeyName(null);
        }
    }, [lockMutation]);

    const lockAllKeys = useCallback(async () => {
        const result = await lockAllMutation.mutate(undefined);
        return result ?? { success: false };
    }, [lockAllMutation]);

    const renameKey = useCallback(async (keyName: string, newName: string) => {
        const result = await renameMutation.mutate({ keyName, newName });
        return result ?? false;
    }, [renameMutation]);

    const setPassphrase = useCallback(async (keyName: string, passphrase: string) => {
        const result = await setPassphraseMutation.mutate({ keyName, passphrase });
        return result ?? false;
    }, [setPassphraseMutation]);

    const encryptKey = useCallback(async (
        keyName: string,
        encryption: 'nip49' | 'legacy',
        passphrase: string,
        confirmPassphrase: string
    ) => {
        const result = await encryptMutation.mutate({ keyName, encryption, passphrase, confirmPassphrase });
        return result ?? false;
    }, [encryptMutation]);

    const migrateKey = useCallback(async (keyName: string, passphrase: string) => {
        const result = await migrateMutation.mutate({ keyName, passphrase });
        return result ?? false;
    }, [migrateMutation]);

    const exportKey = useCallback(async (
        keyName: string,
        format: 'nsec' | 'nip49',
        currentPassphrase?: string,
        exportPassphrase?: string,
        confirmExportPassphrase?: string
    ) => {
        const result = await exportMutation.mutate({
            keyName,
            format,
            currentPassphrase,
            exportPassphrase,
            confirmExportPassphrase,
        });
        return result ?? null;
    }, [exportMutation]);

    const clearError = useCallback(() => {
        setError(null);
    }, []);

    // Combine errors from all mutations
    const combinedError = error
        || createMutation.error
        || deleteMutation.error
        || unlockMutation.error
        || lockMutation.error
        || lockAllMutation.error
        || renameMutation.error
        || setPassphraseMutation.error
        || encryptMutation.error
        || migrateMutation.error
        || exportMutation.error;

    return {
        keys,
        loading,
        error: combinedError,
        refresh,
        createKey,
        deleteKey,
        unlockKey,
        lockKey,
        lockAllKeys,
        renameKey,
        setPassphrase,
        encryptKey,
        migrateKey,
        exportKey,
        creating: createMutation.loading,
        deleting: deleteMutation.loading,
        unlocking: unlockingKeyName,
        locking: lockingKeyName,
        lockingAll: lockAllMutation.loading,
        renaming: renameMutation.loading,
        settingPassphrase: setPassphraseMutation.loading,
        encrypting: encryptMutation.loading,
        migrating: migrateMutation.loading,
        exporting: exportMutation.loading,
        clearError,
    };
}
