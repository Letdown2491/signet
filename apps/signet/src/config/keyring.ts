import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;

function deriveKey(passphrase: string, salt: Buffer): Buffer {
    return crypto.pbkdf2Sync(passphrase, salt, 100000, KEY_LENGTH, 'sha256');
}

export function encryptSecret(secret: string, passphrase: string): { iv: string; data: string } {
    const salt = crypto.randomBytes(16);
    const key = deriveKey(passphrase, salt);
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(secret, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // Store salt + encrypted data together
    const combined = Buffer.concat([salt, Buffer.from(encrypted, 'hex')]);

    return {
        iv: iv.toString('hex'),
        data: combined.toString('hex'),
    };
}

export function decryptSecret(encrypted: { iv: string; data: string }, passphrase: string): string {
    const iv = Buffer.from(encrypted.iv, 'hex');
    const combined = Buffer.from(encrypted.data, 'hex');

    // Extract salt and encrypted data
    const salt = combined.subarray(0, 16);
    const encryptedData = combined.subarray(16);

    const key = deriveKey(passphrase, salt);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedData.toString('hex'), 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
}
