import { describe, it, expect } from 'vitest';
import { encryptNip49, decryptNip49, isNcryptsec } from './nip49.js';

describe('NIP-49', () => {
    // Test vector from NIP-49 spec
    // https://github.com/nostr-protocol/nips/blob/master/49.md
    const specTestVector = {
        ncryptsec: 'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p',
        password: 'nostr',
        expectedHex: '3501454135014541350145413501453fefb02227e449e57cf4d3a3ce05378683',
    };

    describe('decryptNip49', () => {
        it('should decrypt the spec test vector correctly', () => {
            const result = decryptNip49(specTestVector.ncryptsec, specTestVector.password);
            expect(result).toBe(specTestVector.expectedHex);
        });

        it('should throw on wrong password', () => {
            expect(() => {
                decryptNip49(specTestVector.ncryptsec, 'wrong-password');
            }).toThrow();
        });

        it('should throw on invalid ncryptsec format', () => {
            expect(() => {
                decryptNip49('invalid-string', 'nostr');
            }).toThrow();
        });
    });

    describe('encryptNip49', () => {
        it('should encrypt and decrypt round-trip correctly', () => {
            const secretHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
            const password = 'test-password';

            const ncryptsec = encryptNip49(secretHex, password);

            // Verify it's a valid ncryptsec
            expect(ncryptsec.startsWith('ncryptsec1')).toBe(true);

            // Decrypt and verify we get the same secret back
            const decrypted = decryptNip49(ncryptsec, password);
            expect(decrypted).toBe(secretHex);
        });

        it('should produce different ciphertexts for same input (random nonce)', () => {
            const secretHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
            const password = 'test-password';

            const ncryptsec1 = encryptNip49(secretHex, password);
            const ncryptsec2 = encryptNip49(secretHex, password);

            // Should be different due to random nonce
            expect(ncryptsec1).not.toBe(ncryptsec2);

            // But both should decrypt to the same value
            expect(decryptNip49(ncryptsec1, password)).toBe(secretHex);
            expect(decryptNip49(ncryptsec2, password)).toBe(secretHex);
        });
    });

    describe('isNcryptsec', () => {
        it('should return true for valid ncryptsec', () => {
            expect(isNcryptsec(specTestVector.ncryptsec)).toBe(true);
        });

        it('should return false for nsec', () => {
            expect(isNcryptsec('nsec1abc123')).toBe(false);
        });

        it('should return false for random strings', () => {
            expect(isNcryptsec('hello world')).toBe(false);
            expect(isNcryptsec('')).toBe(false);
            expect(isNcryptsec('ncryptsec')).toBe(false);
        });

        it('should return false for npub', () => {
            expect(isNcryptsec('npub1abc123')).toBe(false);
        });
    });
});
