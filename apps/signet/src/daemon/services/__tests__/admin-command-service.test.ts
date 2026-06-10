import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateSecretKey, getPublicKey, finalizeEvent, type Event } from 'nostr-tools';
import { npubEncode } from 'nostr-tools/nip19';
import { encrypt as nip44Encrypt, getConversationKey } from 'nostr-tools/nip44';
import { bytesToHex } from '../../lib/hex.js';
import { AdminCommandService } from '../admin-command-service.js';

// Keys used across the suite
const adminSk = generateSecretKey();
const adminPk = getPublicKey(adminSk);
const signerSk = generateSecretKey();
const signerPk = getPublicKey(signerSk);

function makeService() {
    const service = new AdminCommandService({
        config: {
            adminNpub: npubEncode(adminPk),
            adminRelays: [],
            dmType: 'NIP17',
        },
        // Only findNsecForPubkey -> getActiveKeySecrets is exercised by the handlers.
        keyService: {} as never,
        appService: {} as never,
        getActiveKeySecrets: () => ({ test: bytesToHex(signerSk) }),
        daemonVersion: 'test',
    });
    // Stub the side-effecting command executor so we only assert the auth gate.
    const processCommand = vi.fn().mockResolvedValue(undefined);
    (service as unknown as { processCommand: unknown }).processCommand = processCommand;
    return { service, processCommand };
}

/**
 * Build a NIP-17 gift wrap (kind 1059) addressed to the signer.
 * - rumor: unsigned kind-14 DM authored by `rumorAuthorPk`
 * - seal: kind-13 signed by `sealSk` (the authentication anchor)
 * - wrap: kind-1059 signed by an ephemeral key
 */
function buildGiftWrap(opts: {
    sealSk: Uint8Array;
    rumorAuthorPk: string;
    command: string;
    rumorCreatedAt?: number;
}): Event {
    const sealPk = getPublicKey(opts.sealSk);
    const now = Math.floor(Date.now() / 1000);

    const rumor = {
        kind: 14,
        pubkey: opts.rumorAuthorPk,
        created_at: opts.rumorCreatedAt ?? now,
        tags: [['p', signerPk]],
        content: opts.command,
    };

    const sealConvKey = getConversationKey(opts.sealSk, signerPk);
    const seal = finalizeEvent(
        {
            kind: 13,
            created_at: now,
            tags: [],
            content: nip44Encrypt(JSON.stringify(rumor), sealConvKey),
        },
        opts.sealSk,
    );

    const ephemeralSk = generateSecretKey();
    const wrapConvKey = getConversationKey(ephemeralSk, signerPk);
    return finalizeEvent(
        {
            kind: 1059,
            created_at: now,
            tags: [['p', signerPk]],
            content: nip44Encrypt(JSON.stringify(seal), wrapConvKey),
        },
        ephemeralSk,
    );
}

describe('AdminCommandService NIP-17 authentication', () => {
    let service: AdminCommandService;
    let processCommand: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        ({ service, processCommand } = makeService());
    });

    const handle = (event: Event) =>
        (service as unknown as { handleNip17Event: (e: Event) => Promise<void> }).handleNip17Event(event);

    it('accepts a genuine command sealed by the admin', async () => {
        const wrap = buildGiftWrap({ sealSk: adminSk, rumorAuthorPk: adminPk, command: 'status' });
        await handle(wrap);
        expect(processCommand).toHaveBeenCalledTimes(1);
        expect(processCommand).toHaveBeenCalledWith('status', expect.any(String), signerPk);
    });

    it('rejects a forged command: seal signed by a non-admin key with an admin-claiming rumor', async () => {
        // The core attack: NIP-44 conversation keys are symmetric, so an attacker
        // can encrypt a valid-decrypting seal/rumor using only public values and set
        // the unsigned rumor.pubkey to the admin. The seal signature must be checked.
        const attackerSk = generateSecretKey();
        const wrap = buildGiftWrap({ sealSk: attackerSk, rumorAuthorPk: adminPk, command: 'panic' });
        await handle(wrap);
        expect(processCommand).not.toHaveBeenCalled();
    });

    it('rejects a stale (replayed) command outside the freshness window', async () => {
        const old = Math.floor(Date.now() / 1000) - 3600; // 1h ago
        const wrap = buildGiftWrap({
            sealSk: adminSk,
            rumorAuthorPk: adminPk,
            command: 'alive',
            rumorCreatedAt: old,
        });
        await handle(wrap);
        expect(processCommand).not.toHaveBeenCalled();
    });
});

describe('AdminCommandService NIP-04 authentication', () => {
    const handleNip04 = (service: AdminCommandService, event: Event) =>
        (service as unknown as { handleNip04Event: (e: Event) => Promise<void> }).handleNip04Event(event);

    it('rejects a stale (replayed) NIP-04 command', async () => {
        const { service, processCommand } = makeService();
        // A genuine, admin-signed kind-4 event but with an old timestamp.
        const old = Math.floor(Date.now() / 1000) - 3600;
        const event = finalizeEvent(
            { kind: 4, created_at: old, tags: [['p', signerPk]], content: 'ciphertext' },
            adminSk,
        );
        await handleNip04(service, event);
        expect(processCommand).not.toHaveBeenCalled();
    });
});

describe('AdminCommandService websocket pruning', () => {
    // Each reconnect opens a new WebSocket; without pruning on close, the tracking
    // array would grow for the life of the process (unbounded for a persistently
    // unreachable relay, since reconnects retry indefinitely).
    type PrunableService = {
        websockets: Array<{ removeAllListeners: () => void }>;
        pruneWebsocket: (ws: { removeAllListeners: () => void }) => void;
    };

    it('removes a closed socket from the tracking array and drops its listeners', () => {
        const { service } = makeService();
        const svc = service as unknown as PrunableService;
        const wsA = { removeAllListeners: vi.fn() };
        const wsB = { removeAllListeners: vi.fn() };
        svc.websockets.push(wsA, wsB);

        svc.pruneWebsocket(wsA);

        expect(svc.websockets).toEqual([wsB]);
        expect(wsA.removeAllListeners).toHaveBeenCalledTimes(1);
    });

    it('drops listeners even for a socket already gone from the array', () => {
        const { service } = makeService();
        const svc = service as unknown as PrunableService;
        const orphan = { removeAllListeners: vi.fn() };

        svc.pruneWebsocket(orphan);

        expect(svc.websockets).toEqual([]);
        expect(orphan.removeAllListeners).toHaveBeenCalledTimes(1);
    });
});
