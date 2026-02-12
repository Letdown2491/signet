import { describe, it, expect } from 'vitest';
import {
    validateKeyName,
    validateAppName,
    validatePassphrase,
    validateUri,
    validateRelays,
    sanitizeString,
} from '../validation.js';

describe('validateKeyName', () => {
    it('should accept valid key names', () => {
        expect(validateKeyName('my-key')).toEqual({ valid: true });
        expect(validateKeyName('myKey123')).toEqual({ valid: true });
        expect(validateKeyName('key_name')).toEqual({ valid: true });
        expect(validateKeyName('KEY')).toEqual({ valid: true });
    });

    it('should reject empty key names', () => {
        expect(validateKeyName('')).toEqual({ valid: false, error: 'Key name is required' });
        expect(validateKeyName('   ')).toEqual({ valid: false, error: 'Key name is required' });
        expect(validateKeyName(null)).toEqual({ valid: false, error: 'Key name is required' });
        expect(validateKeyName(undefined)).toEqual({ valid: false, error: 'Key name is required' });
    });

    it('should reject key names with invalid characters', () => {
        const result = validateKeyName('my key');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('only contain');
    });

    it('should reject key names that are too long', () => {
        const longName = 'a'.repeat(100);
        const result = validateKeyName(longName);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('at most');
    });

    it('should trim whitespace before validation', () => {
        expect(validateKeyName('  valid-name  ')).toEqual({ valid: true });
    });
});

describe('validateAppName', () => {
    it('should accept valid app names', () => {
        expect(validateAppName('My Cool App')).toEqual({ valid: true });
        expect(validateAppName('Damus')).toEqual({ valid: true });
    });

    it('should accept empty/null app names', () => {
        expect(validateAppName('')).toEqual({ valid: true });
        expect(validateAppName(null)).toEqual({ valid: true });
        expect(validateAppName(undefined)).toEqual({ valid: true });
    });

    it('should reject app names that are too long', () => {
        const longName = 'a'.repeat(200);
        const result = validateAppName(longName);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('at most');
    });
});

describe('validatePassphrase', () => {
    it('should accept valid passphrases', () => {
        expect(validatePassphrase('correct horse battery staple')).toEqual({ valid: true });
        expect(validatePassphrase('password123')).toEqual({ valid: true }); // 8+ chars
        expect(validatePassphrase('12345678')).toEqual({ valid: true }); // exactly 8 chars
    });

    it('should accept empty/null passphrases (unencrypted key)', () => {
        expect(validatePassphrase('')).toEqual({ valid: true });
        expect(validatePassphrase(null)).toEqual({ valid: true });
        expect(validatePassphrase(undefined)).toEqual({ valid: true });
    });

    it('should reject passphrases that are too short', () => {
        const result = validatePassphrase('short');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('at least');
    });

    it('should reject passphrases that are too long', () => {
        const longPass = 'a'.repeat(300);
        const result = validatePassphrase(longPass);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('at most');
    });
});

describe('validateUri', () => {
    it('should accept valid URIs', () => {
        expect(validateUri('bunker://abc123')).toEqual({ valid: true });
        expect(validateUri('nostrconnect://def456')).toEqual({ valid: true });
        expect(validateUri('https://example.com')).toEqual({ valid: true });
    });

    it('should reject empty URIs', () => {
        expect(validateUri('')).toEqual({ valid: false, error: 'URI is required' });
        expect(validateUri(null)).toEqual({ valid: false, error: 'URI is required' });
    });

    it('should reject invalid URI formats', () => {
        expect(validateUri('not-a-uri')).toEqual({ valid: false, error: 'Invalid URI format' });
        expect(validateUri('just text')).toEqual({ valid: false, error: 'Invalid URI format' });
    });

    it('should reject URIs that are too long', () => {
        const longUri = 'bunker://' + 'a'.repeat(3000);
        const result = validateUri(longUri);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('at most');
    });
});

describe('validateRelays', () => {
    it('should accept valid relay lists', () => {
        expect(validateRelays(['wss://relay.example.com'])).toEqual({ valid: true });
        expect(validateRelays(['wss://relay1.com', 'wss://relay2.com'])).toEqual({ valid: true });
        expect(validateRelays(['ws://localhost:8080'])).toEqual({ valid: true });
    });

    it('should reject empty relay lists', () => {
        expect(validateRelays([])).toEqual({ valid: false, error: 'At least one relay is required' });
        expect(validateRelays(null)).toEqual({ valid: false, error: 'At least one relay is required' });
    });

    it('should reject invalid relay URLs', () => {
        const result = validateRelays(['https://not-a-websocket.com']);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Invalid relay URL');
    });

    it('should reject too many relays', () => {
        const manyRelays = Array.from({ length: 20 }, (_, i) => `wss://relay${i}.com`);
        const result = validateRelays(manyRelays);
        expect(result.valid).toBe(false);
        expect(result.error).toContain('At most');
    });
});

describe('sanitizeString', () => {
    it('should trim whitespace', () => {
        expect(sanitizeString('  hello  ')).toBe('hello');
    });

    it('should remove control characters', () => {
        expect(sanitizeString('hello\x00world')).toBe('helloworld');
        expect(sanitizeString('test\x1Fvalue')).toBe('testvalue');
    });

    it('should handle null/undefined', () => {
        expect(sanitizeString(null)).toBe('');
        expect(sanitizeString(undefined)).toBe('');
    });

    it('should preserve normal text', () => {
        expect(sanitizeString('Hello World 123!')).toBe('Hello World 123!');
    });
});
