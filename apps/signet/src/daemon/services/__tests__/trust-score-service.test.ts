import { describe, it, expect, vi, afterEach } from 'vitest';
import { TrustScoreService } from '../trust-score-service.js';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
    return { ok, status, json: async () => body } as unknown as Response;
}

describe('TrustScoreService', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('fetches and caches a score, with trailing-slash-normalized lookups', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: { score: 85 } }));
        vi.stubGlobal('fetch', fetchMock);

        const svc = new TrustScoreService([]);
        const scores = await svc.getScoresForRelays(['wss://relay.example.com']);

        expect(scores.get('wss://relay.example.com')).toBe(85);
        // The cache key is normalized, so a trailing-slash variant resolves to the same score.
        expect(svc.getScore('wss://relay.example.com/')).toBe(85);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does NOT cache a null on a transient fetch error, so the next lookup retries', async () => {
        const fetchMock = vi.fn()
            .mockRejectedValueOnce(new Error('The operation timed out'))
            .mockResolvedValueOnce(jsonResponse({ success: true, data: { score: 90 } }));
        vi.stubGlobal('fetch', fetchMock);

        const svc = new TrustScoreService([]);

        // First attempt fails → null, but the failure must not be cached.
        expect((await svc.getScoresForRelays(['wss://r.example'])).get('wss://r.example')).toBeNull();
        // Second attempt retries (failure wasn't cached) and succeeds.
        expect((await svc.getScoresForRelays(['wss://r.example'])).get('wss://r.example')).toBe(90);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('caches null for a legitimately unrated relay so it is not refetched', async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: {} }));
        vi.stubGlobal('fetch', fetchMock);

        const svc = new TrustScoreService([]);
        expect((await svc.getScoresForRelays(['wss://r.example'])).get('wss://r.example')).toBeNull();
        // A cached null means no refetch on the next lookup (don't hammer the API for unrated relays).
        expect((await svc.getScoresForRelays(['wss://r.example'])).get('wss://r.example')).toBeNull();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
