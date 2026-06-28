import { describe, it, expect } from 'vitest';
import { getErrorStatus } from '../route-errors.js';

describe('getErrorStatus', () => {
    it('maps an incorrect passphrase to 400 (client error, not a 500)', () => {
        expect(getErrorStatus('Incorrect passphrase')).toBe(400);
    });

    it('maps not-found errors to 404', () => {
        expect(getErrorStatus('Key not found')).toBe(404);
    });

    it('maps already-exists conflicts to 409', () => {
        expect(getErrorStatus('A key with that name already exists')).toBe(409);
    });

    it('falls back to 500 for unrecognized errors', () => {
        expect(getErrorStatus('something unexpected blew up')).toBe(500);
    });
});
