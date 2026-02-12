import createDebug from 'debug';
import { toErrorMessage } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { settingsRepository } from '../repositories/index.js';
import { adminLogRepository, type AdminEventType } from '../repositories/admin-log-repository.js';
import { getEventService, emitCurrentStats, type DeadManSwitchStatus } from './event-service.js';
import type { KeyService } from './key-service.js';
import type { AppService } from './app-service.js';

const debug = createDebug('signet:deadman');

// How often to check the timer (1 minute)
const CHECK_INTERVAL_MS = 60 * 1000;

// Default timeframe (7 days)
const DEFAULT_TIMEFRAME_SEC = 7 * 24 * 60 * 60;

// Warning thresholds (in seconds) - only sent if admin DM is configured
const WARNING_THRESHOLDS_SEC = [
    7 * 24 * 60 * 60,  // 7 days
    24 * 60 * 60,      // 24 hours
    6 * 60 * 60,       // 6 hours
    60 * 60,           // 1 hour
    15 * 60,           // 15 minutes
    2 * 60,            // 2 minutes
];

// Rate limiting for passphrase attempts
const MAX_ATTEMPTS_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Setting keys
const SETTING_ENABLED = 'deadManSwitch.enabled';
const SETTING_TIMEFRAME = 'deadManSwitch.timeframeSec';
const SETTING_LAST_RESET = 'deadManSwitch.lastResetAt';
const SETTING_PANIC_AT = 'deadManSwitch.panicTriggeredAt';
const SETTING_WARNINGS_SENT = 'deadManSwitch.warningsSent';

interface RateLimitEntry {
    attempts: number;
    firstAttemptAt: number;
}

export interface DeadManSwitchServiceConfig {
    keyService: KeyService;
    appService: AppService;
    sendWarningDm?: (message: string) => Promise<void>;
    daemonVersion: string;
}

/**
 * Dead Man's Switch Service
 *
 * Manages a countdown timer that triggers panic (lock all keys + suspend all apps)
 * if not periodically reset. Useful for protection against lost access, device theft,
 * or coercion scenarios.
 */
export class DeadManSwitchService {
    private readonly keyService: KeyService;
    private readonly appService: AppService;
    private readonly sendWarningDm?: (message: string) => Promise<void>;
    private readonly daemonVersion: string;

    private checkTimer?: NodeJS.Timeout;
    private isRunning = false;
    // Rate limiting for passphrase attempts
    // Note: Using Map instead of TTLCache because the rate limit window must be
    // measured from firstAttemptAt (first attempt), not refreshed on each attempt.
    // This is security-sensitive - TTLCache would allow indefinite attempts if spaced out.
    private rateLimitMap = new Map<string, RateLimitEntry>();

    constructor(config: DeadManSwitchServiceConfig) {
        this.keyService = config.keyService;
        this.appService = config.appService;
        this.sendWarningDm = config.sendWarningDm;
        this.daemonVersion = config.daemonVersion;
    }

    /**
     * Start the dead man's switch timer loop.
     * Should be called when the daemon starts.
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            debug('already running, ignoring start()');
            return;
        }

        this.isRunning = true;

        // Check if enabled
        const enabled = await this.isEnabled();
        if (enabled) {
            logger.info('Dead man switch timer active');
        } else {
            logger.info('Dead man switch disabled, monitoring for enable');
        }

        // Start the check loop
        this.checkTimer = setInterval(() => {
            this.runCheck().catch(err => {
                logger.error('Dead man switch check error', { error: toErrorMessage(err) });
            });
        }, CHECK_INTERVAL_MS);

        debug('started');
    }

    /**
     * Stop the dead man's switch timer loop.
     */
    stop(): void {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = undefined;
        }

        debug('stopped');
    }

    /**
     * Get current status of the dead man's switch.
     */
    async getStatus(): Promise<DeadManSwitchStatus> {
        const [enabledStr, timeframeStr, lastResetStr, panicAtStr] = await Promise.all([
            settingsRepository.get(SETTING_ENABLED),
            settingsRepository.get(SETTING_TIMEFRAME),
            settingsRepository.get(SETTING_LAST_RESET),
            settingsRepository.get(SETTING_PANIC_AT),
        ]);

        const enabled = enabledStr === 'true';
        const timeframeSec = timeframeStr ? parseInt(timeframeStr, 10) : DEFAULT_TIMEFRAME_SEC;
        const lastResetAt = lastResetStr ? parseInt(lastResetStr, 10) : null;
        const panicTriggeredAt = panicAtStr ? parseInt(panicAtStr, 10) : null;

        let remainingSec: number | null = null;
        if (enabled && lastResetAt && !panicTriggeredAt) {
            const elapsed = Math.floor(Date.now() / 1000) - lastResetAt;
            remainingSec = Math.max(0, timeframeSec - elapsed);
        }

        return {
            enabled,
            timeframeSec,
            lastResetAt,
            remainingSec,
            panicTriggeredAt,
        };
    }

    /**
     * Check if the dead man's switch is enabled.
     */
    async isEnabled(): Promise<boolean> {
        const value = await settingsRepository.get(SETTING_ENABLED);
        return value === 'true';
    }

    /**
     * Enable the dead man's switch.
     * Requires at least one encrypted key to exist.
     */
    async enable(timeframeSec?: number): Promise<void> {
        // Check prerequisite: at least one encrypted key
        if (!this.hasEncryptedKey()) {
            throw new Error('At least one encrypted key is required to enable the dead man\'s switch');
        }

        const timeframe = timeframeSec ?? DEFAULT_TIMEFRAME_SEC;
        const now = Math.floor(Date.now() / 1000);

        await Promise.all([
            settingsRepository.set(SETTING_ENABLED, 'true'),
            settingsRepository.set(SETTING_TIMEFRAME, timeframe.toString()),
            settingsRepository.set(SETTING_LAST_RESET, now.toString()),
            settingsRepository.delete(SETTING_PANIC_AT), // Clear any previous panic
            settingsRepository.set(SETTING_WARNINGS_SENT, '[]'),
        ]);

        logger.info('Dead man switch enabled', { timeframeHours: Math.floor(timeframe / 3600) });

        // Emit status update
        const status = await this.getStatus();
        getEventService().emitDeadmanUpdated(status);
    }

    /**
     * Disable the dead man's switch.
     * Requires passphrase verification.
     */
    async disable(keyName: string, passphrase: string): Promise<void> {
        // Verify passphrase (also handles rate limiting)
        this.verifyPassphrase(keyName, passphrase);

        await Promise.all([
            settingsRepository.set(SETTING_ENABLED, 'false'),
            settingsRepository.delete(SETTING_LAST_RESET),
            settingsRepository.delete(SETTING_PANIC_AT),
            settingsRepository.set(SETTING_WARNINGS_SENT, '[]'),
        ]);

        logger.info('Dead man switch disabled');

        // Emit status update
        const status = await this.getStatus();
        getEventService().emitDeadmanUpdated(status);
    }

    /**
     * Update the timeframe.
     * Requires passphrase verification.
     * Also resets the countdown timer to start from now.
     */
    async updateTimeframe(keyName: string, passphrase: string, timeframeSec: number): Promise<void> {
        // Verify passphrase
        this.verifyPassphrase(keyName, passphrase);

        const now = Math.floor(Date.now() / 1000);

        await Promise.all([
            settingsRepository.set(SETTING_TIMEFRAME, timeframeSec.toString()),
            settingsRepository.set(SETTING_LAST_RESET, now.toString()),
            settingsRepository.set(SETTING_WARNINGS_SENT, '[]'),
        ]);

        logger.info('Dead man switch timeframe updated', { timeframeHours: Math.floor(timeframeSec / 3600) });

        // Emit status update
        const status = await this.getStatus();
        getEventService().emitDeadmanUpdated(status);
    }

    /**
     * Reset the timer.
     * Requires passphrase verification.
     */
    async reset(keyName: string, passphrase: string): Promise<DeadManSwitchStatus> {
        // Verify passphrase
        this.verifyPassphrase(keyName, passphrase);

        return this.doReset('manual');
    }

    /**
     * Reset the timer via DM command (no passphrase needed - implicit auth via admin npub).
     */
    async resetViaDm(): Promise<DeadManSwitchStatus> {
        return this.doReset('dm');
    }

    /**
     * Internal reset logic.
     */
    private async doReset(source: string): Promise<DeadManSwitchStatus> {
        const now = Math.floor(Date.now() / 1000);

        await Promise.all([
            settingsRepository.set(SETTING_LAST_RESET, now.toString()),
            settingsRepository.delete(SETTING_PANIC_AT), // Clear panic state if recovering
            settingsRepository.set(SETTING_WARNINGS_SENT, '[]'),
        ]);

        logger.info('Dead man switch timer reset', { source });

        const status = await this.getStatus();
        getEventService().emitDeadmanReset(status);

        return status;
    }

    /**
     * Test the panic functionality (for testing without waiting).
     * Requires passphrase verification.
     */
    async testPanic(keyName: string, passphrase: string): Promise<void> {
        // Verify passphrase
        this.verifyPassphrase(keyName, passphrase);

        logger.warn('Dead man switch test panic triggered');
        await this.triggerPanic();
    }

    /**
     * Get remaining passphrase attempts before rate limit.
     */
    getRemainingAttempts(identifier: string = 'default'): number {
        this.cleanupRateLimitEntries();
        const entry = this.rateLimitMap.get(identifier);
        if (!entry) {
            return MAX_ATTEMPTS_PER_HOUR;
        }
        return Math.max(0, MAX_ATTEMPTS_PER_HOUR - entry.attempts);
    }

    /**
     * Check if rate limited.
     */
    isRateLimited(identifier: string = 'default'): boolean {
        return this.getRemainingAttempts(identifier) === 0;
    }

    /**
     * Run the periodic check.
     */
    private async runCheck(): Promise<void> {
        const enabled = await this.isEnabled();
        if (!enabled) {
            return;
        }

        const status = await this.getStatus();

        // Already panicked
        if (status.panicTriggeredAt) {
            return;
        }

        // Check if timer expired
        if (status.remainingSec !== null && status.remainingSec <= 0) {
            logger.warn('Dead man switch timer expired, triggering panic');
            await this.triggerPanic();
            return;
        }

        // Check for warnings
        if (status.remainingSec !== null && this.sendWarningDm) {
            await this.checkWarnings(status.remainingSec, status.timeframeSec);
        }
    }

    /**
     * Check and send warning notifications.
     */
    private async checkWarnings(remainingSec: number, timeframeSec: number): Promise<void> {
        const warningsSentStr = await settingsRepository.get(SETTING_WARNINGS_SENT);
        const warningsSent: string[] = warningsSentStr ? JSON.parse(warningsSentStr) : [];

        for (const threshold of WARNING_THRESHOLDS_SEC) {
            // Skip thresholds larger than timeframe
            if (threshold > timeframeSec) {
                continue;
            }

            const thresholdKey = this.formatDuration(threshold);

            // Skip if already sent
            if (warningsSent.includes(thresholdKey)) {
                continue;
            }

            // Check if we've crossed this threshold
            if (remainingSec <= threshold) {
                const message = this.formatWarningMessage(remainingSec);

                try {
                    await this.sendWarningDm!(message);
                    warningsSent.push(thresholdKey);
                    await settingsRepository.set(SETTING_WARNINGS_SENT, JSON.stringify(warningsSent));
                    logger.info('Dead man switch warning sent', { threshold: thresholdKey });
                } catch (error) {
                    logger.error('Failed to send dead man switch warning', { error: toErrorMessage(error) });
                }

                // Only send one warning per check
                break;
            }
        }
    }

    /**
     * Trigger panic: lock all keys and suspend all apps.
     */
    private async triggerPanic(): Promise<void> {
        const now = Math.floor(Date.now() / 1000);

        // 1. Lock all keys
        const lockedKeys = this.keyService.lockAllKeys();

        // 2. Suspend all apps
        const suspendedApps = await this.appService.suspendAllApps();

        // 3. Record panic timestamp
        await settingsRepository.set(SETTING_PANIC_AT, now.toString());

        // 4. Log admin event
        await adminLogRepository.create({
            eventType: 'panic_triggered' as AdminEventType,
            clientName: 'dead-man-switch',
            clientVersion: this.daemonVersion,
        });

        // 5. Send notification DM (if configured)
        if (this.sendWarningDm) {
            try {
                await this.sendWarningDm(
                    `🚨 PANIC TRIGGERED\n\n` +
                    `Dead man's switch timer expired.\n` +
                    `Locked ${lockedKeys.length} key(s), suspended ${suspendedApps} app(s).\n\n` +
                    `Visit your Signet dashboard to recover.`
                );
            } catch (error) {
                logger.error('Failed to send panic notification', { error: toErrorMessage(error) });
            }
        }

        // 6. Emit SSE event
        const status = await this.getStatus();
        getEventService().emitDeadmanPanic(status);

        // 7. Emit stats update
        await emitCurrentStats();

        logger.warn('Dead man switch PANIC executed', { lockedKeys: lockedKeys.length, suspendedApps });
    }

    /**
     * Verify passphrase for a key.
     * Handles rate limiting.
     * Works for both active and locked encrypted keys.
     */
    private verifyPassphrase(keyName: string, passphrase: string): void {
        const identifier = 'passphrase'; // Use single identifier for all passphrase attempts

        // Check rate limit
        if (this.isRateLimited(identifier)) {
            const remaining = this.getTimeUntilRateLimitReset(identifier);
            throw new Error(`Too many failed attempts. Try again in ${Math.ceil(remaining / 60000)} minutes.`);
        }

        try {
            // Verify passphrase against the stored encrypted key material
            // This works regardless of whether the key is active or locked
            this.keyService.verifyPassphrase(keyName, passphrase);

            // Passphrase is correct - reset rate limit counter
            this.rateLimitMap.delete(identifier);
        } catch (error) {
            const message = toErrorMessage(error);

            // Don't count "Key not found" or "Key is not encrypted" as failed attempts
            if (message.includes('Key not found') || message.includes('Key is not encrypted')) {
                throw error;
            }

            // Record failed attempt
            this.recordFailedAttempt(identifier);

            const remaining = this.getRemainingAttempts(identifier);
            if (remaining === 0) {
                throw new Error('Too many failed attempts. Try again in 1 hour.');
            }

            throw new Error(`Invalid passphrase (${remaining} attempts remaining)`);
        }
    }

    /**
     * Check if at least one encrypted key exists.
     */
    private hasEncryptedKey(): boolean {
        const stats = this.keyService.getKeyStats();
        return stats.locked > 0 || stats.active > 0; // Active encrypted keys count too
    }

    /**
     * Record a failed passphrase attempt for rate limiting.
     */
    private recordFailedAttempt(identifier: string): void {
        const now = Date.now();
        const entry = this.rateLimitMap.get(identifier);

        if (entry && (now - entry.firstAttemptAt) < RATE_LIMIT_WINDOW_MS) {
            entry.attempts++;
        } else {
            this.rateLimitMap.set(identifier, { attempts: 1, firstAttemptAt: now });
        }
    }

    /**
     * Get time until rate limit resets.
     */
    private getTimeUntilRateLimitReset(identifier: string): number {
        const entry = this.rateLimitMap.get(identifier);
        if (!entry) {
            return 0;
        }
        const elapsed = Date.now() - entry.firstAttemptAt;
        return Math.max(0, RATE_LIMIT_WINDOW_MS - elapsed);
    }

    /**
     * Clean up expired rate limit entries.
     */
    private cleanupRateLimitEntries(): void {
        const now = Date.now();
        for (const [key, entry] of this.rateLimitMap) {
            if (now - entry.firstAttemptAt >= RATE_LIMIT_WINDOW_MS) {
                this.rateLimitMap.delete(key);
            }
        }
    }

    /**
     * Format a duration in seconds to human-readable string.
     */
    private formatDuration(seconds: number): string {
        if (seconds >= 24 * 60 * 60) {
            const days = Math.floor(seconds / (24 * 60 * 60));
            return `${days}d`;
        }
        if (seconds >= 60 * 60) {
            const hours = Math.floor(seconds / (60 * 60));
            return `${hours}h`;
        }
        if (seconds >= 60) {
            const minutes = Math.floor(seconds / 60);
            return `${minutes}m`;
        }
        return `${seconds}s`;
    }

    /**
     * Format a warning message.
     */
    private formatWarningMessage(remainingSec: number): string {
        const timeStr = this.formatDuration(remainingSec);
        return (
            `⚠️ Signet Dead Man's Switch Warning\n\n` +
            `Time remaining: ${timeStr}\n\n` +
            `Reset with: alive\n` +
            `Or visit your Signet dashboard.`
        );
    }
}

// Singleton instance
let deadManSwitchServiceInstance: DeadManSwitchService | null = null;

export function getDeadManSwitchService(): DeadManSwitchService {
    if (!deadManSwitchServiceInstance) {
        throw new Error('DeadManSwitchService not initialized');
    }
    return deadManSwitchServiceInstance;
}

export function setDeadManSwitchService(service: DeadManSwitchService): void {
    deadManSwitchServiceInstance = service;
}

export function initDeadManSwitchService(config: DeadManSwitchServiceConfig): DeadManSwitchService {
    deadManSwitchServiceInstance = new DeadManSwitchService(config);
    return deadManSwitchServiceInstance;
}
