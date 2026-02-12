import { logger } from '../lib/logger.js';
import { toErrorMessage } from '../lib/errors.js';

const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const API_BASE_URL = 'https://trustedrelays.xyz/api/score';

/**
 * Normalize a relay URL for consistent cache keys and API lookups.
 * Strips trailing slashes since trustedrelays.xyz expects URLs without them.
 */
function normalizeRelayUrl(url: string): string {
    return url.replace(/\/+$/, '');
}

/**
 * Fetches and caches trust scores for relays from trustedrelays.xyz.
 * Scores are fetched on startup and refreshed hourly.
 */
export class TrustScoreService {
    private scores = new Map<string, number | null>();
    private refreshTimer?: NodeJS.Timeout;
    private isRunning = false;
    private readonly relayUrls: string[];

    constructor(relayUrls: string[]) {
        this.relayUrls = relayUrls;
    }

    /**
     * Start the service - fetches scores immediately and schedules hourly refresh
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;
        logger.info('Trust score service started');

        // Fetch scores immediately
        await this.fetchAllScores();

        // Schedule periodic refresh
        this.refreshTimer = setInterval(() => {
            this.fetchAllScores().catch(err => {
                logger.error('Failed to refresh trust scores', { error: toErrorMessage(err) });
            });
        }, REFRESH_INTERVAL_MS);
    }

    /**
     * Stop the service
     */
    public stop(): void {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;

        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = undefined;
        }

        logger.info('Trust score service stopped');
    }

    /**
     * Get the trust score for a relay URL
     * @returns Score (0-100) or null if unavailable
     */
    public getScore(url: string): number | null {
        return this.scores.get(normalizeRelayUrl(url)) ?? null;
    }

    /**
     * Get trust scores for multiple relay URLs, fetching any that aren't cached.
     * Used for on-demand fetching (e.g., nostrconnect app relays).
     * @returns Map of normalized relay URL to score (or null if unavailable)
     */
    public async getScoresForRelays(urls: string[]): Promise<Map<string, number | null>> {
        // Normalize all URLs for consistent cache keys
        const normalizedUrls = urls.map(normalizeRelayUrl);

        // Find which URLs need to be fetched
        const needsFetch = normalizedUrls.filter(url => !this.scores.has(url));

        // Fetch missing scores in parallel
        if (needsFetch.length > 0) {
            await Promise.allSettled(
                needsFetch.map(url => this.fetchScore(url))
            );
        }

        // Build result map with normalized URLs as keys
        const result = new Map<string, number | null>();
        for (const url of normalizedUrls) {
            result.set(url, this.scores.get(url) ?? null);
        }
        return result;
    }

    /**
     * Fetch scores for all configured relays
     */
    private async fetchAllScores(): Promise<void> {
        const results = await Promise.allSettled(
            this.relayUrls.map(url => this.fetchScore(url))
        );

        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        logger.info('Trust scores fetched', {
            successful,
            failed,
            total: this.relayUrls.length
        });
    }

    /**
     * Fetch trust score for a single relay
     */
    private async fetchScore(relayUrl: string): Promise<void> {
        // Normalize URL for consistent API queries and cache keys
        const normalizedUrl = normalizeRelayUrl(relayUrl);

        try {
            const apiUrl = `${API_BASE_URL}?url=${encodeURIComponent(normalizedUrl)}`;
            const response = await fetch(apiUrl, {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(10000) // 10 second timeout
            });

            if (!response.ok) {
                logger.debug('Trust score API returned error', {
                    relay: normalizedUrl,
                    status: response.status
                });
                this.scores.set(normalizedUrl, null);
                return;
            }

            const json = await response.json() as { success?: boolean; data?: { score?: number } };
            const score = typeof json.data?.score === 'number' ? json.data.score : null;
            this.scores.set(normalizedUrl, score);

            if (score !== null) {
                logger.debug('Trust score fetched', { relay: normalizedUrl, score });
            }
        } catch (err) {
            logger.debug('Failed to fetch trust score', {
                relay: normalizedUrl,
                error: toErrorMessage(err)
            });
            this.scores.set(normalizedUrl, null);
        }
    }
}
