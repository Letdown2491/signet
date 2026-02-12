import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import { npubEncode, nsecEncode, decode as nip19Decode } from 'nostr-tools/nip19';
import { hexToBytes, bytesToHex } from '../lib/hex.js';
import { toErrorMessage } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import type { KeyInfo, KeySummary, EncryptionFormat } from '@signet/types';
import type { StoredKey } from '../../config/types.js';
import { encryptSecret, decryptSecret, encryptNip49, decryptNip49, isNcryptsec } from '../../config/keyring.js';
import { loadConfig, saveConfig } from '../../config/config.js';
import { keyRepository, appRepository } from '../repositories/index.js';
import { createSkeletonProfile } from '../lib/profile.js';
import { getEventService } from './event-service.js';

/**
 * Check if a stored key is encrypted (either legacy or NIP-49)
 */
function isKeyEncrypted(record: StoredKey): boolean {
    return !!(record.ncryptsec || (record.iv && record.data));
}

/**
 * Get the encryption format of a stored key
 */
function getEncryptionFormat(record: StoredKey): EncryptionFormat {
    if (record.ncryptsec) return 'nip49';
    if (record.iv && record.data) return 'legacy';
    return 'none';
}

export type ActiveKeyMap = Record<string, string>;

/**
 * Callback invoked when a key becomes active (unlocked or created).
 * Used to start the bunker backend for the key.
 */
export type OnKeyActivatedCallback = (keyName: string, secret: string) => Promise<void>;

/**
 * Callback invoked when a key is locked.
 * Used to stop the bunker backend for the key.
 */
export type OnKeyLockedCallback = (keyName: string) => void;

export interface KeyServiceConfig {
    configFile: string;
    allKeys: Record<string, StoredKey>;
    nostrRelays: string[];
    adminSecret?: string;
    onKeyActivated?: OnKeyActivatedCallback;
    onKeyLocked?: OnKeyLockedCallback;
}

export class KeyService {
    private readonly config: KeyServiceConfig;
    private activeKeys: ActiveKeyMap;

    constructor(config: KeyServiceConfig, initialActiveKeys: ActiveKeyMap = {}) {
        this.config = config;
        this.activeKeys = { ...initialActiveKeys };
    }

    getActiveKeys(): ActiveKeyMap {
        return { ...this.activeKeys };
    }

    /**
     * Set the callback for when a key becomes active.
     * Called after httpServer is available to wire up bunker backend startup.
     */
    setOnKeyActivated(callback: OnKeyActivatedCallback): void {
        this.config.onKeyActivated = callback;
    }

    /**
     * Set the callback for when a key is locked.
     * Used to stop the bunker backend for the key.
     */
    setOnKeyLocked(callback: OnKeyLockedCallback): void {
        this.config.onKeyLocked = callback;
    }

    isKeyActive(keyName: string): boolean {
        return !!this.activeKeys[keyName];
    }

    /**
     * Get the secret (nsec) for an active key.
     * Returns null if the key is not active.
     */
    getActiveKey(keyName: string): string | null {
        return this.activeKeys[keyName] ?? null;
    }

    /**
     * Get counts of keys by status (for health monitoring).
     * Fast synchronous method using in-memory state.
     */
    getKeyStats(): { active: number; locked: number; offline: number } {
        let active = 0;
        let locked = 0;
        let offline = 0;

        for (const [name, entry] of Object.entries(this.config.allKeys)) {
            if (this.activeKeys[name]) {
                active++;
            } else if (isKeyEncrypted(entry)) {
                // Encrypted but not active = locked
                locked++;
            } else {
                // Not encrypted and not active = offline (plain key not loaded)
                offline++;
            }
        }

        return { active, locked, offline };
    }

    /**
     * Lock an active key, removing it from memory.
     * The key remains encrypted on disk; all apps and permissions are preserved.
     */
    lockKey(keyName: string): void {
        const record = this.config.allKeys[keyName];
        if (!record) {
            throw new Error('Key not found');
        }

        if (!this.activeKeys[keyName]) {
            throw new Error('Key is not active');
        }

        // Only encrypted keys can be locked (unencrypted keys would auto-unlock on restart anyway)
        if (!isKeyEncrypted(record)) {
            throw new Error('Cannot lock an unencrypted key');
        }

        // Remove from memory
        delete this.activeKeys[keyName];

        // Notify to stop the backend
        if (this.config.onKeyLocked) {
            this.config.onKeyLocked(keyName);
        }

        // Emit event for real-time updates
        getEventService().emitKeyLocked(keyName);
    }

    /**
     * Lock all active encrypted keys.
     * Used by the kill switch to quickly disable all signing capability.
     * Returns the names of keys that were locked.
     */
    lockAllKeys(): string[] {
        const lockedKeys: string[] = [];

        for (const keyName of Object.keys(this.activeKeys)) {
            const record = this.config.allKeys[keyName];

            // Only lock encrypted keys (unencrypted keys would auto-unlock on restart)
            if (!record || !isKeyEncrypted(record)) {
                continue;
            }

            // Remove from memory
            delete this.activeKeys[keyName];

            // Notify to stop the backend
            if (this.config.onKeyLocked) {
                this.config.onKeyLocked(keyName);
            }

            // Emit event for real-time updates
            getEventService().emitKeyLocked(keyName);

            lockedKeys.push(keyName);
        }

        return lockedKeys;
    }

    async createKey(options: {
        keyName: string;
        passphrase?: string;
        confirmPassphrase?: string;
        nsec?: string;
        encryption?: EncryptionFormat;
    }): Promise<KeyInfo> {
        const { keyName, passphrase, confirmPassphrase, nsec, encryption = 'none' } = options;

        if (this.config.allKeys[keyName]) {
            throw new Error('A key with this name already exists');
        }

        // Check if importing an ncryptsec (already encrypted) - passphrase is for decryption, not new encryption
        const isImportingNcryptsec = nsec && isNcryptsec(nsec);

        // Validate passphrase confirmation for NEW encryption (not for ncryptsec import)
        if (encryption !== 'none' && !isImportingNcryptsec) {
            if (!passphrase || !passphrase.trim()) {
                throw new Error('Passphrase is required for encrypted keys');
            }
            if (passphrase !== confirmPassphrase) {
                throw new Error('Passphrase confirmation does not match');
            }
        }

        let secretKeyBytes: Uint8Array;
        let secretHex: string;
        let importedNcryptsec: string | undefined;

        if (nsec) {
            // Check if importing an ncryptsec (already encrypted)
            if (isImportingNcryptsec) {
                if (!passphrase) {
                    throw new Error('Passphrase is required to verify ncryptsec');
                }
                // Verify the passphrase by decrypting
                try {
                    secretHex = decryptNip49(nsec, passphrase);
                } catch {
                    throw new Error('Incorrect passphrase');
                }
                secretKeyBytes = hexToBytes(secretHex);
                importedNcryptsec = nsec; // Store as-is
            } else {
                // Regular nsec import
                const decoded = nip19Decode(nsec);
                if (decoded.type !== 'nsec') {
                    throw new Error('Provided secret is not a valid nsec');
                }
                secretKeyBytes = decoded.data as Uint8Array;
                secretHex = bytesToHex(secretKeyBytes);
            }
        } else {
            // Generate new key
            secretKeyBytes = generateSecretKey();
            secretHex = bytesToHex(secretKeyBytes);
            try {
                await createSkeletonProfile(secretKeyBytes, this.config.nostrRelays);
            } catch (error) {
                logger.warn('Failed to create skeleton profile', { error: toErrorMessage(error) });
            }
        }

        const secretNsec = nsecEncode(secretKeyBytes);
        const pubkey = getPublicKey(secretKeyBytes);
        const npub = npubEncode(pubkey);

        // Save to config
        const config = await loadConfig(this.config.configFile);
        let storedKey: StoredKey;
        let finalEncryptionFormat: EncryptionFormat;

        if (importedNcryptsec) {
            // Importing ncryptsec - store as-is
            storedKey = { ncryptsec: importedNcryptsec };
            finalEncryptionFormat = 'nip49';
        } else if (encryption === 'nip49' && passphrase) {
            // Encrypt with NIP-49
            storedKey = { ncryptsec: encryptNip49(secretHex, passphrase) };
            finalEncryptionFormat = 'nip49';
        } else if (encryption === 'legacy' && passphrase) {
            // Encrypt with legacy format
            storedKey = encryptSecret(secretNsec, passphrase);
            finalEncryptionFormat = 'legacy';
        } else {
            // Store unencrypted
            storedKey = { key: secretNsec };
            finalEncryptionFormat = 'none';
        }

        config.keys[keyName] = storedKey;
        await saveConfig(this.config.configFile, config);

        // Load into memory
        this.activeKeys[keyName] = secretNsec;
        this.config.allKeys[keyName] = storedKey;

        // Notify that key is now active (starts bunker backend)
        if (this.config.onKeyActivated) {
            await this.config.onKeyActivated(keyName, secretNsec);
        }

        const bunkerUri = this.buildBunkerUri(pubkey);

        const keyInfo: KeyInfo = {
            name: keyName,
            pubkey,
            npub,
            bunkerUri,
            status: 'online',
            isEncrypted: finalEncryptionFormat !== 'none',
            encryptionFormat: finalEncryptionFormat,
            userCount: 0,
            tokenCount: 0,
            requestCount: 0,
            lastUsedAt: null,
        };

        // Emit event for real-time updates
        getEventService().emitKeyCreated(keyInfo);

        return keyInfo;
    }

    async unlockKey(keyName: string, passphrase: string): Promise<string> {
        const record = this.config.allKeys[keyName];
        if (!record) {
            throw new Error('Key not found');
        }

        if (!isKeyEncrypted(record)) {
            throw new Error('No encrypted key material found');
        }

        let decrypted: string;

        if (record.ncryptsec) {
            // NIP-49 encrypted
            const secretHex = decryptNip49(record.ncryptsec, passphrase);
            decrypted = nsecEncode(hexToBytes(secretHex));
        } else if (record.iv && record.data) {
            // Legacy encrypted
            decrypted = decryptSecret({ iv: record.iv, data: record.data }, passphrase);
        } else {
            throw new Error('No encrypted key material found');
        }

        this.activeKeys[keyName] = decrypted;

        // Notify that key is now active (starts bunker backend)
        if (this.config.onKeyActivated) {
            await this.config.onKeyActivated(keyName, decrypted);
        }

        // Emit event for real-time updates
        getEventService().emitKeyUnlocked(keyName);

        return decrypted;
    }

    /**
     * Verify a passphrase for an encrypted key without changing its state.
     * Works for both active and locked keys.
     * Throws if the passphrase is invalid or the key is not encrypted.
     */
    verifyPassphrase(keyName: string, passphrase: string): void {
        const record = this.config.allKeys[keyName];
        if (!record) {
            throw new Error('Key not found');
        }

        if (!isKeyEncrypted(record)) {
            throw new Error('Key is not encrypted');
        }

        // Attempt to decrypt - throws if passphrase is wrong
        if (record.ncryptsec) {
            decryptNip49(record.ncryptsec, passphrase);
        } else if (record.iv && record.data) {
            decryptSecret({ iv: record.iv, data: record.data }, passphrase);
        }
    }

    loadKeyMaterial(keyName: string, nsec: string): void {
        this.activeKeys[keyName] = nsec;
    }

    async listKeys(): Promise<KeyInfo[]> {
        const keyNames = Object.keys(this.config.allKeys);
        if (keyNames.length === 0) {
            return [];
        }

        // Batch fetch all stats in 3 queries instead of 3N
        const allStats = await keyRepository.getKeyStatsBatch(keyNames);

        const keys: KeyInfo[] = [];

        for (const [name, entry] of Object.entries(this.config.allKeys)) {
            const isOnline = !!this.activeKeys[name];
            const encryptionFormat = getEncryptionFormat(entry);
            const encrypted = encryptionFormat !== 'none';
            const status = isOnline ? 'online' : encrypted ? 'locked' : 'offline';

            let pubkey: string | undefined;
            let npub: string | undefined;
            let bunkerUri: string | undefined;

            if (isOnline) {
                try {
                    const derived = this.deriveKeysFromSecret(this.activeKeys[name]);
                    pubkey = derived.pubkey;
                    npub = derived.npub;
                    bunkerUri = this.buildBunkerUri(pubkey);
                } catch (error) {
                    logger.warn('Unable to get info for key', { key: name, error: toErrorMessage(error) });
                }
            } else if (entry?.key) {
                try {
                    const secret = entry.key.startsWith('nsec1')
                        ? entry.key
                        : nsecEncode(hexToBytes(entry.key));
                    const derived = this.deriveKeysFromSecret(secret);
                    pubkey = derived.pubkey;
                    npub = derived.npub;
                    bunkerUri = this.buildBunkerUri(pubkey);
                } catch (error) {
                    logger.warn('Unable to get info for key', { key: name, error: toErrorMessage(error) });
                }
            }

            const stats = allStats.get(name) ?? {
                userCount: 0,
                tokenCount: 0,
                requestCount: 0,
                lastUsedAt: null,
            };

            keys.push({
                name,
                pubkey,
                npub,
                bunkerUri,
                status,
                isEncrypted: encrypted,
                encryptionFormat,
                userCount: stats.userCount,
                tokenCount: stats.tokenCount,
                requestCount: stats.requestCount,
                lastUsedAt: stats.lastUsedAt?.toISOString() ?? null,
            });
        }

        return keys;
    }

    async describeKeys(): Promise<KeySummary[]> {
        const allKeyNames = Object.keys(this.config.allKeys);
        if (allKeyNames.length === 0) {
            return [];
        }

        // Batch fetch all stats in 3 queries instead of 3N
        const allStats = await keyRepository.getKeyStatsBatch(allKeyNames);

        const keys: KeySummary[] = [];
        const remaining = new Set(allKeyNames);

        for (const [name, secret] of Object.entries(this.activeKeys)) {
            try {
                const { npub } = this.deriveKeysFromSecret(secret);
                const stats = allStats.get(name) ?? { userCount: 0, tokenCount: 0 };

                keys.push({
                    name,
                    npub,
                    userCount: stats.userCount,
                    tokenCount: stats.tokenCount,
                });
            } catch (error) {
                logger.warn('Unable to describe key', { key: name, error: toErrorMessage(error) });
            }

            remaining.delete(name);
        }

        for (const name of remaining) {
            const stats = allStats.get(name) ?? { userCount: 0, tokenCount: 0 };
            keys.push({
                name,
                userCount: stats.userCount,
                tokenCount: stats.tokenCount,
            });
        }

        return keys;
    }

    private buildBunkerUri(pubkey: string): string {
        const relayParams = this.config.nostrRelays
            .map(relay => `relay=${encodeURIComponent(relay)}`)
            .join('&');
        const secret = this.config.adminSecret?.trim().toLowerCase();
        const secretParam = secret ? `&secret=${encodeURIComponent(secret)}` : '';
        return `bunker://${pubkey}?${relayParams}${secretParam}`;
    }

    /**
     * Build a bunker URI with a custom token instead of the admin secret.
     * Used for one-time connection tokens.
     */
    buildBunkerUriWithToken(keyName: string, token: string): string | null {
        const secret = this.activeKeys[keyName];
        if (!secret) return null;

        const { pubkey } = this.deriveKeysFromSecret(secret);
        const relayParams = this.config.nostrRelays
            .map(relay => `relay=${encodeURIComponent(relay)}`)
            .join('&');
        return `bunker://${pubkey}?${relayParams}&secret=${encodeURIComponent(token)}`;
    }

    /**
     * Derive pubkey and npub from a secret key (nsec or hex).
     */
    private deriveKeysFromSecret(secret: string): { pubkey: string; npub: string } {
        let secretBytes: Uint8Array;

        if (secret.startsWith('nsec1')) {
            const decoded = nip19Decode(secret);
            if (decoded.type !== 'nsec') {
                throw new Error('Invalid nsec');
            }
            secretBytes = decoded.data as Uint8Array;
        } else {
            // Assume hex
            secretBytes = hexToBytes(secret);
        }

        const pubkey = getPublicKey(secretBytes);
        const npub = npubEncode(pubkey);
        return { pubkey, npub };
    }

    async setPassphrase(keyName: string, passphrase: string): Promise<void> {
        const record = this.config.allKeys[keyName];
        if (!record) {
            throw new Error('Key not found');
        }

        // Check if key is already encrypted (legacy or NIP-49)
        if (isKeyEncrypted(record)) {
            throw new Error('Key is already encrypted. Use change passphrase instead.');
        }

        // Get the plain key
        const nsec = record.key;
        if (!nsec) {
            throw new Error('No key material found');
        }

        if (!passphrase || !passphrase.trim()) {
            throw new Error('Passphrase is required');
        }

        // Encrypt the key (legacy format for backwards compatibility)
        const encrypted = encryptSecret(nsec, passphrase);

        // Save to config file
        const config = await loadConfig(this.config.configFile);
        config.keys[keyName] = encrypted;
        await saveConfig(this.config.configFile, config);

        // Update in-memory structures
        this.config.allKeys[keyName] = encrypted;
        // Key stays active in memory until daemon restart

        // Emit event for real-time updates
        getEventService().emitKeyUpdated(keyName);
    }

    async renameKey(oldName: string, newName: string): Promise<void> {
        // Check if old key exists
        const record = this.config.allKeys[oldName];
        if (!record) {
            throw new Error('Key not found');
        }

        // Check if new name is available
        if (this.config.allKeys[newName]) {
            throw new Error('A key with this name already exists');
        }

        // Validate new name
        if (!newName.trim()) {
            throw new Error('Key name cannot be empty');
        }

        // Update config file
        const config = await loadConfig(this.config.configFile);
        config.keys[newName] = config.keys[oldName];
        delete config.keys[oldName];
        await saveConfig(this.config.configFile, config);

        // Update in-memory structures
        this.config.allKeys[newName] = this.config.allKeys[oldName];
        delete this.config.allKeys[oldName];

        if (this.activeKeys[oldName]) {
            this.activeKeys[newName] = this.activeKeys[oldName];
            delete this.activeKeys[oldName];
        }

        // Update database references
        await keyRepository.renameKey(oldName, newName);

        // Emit event for real-time updates
        getEventService().emitKeyRenamed(oldName, newName);
    }

    async deleteKey(keyName: string, passphrase?: string): Promise<{ revokedApps: number }> {
        const record = this.config.allKeys[keyName];
        if (!record) {
            throw new Error('Key not found');
        }

        // For encrypted keys that are locked, require passphrase verification
        // If the key is unlocked (online), we don't need the passphrase
        const isUnlocked = !!this.activeKeys[keyName];
        if (isKeyEncrypted(record) && !isUnlocked) {
            if (!passphrase) {
                throw new Error('Passphrase required to delete encrypted key');
            }
            // Verify passphrase is correct
            try {
                if (record.ncryptsec) {
                    decryptNip49(record.ncryptsec, passphrase);
                } else if (record.iv && record.data) {
                    decryptSecret({ iv: record.iv, data: record.data }, passphrase);
                }
            } catch {
                throw new Error('Invalid passphrase');
            }
        }

        // Revoke all connected apps for this key
        const revokedApps = await appRepository.revokeByKeyName(keyName);

        // Remove from config file
        const config = await loadConfig(this.config.configFile);
        delete config.keys[keyName];
        await saveConfig(this.config.configFile, config);

        // Remove from memory
        delete this.activeKeys[keyName];
        delete this.config.allKeys[keyName];

        // Emit event for real-time updates
        getEventService().emitKeyDeleted(keyName);

        return { revokedApps };
    }

    /**
     * Encrypt an unencrypted key with NIP-49 or legacy format.
     * Used by the /keys/:name/encrypt endpoint.
     */
    async encryptKey(
        keyName: string,
        passphrase: string,
        confirmPassphrase: string,
        format: 'nip49' | 'legacy'
    ): Promise<void> {
        const record = this.config.allKeys[keyName];
        if (!record) {
            throw new Error('Key not found');
        }

        if (isKeyEncrypted(record)) {
            throw new Error('Key is already encrypted');
        }

        if (passphrase !== confirmPassphrase) {
            throw new Error('Passphrase confirmation does not match');
        }

        const nsec = record.key;
        if (!nsec) {
            throw new Error('No key material found');
        }

        // Encrypt the key
        let newRecord: StoredKey;
        if (format === 'nip49') {
            // NIP-49 needs hex, convert from nsec
            const decoded = nip19Decode(nsec);
            if (decoded.type !== 'nsec') {
                throw new Error('Invalid key format');
            }
            const secretHex = bytesToHex(decoded.data as Uint8Array);
            newRecord = { ncryptsec: encryptNip49(secretHex, passphrase) };
        } else {
            newRecord = encryptSecret(nsec, passphrase);
        }

        // Save to config
        const config = await loadConfig(this.config.configFile);
        config.keys[keyName] = newRecord;
        await saveConfig(this.config.configFile, config);

        // Update in-memory
        this.config.allKeys[keyName] = newRecord;

        // Emit event
        getEventService().emitKeyUpdated(keyName);
    }

    /**
     * Migrate a legacy-encrypted key to NIP-49 format.
     * Used by the /keys/:name/migrate endpoint.
     */
    async migrateToNip49(keyName: string, passphrase: string): Promise<void> {
        const record = this.config.allKeys[keyName];
        if (!record) {
            throw new Error('Key not found');
        }

        const format = getEncryptionFormat(record);
        if (format === 'none') {
            throw new Error('Key is not encrypted');
        }
        if (format === 'nip49') {
            throw new Error('Key already uses NIP-49');
        }

        // Decrypt with legacy format
        let secretNsec: string;
        try {
            secretNsec = decryptSecret({ iv: record.iv!, data: record.data! }, passphrase);
        } catch {
            throw new Error('Incorrect passphrase');
        }

        // Convert to hex for NIP-49
        const decoded = nip19Decode(secretNsec);
        if (decoded.type !== 'nsec') {
            throw new Error('Invalid key format');
        }
        const secretHex = bytesToHex(decoded.data as Uint8Array);

        // Re-encrypt with NIP-49
        const newRecord: StoredKey = { ncryptsec: encryptNip49(secretHex, passphrase) };

        // Save to config
        const config = await loadConfig(this.config.configFile);
        config.keys[keyName] = newRecord;
        await saveConfig(this.config.configFile, config);

        // Update in-memory
        this.config.allKeys[keyName] = newRecord;

        // Emit event
        getEventService().emitKeyUpdated(keyName);
    }

    /**
     * Export a key in the specified format.
     * Used by the /keys/:name/export endpoint.
     */
    async exportKey(
        keyName: string,
        currentPassphrase: string | undefined,
        format: 'nip49' | 'nsec',
        exportPassphrase?: string,
        confirmExportPassphrase?: string
    ): Promise<{ key: string; format: 'ncryptsec' | 'nsec' }> {
        const record = this.config.allKeys[keyName];
        if (!record) {
            throw new Error('Key not found');
        }

        // Get the secret
        let secretNsec: string;
        let secretHex: string;

        // If key is online (unlocked), use the in-memory secret
        const activeSecret = this.activeKeys[keyName];
        if (activeSecret) {
            secretNsec = activeSecret;
            const decoded = nip19Decode(secretNsec);
            secretHex = bytesToHex(decoded.data as Uint8Array);
        } else if (isKeyEncrypted(record)) {
            // Key is locked - need passphrase to decrypt from disk
            if (!currentPassphrase) {
                throw new Error('Current passphrase is required');
            }

            if (record.ncryptsec) {
                secretHex = decryptNip49(record.ncryptsec, currentPassphrase);
                secretNsec = nsecEncode(hexToBytes(secretHex));
            } else if (record.iv && record.data) {
                secretNsec = decryptSecret({ iv: record.iv, data: record.data }, currentPassphrase);
                const decoded = nip19Decode(secretNsec);
                secretHex = bytesToHex(decoded.data as Uint8Array);
            } else {
                throw new Error('Invalid key format');
            }
        } else if (record.key) {
            secretNsec = record.key;
            const decoded = nip19Decode(secretNsec);
            secretHex = bytesToHex(decoded.data as Uint8Array);
        } else {
            throw new Error('No key material found');
        }

        // Export in requested format
        if (format === 'nip49') {
            if (!exportPassphrase) {
                throw new Error('Export passphrase is required for NIP-49 format');
            }
            if (exportPassphrase !== confirmExportPassphrase) {
                throw new Error('Passphrase confirmation does not match');
            }
            return { key: encryptNip49(secretHex, exportPassphrase), format: 'ncryptsec' as const };
        } else {
            return { key: secretNsec, format: 'nsec' as const };
        }
    }
}
