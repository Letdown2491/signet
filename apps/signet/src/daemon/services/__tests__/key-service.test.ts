import { describe, it, expect, vi } from 'vitest';
import { generateSecretKey } from 'nostr-tools/pure';
import { nsecEncode } from 'nostr-tools/nip19';

// Prevent the DB / event-service / config graph from loading when we import KeyService.
vi.mock('../../repositories/index.js', () => ({ keyRepository: {}, appRepository: {} }));
vi.mock('../../../config/config.js', () => ({ loadConfig: vi.fn(), saveConfig: vi.fn() }));
vi.mock('../event-service.js', () => ({ getEventService: () => ({ emitKeyUnlocked: vi.fn() }) }));
vi.mock('../../lib/profile.js', () => ({ createSkeletonProfile: vi.fn() }));

import { KeyService } from '../key-service.js';
import { encryptSecret } from '../../../config/keyring.js';
import type { StoredKey } from '../../../config/types.js';

function serviceWithEncryptedKey(passphrase: string): KeyService {
    const nsec = nsecEncode(generateSecretKey());
    const { iv, data } = encryptSecret(nsec, passphrase);
    return new KeyService({
        configFile: '/tmp/does-not-exist.json',
        allKeys: { test: { iv, data } as unknown as StoredKey },
        nostrRelays: [],
    });
}

describe('KeyService.verifyPassphrase', () => {
    it('accepts the correct passphrase', () => {
        const svc = serviceWithEncryptedKey('correct horse battery');
        expect(() => svc.verifyPassphrase('test', 'correct horse battery')).not.toThrow();
    });

    it('reports a clear "Incorrect passphrase" rather than a low-level crypto error', () => {
        const svc = serviceWithEncryptedKey('correct horse battery');
        expect(() => svc.verifyPassphrase('test', 'wrong passphrase')).toThrowError('Incorrect passphrase');
    });

    it('throws "Key not found" for an unknown key', () => {
        const svc = serviceWithEncryptedKey('correct horse battery');
        expect(() => svc.verifyPassphrase('missing', 'whatever')).toThrowError('Key not found');
    });
});
