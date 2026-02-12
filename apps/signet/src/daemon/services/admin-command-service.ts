import { finalizeEvent, type Event } from 'nostr-tools';
import { decode as nip19Decode } from 'nostr-tools/nip19';
import { encrypt as nip04Encrypt, decrypt as nip04Decrypt } from 'nostr-tools/nip04';
import { encrypt as nip44Encrypt, decrypt as nip44Decrypt, getConversationKey } from 'nostr-tools/nip44';
import createDebug from 'debug';
import WebSocket from 'ws';
import type { KillSwitchConfig, KillSwitchDmType } from '../../config/types.js';
import { bytesToHex, hexToBytes } from '../lib/hex.js';
import { logger } from '../lib/logger.js';
import type { KeyService } from './key-service.js';
import type { AppService } from './app-service.js';
import { emitCurrentStats, getEventService } from './event-service.js';
import { getDeadManSwitchService } from './dead-man-switch-service.js';
import { adminLogRepository, type AdminEventType } from '../repositories/admin-log-repository.js';
import { getKillSwitchClientInfo } from '../lib/client-info.js';
import { TTLCache } from '../lib/ttl-cache.js';
import { toErrorMessage } from '../lib/errors.js';

// TTL for processed event IDs: 1 hour (reduced from 24h to limit memory usage)
const PROCESSED_EVENT_TTL_MS = 60 * 60 * 1000;
// Max processed events to track (prevents unbounded growth)
const PROCESSED_EVENT_MAX_SIZE = 10_000;

// Reconnection backoff settings
const RECONNECT_BASE_DELAY_MS = 5_000;      // Start with 5s
const RECONNECT_MAX_DELAY_MS = 60_000;      // Max 60s between retries
const RECONNECT_MAX_RETRIES = 10;           // Max retries before giving up on a relay

const debug = createDebug('signet:admin');

/**
 * Available admin commands sent via DM
 */
type AdminCommand =
    | 'panic'             // Emergency: lock all keys + suspend all apps
    | 'lockall'           // Alias for panic
    | 'killswitch'        // Alias for panic
    | 'lockall keys'      // Lock all keys
    | 'suspendall apps'   // Suspend all apps
    | 'resumeall apps'    // Resume all apps
    | 'alive'             // Reset dead man's switch timer
    | 'status';

/**
 * Result of attempting to lock a single key
 */
type LockKeyResult =
    | { status: 'locked'; keyName: string }
    | { status: 'not_found'; keyName: string }
    | { status: 'already_locked'; keyName: string }
    | { status: 'not_encrypted'; keyName: string };

/**
 * AdminCommandService listens for Nostr DMs from an authorized admin
 * and executes kill switch commands (lock keys, suspend apps).
 */
export class AdminCommandService {
    private readonly config: KillSwitchConfig;
    private readonly adminPubkey: string;
    private readonly keyService: KeyService;
    private readonly appService: AppService;
    private readonly getActiveKeySecrets: () => Record<string, string>;
    private readonly daemonVersion: string;
    private websockets: WebSocket[] = [];
    private isRunning = false;
    // Track processed event IDs to avoid duplicate command execution (TTL-based)
    private processedEventIds = new TTLCache<boolean>('admin-processed-events', {
        ttlMs: PROCESSED_EVENT_TTL_MS,
        maxSize: PROCESSED_EVENT_MAX_SIZE,
    });
    // Subscription generation to invalidate old reconnection attempts
    private subscriptionGeneration = 0;
    // Track pending reconnection timers to prevent memory leaks
    private reconnectTimers: Set<NodeJS.Timeout> = new Set();
    // Track retry counts per relay for exponential backoff
    private relayRetryCounts: Map<string, number> = new Map();

    constructor(options: {
        config: KillSwitchConfig;
        keyService: KeyService;
        appService: AppService;
        getActiveKeySecrets: () => Record<string, string>;
        daemonVersion: string;
    }) {
        this.config = options.config;
        this.keyService = options.keyService;
        this.appService = options.appService;
        this.getActiveKeySecrets = options.getActiveKeySecrets;
        this.daemonVersion = options.daemonVersion;

        // Decode admin npub to hex pubkey
        const decoded = nip19Decode(this.config.adminNpub);
        if (decoded.type !== 'npub') {
            throw new Error('Invalid admin npub');
        }
        this.adminPubkey = decoded.data as string;
    }

    /**
     * Log an admin event for kill switch actions
     */
    private async logAdminEvent(
        eventType: AdminEventType,
        options?: { keyName?: string; appId?: number; appName?: string }
    ): Promise<void> {
        try {
            const clientInfo = getKillSwitchClientInfo(this.daemonVersion);
            const adminLog = await adminLogRepository.create({
                eventType,
                keyName: options?.keyName,
                appId: options?.appId,
                appName: options?.appName,
                ...clientInfo,
            });
            getEventService().emitAdminEvent(adminLogRepository.toActivityEntry(adminLog));
        } catch (error) {
            logger.error('Failed to log admin event', { error: toErrorMessage(error) });
        }
    }

    /**
     * Log a kill switch command execution (for audit trail)
     */
    private async logCommandExecution(command: string, result: string): Promise<void> {
        try {
            const clientInfo = getKillSwitchClientInfo(this.daemonVersion);
            const adminLog = await adminLogRepository.create({
                eventType: 'command_executed',
                command,
                commandResult: result.slice(0, 500), // Truncate long results
                ...clientInfo,
            });
            getEventService().emitAdminEvent(adminLogRepository.toActivityEntry(adminLog));
        } catch (error) {
            logger.error('Failed to log command execution', { error: toErrorMessage(error) });
        }
    }

    /**
     * Start listening for admin commands via DMs
     */
    start(): void {
        if (this.isRunning) {
            return;
        }

        logger.info('Starting kill switch listener', { dmType: this.config.dmType });
        debug('Admin pubkey: %s', this.adminPubkey);
        debug('Admin relays: %s', this.config.adminRelays.join(', '));

        this.subscribeToAllKeys();
        this.isRunning = true;
    }

    /**
     * Refresh subscriptions when keys are added/removed.
     * Call this when a key is unlocked or locked.
     */
    refresh(): void {
        if (!this.isRunning) {
            return;
        }

        logger.info('Refreshing kill switch subscriptions after key change');

        // Increment generation to invalidate old reconnection attempts
        this.subscriptionGeneration++;

        // Close existing websocket connections
        this.closeAllWebsockets();

        // Re-subscribe with current active keys
        this.subscribeToAllKeys();
    }

    /**
     * Stop listening for admin commands
     */
    stop(): void {
        if (!this.isRunning) {
            return;
        }

        logger.info('Stopping kill switch listener');
        this.closeAllWebsockets();
        this.processedEventIds.destroy();
        this.isRunning = false;
    }

    /**
     * Close all active websocket connections and clear pending timers
     */
    private closeAllWebsockets(): void {
        // Clear all pending reconnection timers first
        for (const timer of this.reconnectTimers) {
            clearTimeout(timer);
        }
        this.reconnectTimers.clear();

        // Reset retry counts
        this.relayRetryCounts.clear();

        // Close all websockets
        for (const ws of this.websockets) {
            try {
                // Remove all event listeners before closing to prevent memory leaks
                ws.removeAllListeners();
                ws.close();
            } catch {
                // Ignore close errors
            }
        }
        this.websockets = [];
    }

    /**
     * Subscribe to DMs for all active keys
     */
    private subscribeToAllKeys(): void {
        const activeKeys = this.getActiveKeySecrets();
        const pubkeys: string[] = [];

        // Get pubkeys of all active keys
        for (const nsec of Object.values(activeKeys)) {
            try {
                const pubkey = this.getPubkeyFromNsec(nsec);
                pubkeys.push(pubkey);
            } catch (error) {
                debug('Failed to derive pubkey: %O', error);
            }
        }

        if (pubkeys.length === 0) {
            logger.info('Kill switch: No active keys to listen on');
            return;
        }

        logger.info('Kill switch listening for DMs', { keyCount: pubkeys.length });
        debug('Subscribing to DMs for %d keys', pubkeys.length);

        // Subscribe based on DM type
        if (this.config.dmType === 'NIP04') {
            this.subscribeNip04(pubkeys);
        } else {
            this.subscribeNip17(pubkeys);
        }
    }

    /**
     * Subscribe to NIP-04 DMs (kind 4) using raw WebSockets
     * (SimplePool has issues not delivering events even when subscription is active)
     */
    private subscribeNip04(recipientPubkeys: string[]): void {
        // Only get events from NOW onwards to avoid replaying old commands
        const since = Math.floor(Date.now() / 1000);
        const filter = { kinds: [4], '#p': recipientPubkeys, since };
        logger.debug('Subscribing to NIP-04 DMs', { since, relays: this.config.adminRelays, pubkeys: recipientPubkeys });

        // Connect to each admin relay via raw WebSocket
        for (const relay of this.config.adminRelays) {
            this.connectToRelay(relay, filter, recipientPubkeys);
        }
    }

    /**
     * Connect to a single relay and subscribe to DMs
     */
    private connectToRelay(relay: string, filter: object, recipientPubkeys: string[]): void {
        const ws = new WebSocket(relay);
        const subId = `killswitch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        // Capture current generation for this connection
        const generation = this.subscriptionGeneration;

        ws.on('open', () => {
            // Check if this connection is still valid
            if (generation !== this.subscriptionGeneration) {
                ws.close();
                return;
            }
            logger.debug('Kill switch connected to relay', { relay });
            this.onRelayConnected(relay);
            const req = JSON.stringify(['REQ', subId, filter]);
            ws.send(req);
        });

        ws.on('message', (data: Buffer) => {
            // Check if this connection is still valid
            if (generation !== this.subscriptionGeneration) {
                ws.close();
                return;
            }

            const msg = data.toString();
            try {
                const parsed = JSON.parse(msg);
                if (parsed[0] === 'EVENT' && parsed[1] === subId) {
                    const event = parsed[2] as Event;

                    // Deduplicate: skip if we've already processed this event
                    if (this.processedEventIds.has(event.id)) {
                        debug('Skipping duplicate event %s', event.id.slice(0, 8));
                        return;
                    }
                    this.processedEventIds.set(event.id, true);

                    logger.debug('Kill switch received DM', { from: event.pubkey.slice(0, 16) });
                    this.handleNip04Event(event).catch((err) => {
                        logger.error('Error handling NIP-04 event', { error: toErrorMessage(err) });
                    });
                } else if (parsed[0] === 'EOSE' && parsed[1] === subId) {
                    logger.debug('Kill switch subscription active', { relay });
                } else if (parsed[0] === 'NOTICE') {
                    debug('NOTICE from %s: %s', relay, parsed[1]);
                }
            } catch {
                debug('Non-JSON message from %s: %s', relay, msg.slice(0, 100));
            }
        });

        ws.on('error', (err: Error) => {
            logger.error('Kill switch WebSocket error', { relay, error: err.message });
        });

        ws.on('close', () => {
            debug('WebSocket closed for %s', relay);
            // Only attempt reconnection if generation matches and still running
            if (this.isRunning && generation === this.subscriptionGeneration) {
                this.scheduleReconnect(relay, filter, recipientPubkeys, generation, 'nip04');
            }
        });

        this.websockets.push(ws);
    }

    /**
     * Schedule a reconnection attempt with exponential backoff
     */
    private scheduleReconnect(
        relay: string,
        filter: object,
        recipientPubkeys: string[],
        generation: number,
        type: 'nip04' | 'nip17'
    ): void {
        // Get current retry count for this relay
        const retryCount = this.relayRetryCounts.get(relay) ?? 0;

        // Check if we've exceeded max retries
        if (retryCount >= RECONNECT_MAX_RETRIES) {
            logger.warn('Kill switch: max retries exceeded for relay', { relay, retryCount });
            return;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, retryCount),
            RECONNECT_MAX_DELAY_MS
        );

        debug('scheduling reconnect for %s in %dms (attempt %d)', relay, delay, retryCount + 1);

        const timer = setTimeout(() => {
            // Remove this timer from tracking
            this.reconnectTimers.delete(timer);

            // Check if still valid
            if (!this.isRunning || generation !== this.subscriptionGeneration) {
                return;
            }

            // Increment retry count
            this.relayRetryCounts.set(relay, retryCount + 1);

            logger.debug('Kill switch reconnecting', { relay, attempt: retryCount + 1 });
            if (type === 'nip04') {
                this.connectToRelay(relay, filter, recipientPubkeys);
            } else {
                this.connectToRelayNip17(relay, filter);
            }
        }, delay);

        // Track the timer so we can clear it on shutdown
        this.reconnectTimers.add(timer);
    }

    /**
     * Reset retry count for a relay on successful connection
     */
    private onRelayConnected(relay: string): void {
        if (this.relayRetryCounts.has(relay)) {
            debug('resetting retry count for %s', relay);
            this.relayRetryCounts.delete(relay);
        }
    }

    /**
     * Subscribe to NIP-17 DMs (kind 1059 gift wraps) using raw WebSockets
     */
    private subscribeNip17(recipientPubkeys: string[]): void {
        // Only get events from NOW onwards to avoid replaying old commands
        const since = Math.floor(Date.now() / 1000);
        const filter = { kinds: [1059], '#p': recipientPubkeys, since };
        logger.debug('Subscribing to NIP-17 DMs', { since });

        // Connect to each admin relay via raw WebSocket
        for (const relay of this.config.adminRelays) {
            this.connectToRelayNip17(relay, filter);
        }
    }

    /**
     * Connect to a single relay and subscribe to NIP-17 gift wraps
     */
    private connectToRelayNip17(relay: string, filter: object): void {
        const ws = new WebSocket(relay);
        const subId = `killswitch-nip17-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const generation = this.subscriptionGeneration;

        ws.on('open', () => {
            if (generation !== this.subscriptionGeneration) {
                ws.close();
                return;
            }
            logger.debug('Kill switch connected to relay for NIP-17', { relay });
            this.onRelayConnected(relay);
            const req = JSON.stringify(['REQ', subId, filter]);
            ws.send(req);
        });

        ws.on('message', (data: Buffer) => {
            if (generation !== this.subscriptionGeneration) {
                ws.close();
                return;
            }

            const msg = data.toString();
            try {
                const parsed = JSON.parse(msg);
                if (parsed[0] === 'EVENT' && parsed[1] === subId) {
                    const event = parsed[2] as Event;

                    // Deduplicate
                    if (this.processedEventIds.has(event.id)) {
                        return;
                    }
                    this.processedEventIds.set(event.id, true);

                    this.handleNip17Event(event).catch((err) => {
                        logger.error('Error handling NIP-17 event', { error: toErrorMessage(err) });
                    });
                } else if (parsed[0] === 'EOSE' && parsed[1] === subId) {
                    logger.debug('Kill switch NIP-17 subscription active', { relay });
                }
            } catch {
                debug('Non-JSON message from %s', relay);
            }
        });

        ws.on('error', (err: Error) => {
            logger.error('Kill switch NIP-17 WebSocket error', { relay, error: err.message });
        });

        ws.on('close', () => {
            debug('NIP-17 WebSocket closed for %s', relay);
            if (this.isRunning && generation === this.subscriptionGeneration) {
                // Pass empty array for recipientPubkeys since NIP-17 doesn't need it
                this.scheduleReconnect(relay, filter, [], generation, 'nip17');
            }
        });

        this.websockets.push(ws);
    }

    /**
     * Handle NIP-04 DM event
     */
    private async handleNip04Event(event: Event): Promise<void> {
        // Verify sender is admin
        if (event.pubkey !== this.adminPubkey) {
            debug('Ignoring DM from non-admin: %s', event.pubkey);
            return;
        }

        // Find which key this DM was sent to
        const recipientPubkey = event.tags.find(t => t[0] === 'p')?.[1];
        if (!recipientPubkey) {
            debug('No recipient pubkey in DM');
            return;
        }

        // Find the nsec for this pubkey
        const nsec = this.findNsecForPubkey(recipientPubkey);
        if (!nsec) {
            debug('No active key for recipient %s', recipientPubkey);
            return;
        }

        // Decrypt the message
        try {
            const privkeyHex = this.nsecToHex(nsec);
            const decrypted = await nip04Decrypt(privkeyHex, event.pubkey, event.content);
            await this.processCommand(decrypted.trim().toLowerCase(), nsec, recipientPubkey);
        } catch (error) {
            debug('Failed to decrypt NIP-04 DM: %O', error);
        }
    }

    /**
     * Handle NIP-17 gift wrap event (kind 1059)
     */
    private async handleNip17Event(event: Event): Promise<void> {
        // Find which key this was sent to
        const recipientPubkey = event.tags.find(t => t[0] === 'p')?.[1];
        if (!recipientPubkey) {
            debug('No recipient pubkey in gift wrap');
            return;
        }

        // Find the nsec for this pubkey
        const nsec = this.findNsecForPubkey(recipientPubkey);
        if (!nsec) {
            debug('No active key for recipient %s', recipientPubkey);
            return;
        }

        try {
            // Unwrap the gift wrap using NIP-44
            const nsecBytes = this.nsecToBytes(nsec);
            const conversationKey = getConversationKey(nsecBytes, event.pubkey);
            const sealJson = nip44Decrypt(event.content, conversationKey);
            const seal = JSON.parse(sealJson) as Event;

            // Verify seal is kind 13 (sealed rumor)
            if (seal.kind !== 13) {
                debug('Inner event is not kind 13: %d', seal.kind);
                return;
            }

            // Decrypt the seal to get the rumor
            const sealConversationKey = getConversationKey(nsecBytes, seal.pubkey);
            const rumorJson = nip44Decrypt(seal.content, sealConversationKey);
            const rumor = JSON.parse(rumorJson) as Event;

            // Verify the rumor is from admin and is kind 14 (DM)
            if (rumor.pubkey !== this.adminPubkey) {
                debug('Rumor not from admin: %s', rumor.pubkey);
                return;
            }

            if (rumor.kind !== 14) {
                debug('Rumor is not kind 14: %d', rumor.kind);
                return;
            }

            await this.processCommand(rumor.content.trim().toLowerCase(), nsec, recipientPubkey);
        } catch (error) {
            debug('Failed to unwrap NIP-17 gift wrap: %O', error);
        }
    }

    /**
     * Process a command from the admin
     */
    private async processCommand(command: string, nsec: string, recipientPubkey: string): Promise<void> {
        logger.info('Kill switch received command', { command });

        let result: string;
        let changesState = true;

        switch (command as AdminCommand) {
            case 'panic':
            case 'lockall':
            case 'killswitch': {
                // Emergency: lock all keys AND suspend all apps
                const lockedKeys = this.keyService.lockAllKeys();
                // Get apps before suspending to log each one
                const apps = await this.appService.listApps();
                const activeApps = apps.filter(a => !a.suspendedAt);
                const suspendedApps = await this.appService.suspendAllApps();
                result = `🚨 PANIC: Locked ${lockedKeys.length} key(s), suspended ${suspendedApps} app(s)`;
                logger.warn('Kill switch PANIC executed', { lockedKeys: lockedKeys.length, suspendedApps });
                // Log admin events for each locked key
                for (const keyName of lockedKeys) {
                    await this.logAdminEvent('key_locked', { keyName });
                }
                // Log admin events for each suspended app
                for (const app of activeApps) {
                    await this.logAdminEvent('app_suspended', {
                        appId: app.id,
                        appName: app.description || app.userPubkey.slice(0, 8),
                    });
                }
                break;
            }

            case 'lockall keys': {
                const locked = this.keyService.lockAllKeys();
                result = locked.length > 0
                    ? `✓ Locked ${locked.length} key(s): ${locked.join(', ')}`
                    : '⚠ No keys to lock (all keys are either unencrypted or already locked)';
                logger.info('Kill switch locked all keys', { locked });
                // Log admin events for each locked key
                for (const keyName of locked) {
                    await this.logAdminEvent('key_locked', { keyName });
                }
                break;
            }

            case 'suspendall apps': {
                // Get apps before suspending to log each one
                const apps = await this.appService.listApps();
                const activeApps = apps.filter(a => !a.suspendedAt);
                const count = await this.appService.suspendAllApps();
                result = count > 0
                    ? `✓ Suspended ${count} app(s)`
                    : '⚠ No apps to suspend (all apps already suspended or none connected)';
                logger.info('Kill switch suspended all apps', { count });
                // Log admin events for each suspended app
                for (const app of activeApps) {
                    await this.logAdminEvent('app_suspended', {
                        appId: app.id,
                        appName: app.description || app.userPubkey.slice(0, 8),
                    });
                }
                break;
            }

            case 'resumeall apps': {
                const count = await this.resumeAllApps();
                result = count > 0
                    ? `✓ Resumed ${count} app(s)`
                    : '⚠ No apps to resume (no apps are suspended)';
                logger.info('Kill switch resumed all apps', { count });
                // Note: resumeAllApps doesn't return app details, so we log a generic event
                // Individual app resumes will be logged when done via resumeSingleApp
                break;
            }

            case 'status': {
                result = await this.getStatusReport();
                logger.debug('Kill switch status requested');
                await this.logAdminEvent('status_checked');
                changesState = false;
                break;
            }

            case 'alive': {
                // Reset dead man's switch timer
                result = await this.resetDeadManSwitch();
                logger.info('Kill switch reset dead man timer');
                changesState = false; // Timer reset doesn't change key/app state
                break;
            }

            default: {
                // Check for key-scoped app commands first
                if (command.startsWith('suspendall apps for ')) {
                    const keyName = command.slice(20); // Extract key name after "suspendall apps for "
                    result = await this.suspendAppsForKey(keyName);
                    logger.info('Kill switch suspend apps for key', { keyName, result });
                } else if (command.startsWith('resumeall apps for ')) {
                    const keyName = command.slice(19); // Extract key name after "resumeall apps for "
                    result = await this.resumeAppsForKey(keyName);
                    logger.info('Kill switch resume apps for key', { keyName, result });
                }
                // Check for single-item commands
                else if (command.startsWith('lock ')) {
                    const keyName = command.slice(5); // Extract key name after "lock "
                    const lockResult = this.lockSingleKey(keyName);
                    result = this.formatLockResult(lockResult);
                    logger.info('Kill switch lock key', { keyName, status: lockResult.status });
                    // Log admin event on successful lock
                    if (lockResult.status === 'locked') {
                        await this.logAdminEvent('key_locked', { keyName: lockResult.keyName });
                    } else {
                        // No state change for already_locked, not_found, not_encrypted
                        changesState = false;
                    }
                } else if (command.startsWith('suspend ')) {
                    const appName = command.slice(8); // Extract app name after "suspend "
                    result = await this.suspendSingleApp(appName);
                    logger.info('Kill switch suspend app', { appName, result });
                } else if (command.startsWith('resume ')) {
                    const appName = command.slice(7); // Extract app name after "resume "
                    result = await this.resumeSingleApp(appName);
                    logger.info('Kill switch resume app', { appName, result });
                } else {
                    result = `⚠ Unknown command: "${command}".\n\nValid commands:\n• panic (or lockall, killswitch) - emergency lock all\n• lockall keys\n• lock <keyname>\n• suspendall apps [for <keyname>]\n• suspend <appname>\n• resumeall apps [for <keyname>]\n• resume <appname>\n• alive - reset dead man's switch timer\n• status`;
                    logger.warn('Kill switch unknown command', { command });
                    changesState = false;
                }
            }
        }

        // Emit stats update if state changed
        if (changesState) {
            await emitCurrentStats();
        }

        // Log command execution for audit trail
        await this.logCommandExecution(command, result);

        // Send confirmation DM back to admin
        logger.debug('Sending kill switch confirmation', { resultPreview: result.slice(0, 50) });
        try {
            await this.sendConfirmation(result, nsec, recipientPubkey);
            logger.debug('Kill switch confirmation sent');
        } catch (error) {
            logger.error('Failed to send kill switch confirmation', { error: toErrorMessage(error) });
        }
    }

    /**
     * Attempt to lock a single key by name (case-sensitive)
     */
    private lockSingleKey(keyName: string): LockKeyResult {
        const activeKeys = this.getActiveKeySecrets();

        // Check if key exists in active keys
        if (!(keyName in activeKeys)) {
            // Check if key exists at all (might be locked or not exist)
            const allKeyNames = this.keyService.getActiveKeys();
            // We need to check allKeys, not activeKeys - but we don't have direct access
            // Instead, try to determine the state from KeyService
            if (!this.keyService.isKeyActive(keyName)) {
                // Key is not active - either doesn't exist, is locked, or is unencrypted but offline
                // We can try to lock it anyway and catch the error
                try {
                    this.keyService.lockKey(keyName);
                    return { status: 'locked', keyName };
                } catch (error) {
                    const message = toErrorMessage(error);
                    if (message === 'Key not found') {
                        return { status: 'not_found', keyName };
                    }
                    if (message === 'Key is not active') {
                        return { status: 'already_locked', keyName };
                    }
                    if (message === 'Cannot lock an unencrypted key') {
                        return { status: 'not_encrypted', keyName };
                    }
                    throw error;
                }
            }
        }

        // Key is active, try to lock it
        try {
            this.keyService.lockKey(keyName);
            return { status: 'locked', keyName };
        } catch (error) {
            const message = toErrorMessage(error);
            if (message === 'Cannot lock an unencrypted key') {
                return { status: 'not_encrypted', keyName };
            }
            throw error;
        }
    }

    /**
     * Format a lock result into a human-readable message
     */
    private formatLockResult(result: LockKeyResult): string {
        switch (result.status) {
            case 'locked':
                return `✓ Locked key '${result.keyName}'`;
            case 'not_found':
            case 'already_locked':
            case 'not_encrypted':
                // Generic message prevents key enumeration attacks
                return `⚠ Could not lock key '${result.keyName}'`;
        }
    }

    /**
     * Suspend a single app by name (description) or pubkey prefix
     */
    private async suspendSingleApp(appName: string): Promise<string> {
        const apps = await this.appService.listApps();
        const app = apps.find(a =>
            a.description?.toLowerCase() === appName.toLowerCase() ||
            a.userPubkey.toLowerCase().startsWith(appName.toLowerCase())
        );

        // Generic message prevents app enumeration attacks
        if (!app || app.suspendedAt) {
            return `⚠ Could not suspend app '${appName}'`;
        }

        try {
            await this.appService.suspendApp(app.id);
            // Log admin event
            await this.logAdminEvent('app_suspended', {
                appId: app.id,
                appName: app.description || app.userPubkey.slice(0, 8),
            });
            return `✓ Suspended app '${app.description || app.userPubkey.slice(0, 8)}'`;
        } catch (error) {
            // Generic message prevents revealing internal errors
            return `⚠ Could not suspend app '${appName}'`;
        }
    }

    /**
     * Resume a single app by name (description) or pubkey prefix
     */
    private async resumeSingleApp(appName: string): Promise<string> {
        const apps = await this.appService.listApps();
        const app = apps.find(a =>
            a.description?.toLowerCase() === appName.toLowerCase() ||
            a.userPubkey.toLowerCase().startsWith(appName.toLowerCase())
        );

        // Generic message prevents app enumeration attacks
        if (!app || !app.suspendedAt) {
            return `⚠ Could not resume app '${appName}'`;
        }

        try {
            await this.appService.unsuspendApp(app.id);
            // Log admin event
            await this.logAdminEvent('app_unsuspended', {
                appId: app.id,
                appName: app.description || app.userPubkey.slice(0, 8),
            });
            return `✓ Resumed app '${app.description || app.userPubkey.slice(0, 8)}'`;
        } catch (error) {
            // Generic message prevents revealing internal errors
            return `⚠ Could not resume app '${appName}'`;
        }
    }

    /**
     * Resume all suspended apps
     */
    private async resumeAllApps(): Promise<number> {
        const apps = await this.appService.listApps();
        const suspendedApps = apps.filter(a => a.suspendedAt);

        let count = 0;
        for (const app of suspendedApps) {
            try {
                await this.appService.unsuspendApp(app.id);
                // Log admin event for each resumed app
                await this.logAdminEvent('app_unsuspended', {
                    appId: app.id,
                    appName: app.description || app.userPubkey.slice(0, 8),
                });
                count++;
            } catch {
                // Continue with other apps
            }
        }

        return count;
    }

    /**
     * Suspend all apps for a specific key
     */
    private async suspendAppsForKey(keyName: string): Promise<string> {
        const apps = await this.appService.listApps();
        const keyApps = apps.filter(a =>
            a.keyName.toLowerCase() === keyName.toLowerCase() && !a.suspendedAt
        );

        if (keyApps.length === 0) {
            // Check if key exists at all
            const allKeyApps = apps.filter(a => a.keyName.toLowerCase() === keyName.toLowerCase());
            if (allKeyApps.length === 0) {
                return `⚠ No apps found for key '${keyName}'`;
            }
            return `⚠ No apps to suspend for key '${keyName}' (all already suspended)`;
        }

        let count = 0;
        for (const app of keyApps) {
            try {
                await this.appService.suspendApp(app.id);
                // Log admin event for each suspended app
                await this.logAdminEvent('app_suspended', {
                    appId: app.id,
                    appName: app.description || app.userPubkey.slice(0, 8),
                });
                count++;
            } catch {
                // Continue with other apps
            }
        }

        return `✓ Suspended ${count} app(s) for key '${keyName}'`;
    }

    /**
     * Resume all apps for a specific key
     */
    private async resumeAppsForKey(keyName: string): Promise<string> {
        const apps = await this.appService.listApps();
        const keyApps = apps.filter(a =>
            a.keyName.toLowerCase() === keyName.toLowerCase() && a.suspendedAt
        );

        if (keyApps.length === 0) {
            // Check if key exists at all
            const allKeyApps = apps.filter(a => a.keyName.toLowerCase() === keyName.toLowerCase());
            if (allKeyApps.length === 0) {
                return `⚠ No apps found for key '${keyName}'`;
            }
            return `⚠ No apps to resume for key '${keyName}' (none are suspended)`;
        }

        let count = 0;
        for (const app of keyApps) {
            try {
                await this.appService.unsuspendApp(app.id);
                // Log admin event for each resumed app
                await this.logAdminEvent('app_unsuspended', {
                    appId: app.id,
                    appName: app.description || app.userPubkey.slice(0, 8),
                });
                count++;
            } catch {
                // Continue with other apps
            }
        }

        return `✓ Resumed ${count} app(s) for key '${keyName}'`;
    }

    /**
     * Generate a status report showing keys and apps state
     */
    private async getStatusReport(): Promise<string> {
        const lines: string[] = ['📊 Signet Status'];

        // Keys status
        const activeKeys = this.getActiveKeySecrets();
        const activeKeyNames = Object.keys(activeKeys);

        // Get all key names from KeyService to find locked ones
        const allKeyInfo = await this.keyService.listKeys();
        const lockedKeyNames = allKeyInfo
            .filter(k => k.status === 'locked')
            .map(k => k.name);
        const offlineKeyNames = allKeyInfo
            .filter(k => k.status === 'offline')
            .map(k => k.name);

        lines.push('');
        lines.push('🔑 Keys:');
        if (activeKeyNames.length > 0) {
            lines.push(`  Active: ${activeKeyNames.join(', ')}`);
        } else {
            lines.push('  Active: none');
        }
        if (lockedKeyNames.length > 0) {
            lines.push(`  Locked: ${lockedKeyNames.join(', ')}`);
        }
        if (offlineKeyNames.length > 0) {
            lines.push(`  Offline: ${offlineKeyNames.join(', ')}`);
        }

        // Apps status
        const apps = await this.appService.listApps();
        const activeApps = apps.filter(a => !a.suspendedAt);
        const suspendedApps = apps.filter(a => a.suspendedAt);

        lines.push('');
        lines.push('📱 Apps:');
        lines.push(`  Active: ${activeApps.length}`);
        lines.push(`  Suspended: ${suspendedApps.length}`);

        if (suspendedApps.length > 0 && suspendedApps.length <= 5) {
            // Show names for small number of suspended apps
            const names = suspendedApps.map(a => a.description || a.userPubkey.slice(0, 8)).join(', ');
            lines.push(`  (${names})`);
        }

        return lines.join('\n');
    }

    /**
     * Reset the dead man's switch timer via DM command
     */
    private async resetDeadManSwitch(): Promise<string> {
        try {
            const dmsService = getDeadManSwitchService();
            const status = await dmsService.getStatus();

            if (!status.enabled) {
                return '⚠ Dead man\'s switch is not enabled';
            }

            if (status.panicTriggeredAt) {
                return '⚠ Panic already triggered. Visit dashboard to recover.';
            }

            await dmsService.resetViaDm();
            const newStatus = await dmsService.getStatus();

            const remaining = newStatus.remainingSec ?? 0;
            const days = Math.floor(remaining / (24 * 60 * 60));
            const hours = Math.floor((remaining % (24 * 60 * 60)) / (60 * 60));
            const timeStr = days > 0 ? `${days}d ${hours}h` : `${hours}h`;

            return `✓ Dead man's switch timer reset\nTime remaining: ${timeStr}`;
        } catch (error) {
            return `⚠ Failed to reset timer: ${toErrorMessage(error)}`;
        }
    }

    /**
     * Send a confirmation DM back to the admin
     */
    private async sendConfirmation(message: string, nsec: string, senderPubkey: string): Promise<void> {
        try {
            const nsecBytes = this.nsecToBytes(nsec);
            const privkeyHex = bytesToHex(nsecBytes);

            if (this.config.dmType === 'NIP04') {
                // Send NIP-04 DM
                logger.debug('Encrypting NIP-04 reply');
                const encrypted = await nip04Encrypt(privkeyHex, this.adminPubkey, message);
                const event = finalizeEvent({
                    kind: 4,
                    content: encrypted,
                    tags: [['p', this.adminPubkey]],
                    created_at: Math.floor(Date.now() / 1000),
                }, nsecBytes);

                logger.debug('Publishing reply', { relayCount: this.config.adminRelays.length });
                await this.publishEvent(event);
                logger.debug('Reply published');
            } else {
                // Send NIP-17 gift-wrapped DM
                await this.sendNip17Dm(message, nsecBytes, senderPubkey);
            }

            debug('Sent confirmation to admin');
        } catch (error) {
            logger.error('Failed to send confirmation', { error: toErrorMessage(error) });
            throw error; // Re-throw so caller can log too
        }
    }

    /**
     * Publish an event to all admin relays via raw WebSocket
     */
    private async publishEvent(event: Event): Promise<void> {
        // Track all resources for cleanup
        const websockets: WebSocket[] = [];
        const timeouts: NodeJS.Timeout[] = [];

        const cleanup = () => {
            // Clear all pending timeouts
            for (const timeout of timeouts) {
                clearTimeout(timeout);
            }
            // Close all websockets and remove listeners
            for (const ws of websockets) {
                try {
                    ws.removeAllListeners();
                    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
                        ws.close();
                    }
                } catch {
                    // Ignore close errors
                }
            }
        };

        const publishPromises = this.config.adminRelays.map(relay => {
            return new Promise<void>((resolve, reject) => {
                const ws = new WebSocket(relay);
                websockets.push(ws);

                const timeout = setTimeout(() => {
                    reject(new Error('Publish timeout'));
                }, 10000);
                timeouts.push(timeout);

                ws.on('open', () => {
                    ws.send(JSON.stringify(['EVENT', event]));
                });

                ws.on('message', (data: Buffer) => {
                    const msg = data.toString();
                    try {
                        const parsed = JSON.parse(msg);
                        if (parsed[0] === 'OK' && parsed[1] === event.id) {
                            if (parsed[2]) {
                                debug('Published to %s', relay);
                                resolve();
                            } else {
                                reject(new Error(parsed[3] || 'Publish rejected'));
                            }
                        }
                    } catch {
                        // Ignore parse errors
                    }
                });

                ws.on('error', (err: Error) => {
                    reject(err);
                });
            });
        });

        try {
            // Wait for at least one successful publish
            await Promise.any(publishPromises);
        } finally {
            // Always cleanup all resources, whether success or failure
            cleanup();
        }
    }

    /**
     * Send a NIP-17 gift-wrapped DM
     */
    private async sendNip17Dm(message: string, nsecBytes: Uint8Array, _senderPubkey: string): Promise<void> {
        // Create the rumor (kind 14, unsigned)
        const rumor = {
            kind: 14,
            content: message,
            tags: [['p', this.adminPubkey]],
            created_at: Math.floor(Date.now() / 1000),
            pubkey: bytesToHex(nsecBytes.slice(0, 32)), // This is wrong, need to derive pubkey
        };

        // For simplicity, we'll use the sender's pubkey from the original message
        // In a full implementation, we'd properly derive the pubkey
        const { getPublicKey } = await import('nostr-tools/pure');
        rumor.pubkey = getPublicKey(nsecBytes);

        // Create the seal (kind 13)
        const sealConversationKey = getConversationKey(nsecBytes, this.adminPubkey);
        const sealContent = nip44Encrypt(JSON.stringify(rumor), sealConversationKey);
        const seal = finalizeEvent({
            kind: 13,
            content: sealContent,
            tags: [],
            created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800), // Random time within 48h
        }, nsecBytes);

        // Create the gift wrap (kind 1059) using a random key
        const { generateSecretKey } = await import('nostr-tools/pure');
        const randomKey = generateSecretKey();
        const wrapConversationKey = getConversationKey(randomKey, this.adminPubkey);
        const wrapContent = nip44Encrypt(JSON.stringify(seal), wrapConversationKey);
        const giftWrap = finalizeEvent({
            kind: 1059,
            content: wrapContent,
            tags: [['p', this.adminPubkey]],
            created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 172800),
        }, randomKey);

        await this.publishEvent(giftWrap);
    }

    /**
     * Find the nsec for a given pubkey from active keys
     */
    private findNsecForPubkey(pubkey: string): string | null {
        const activeKeys = this.getActiveKeySecrets();
        for (const nsec of Object.values(activeKeys)) {
            try {
                if (this.getPubkeyFromNsec(nsec) === pubkey) {
                    return nsec;
                }
            } catch {
                continue;
            }
        }
        return null;
    }

    /**
     * Convert nsec to hex private key
     */
    private nsecToHex(nsec: string): string {
        const bytes = this.nsecToBytes(nsec);
        return bytesToHex(bytes);
    }

    /**
     * Convert nsec to bytes
     */
    private nsecToBytes(nsec: string): Uint8Array {
        if (nsec.startsWith('nsec1')) {
            const decoded = nip19Decode(nsec);
            if (decoded.type !== 'nsec') {
                throw new Error('Invalid nsec');
            }
            return decoded.data as Uint8Array;
        }
        return hexToBytes(nsec);
    }

    /**
     * Get pubkey from nsec
     */
    private getPubkeyFromNsec(nsec: string): string {
        const bytes = this.nsecToBytes(nsec);
        // Import dynamically to avoid circular dependencies
        const { getPublicKey } = require('nostr-tools/pure');
        return getPublicKey(bytes);
    }
}
