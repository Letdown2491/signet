import { encrypt, decrypt } from 'nostr-tools/nip49';
import { hexToBytes, bytesToHex } from 'nostr-tools/utils';

/**
 * NIP-49 encryption parameters
 * LOG_N=16 is the ecosystem standard (Amber, nsec.app) - 64 MiB memory, ~100ms
 * KEY_SECURITY_BYTE=0x02 means "client does not track" - Signet doesn't know if key was used elsewhere
 */
const LOG_N = 16;
const KEY_SECURITY_BYTE = 0x02;

/**
 * Encrypt a secret key using NIP-49 (XChaCha20-Poly1305 + scrypt)
 * @param secretHex - The secret key as a hex string
 * @param password - The password to encrypt with (will be NFKC normalized by nostr-tools)
 * @returns The encrypted key as an ncryptsec bech32 string
 */
export function encryptNip49(secretHex: string, password: string): string {
    return encrypt(hexToBytes(secretHex), password, LOG_N, KEY_SECURITY_BYTE);
}

/**
 * Decrypt an ncryptsec string using NIP-49
 * @param ncryptsec - The encrypted key as an ncryptsec bech32 string
 * @param password - The password to decrypt with (will be NFKC normalized by nostr-tools)
 * @returns The decrypted secret key as a hex string
 * @throws Error if password is wrong or ncryptsec is malformed
 */
export function decryptNip49(ncryptsec: string, password: string): string {
    return bytesToHex(decrypt(ncryptsec, password));
}

/**
 * Check if a string is an ncryptsec (NIP-49 encrypted key)
 */
export function isNcryptsec(value: string): boolean {
    return value.startsWith('ncryptsec1');
}
