import { describe, it, expect } from 'vitest';
import { parseNip46Param, extractEventKind, parseEventPreview } from '../parse.js';

describe('parseNip46Param', () => {
    it('should return first element from array format', () => {
        const result = parseNip46Param('[{"kind": 1, "content": "test"}]');
        expect(result).toEqual({ kind: 1, content: 'test' });
    });

    it('should return object directly from object format', () => {
        const result = parseNip46Param('{"kind": 1, "content": "test"}');
        expect(result).toEqual({ kind: 1, content: 'test' });
    });

    it('should return null for null input', () => {
        expect(parseNip46Param(null)).toBeNull();
    });

    it('should return null for undefined input', () => {
        expect(parseNip46Param(undefined)).toBeNull();
    });

    it('should return null for invalid JSON', () => {
        expect(parseNip46Param('not json')).toBeNull();
    });

    it('should return undefined for empty array', () => {
        expect(parseNip46Param('[]')).toBeUndefined();
    });
});

describe('extractEventKind', () => {
    it('should extract kind from array format', () => {
        const params = JSON.stringify([{ kind: 1, content: 'hello' }]);
        expect(extractEventKind(params)).toBe(1);
    });

    it('should extract kind from object format', () => {
        const params = JSON.stringify({ kind: 7, content: '+' });
        expect(extractEventKind(params)).toBe(7);
    });

    it('should return undefined for null input', () => {
        expect(extractEventKind(null)).toBeUndefined();
    });

    it('should return undefined for undefined input', () => {
        expect(extractEventKind(undefined)).toBeUndefined();
    });

    it('should return undefined for invalid JSON', () => {
        expect(extractEventKind('invalid')).toBeUndefined();
    });

    it('should return undefined if kind is not a number', () => {
        expect(extractEventKind('{"kind": "1"}')).toBeUndefined();
    });

    it('should return undefined if kind is missing', () => {
        expect(extractEventKind('{"content": "test"}')).toBeUndefined();
    });

    it('should handle kind 0 correctly', () => {
        expect(extractEventKind('{"kind": 0}')).toBe(0);
    });
});

describe('parseEventPreview', () => {
    it('should parse complete event from array format', () => {
        const params = JSON.stringify([{
            kind: 1,
            content: 'Hello world',
            tags: [['p', 'abc123']],
        }]);

        const result = parseEventPreview(params);
        expect(result).toEqual({
            kind: 1,
            content: 'Hello world',
            tags: [['p', 'abc123']],
        });
    });

    it('should parse complete event from object format', () => {
        const params = JSON.stringify({
            kind: 7,
            content: '+',
            tags: [['e', 'event123']],
        });

        const result = parseEventPreview(params);
        expect(result).toEqual({
            kind: 7,
            content: '+',
            tags: [['e', 'event123']],
        });
    });

    it('should return null for null input', () => {
        expect(parseEventPreview(null)).toBeNull();
    });

    it('should return null for invalid JSON', () => {
        expect(parseEventPreview('not json')).toBeNull();
    });

    it('should return null if kind is missing', () => {
        expect(parseEventPreview('{"content": "test"}')).toBeNull();
    });

    it('should return null if kind is not a number', () => {
        expect(parseEventPreview('{"kind": "1", "content": "test"}')).toBeNull();
    });

    it('should default content to empty string if missing', () => {
        const result = parseEventPreview('{"kind": 1}');
        expect(result?.content).toBe('');
    });

    it('should default tags to empty array if missing', () => {
        const result = parseEventPreview('{"kind": 1}');
        expect(result?.tags).toEqual([]);
    });

    it('should default content to empty string if not a string', () => {
        const result = parseEventPreview('{"kind": 1, "content": 123}');
        expect(result?.content).toBe('');
    });

    it('should default tags to empty array if not an array', () => {
        const result = parseEventPreview('{"kind": 1, "tags": "invalid"}');
        expect(result?.tags).toEqual([]);
    });
});
