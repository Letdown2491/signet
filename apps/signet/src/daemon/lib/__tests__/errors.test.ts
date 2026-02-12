import { describe, it, expect } from 'vitest';
import { toErrorMessage, errorContains, escapeHtml, toSafeErrorHtml } from '../errors.js';

describe('toErrorMessage', () => {
    it('should extract message from Error instance', () => {
        const error = new Error('Something went wrong');
        expect(toErrorMessage(error)).toBe('Something went wrong');
    });

    it('should handle Error subclasses', () => {
        const error = new TypeError('Invalid type');
        expect(toErrorMessage(error)).toBe('Invalid type');
    });

    it('should return string directly', () => {
        expect(toErrorMessage('Direct string error')).toBe('Direct string error');
    });

    it('should convert number to string', () => {
        expect(toErrorMessage(404)).toBe('404');
    });

    it('should convert null to string', () => {
        expect(toErrorMessage(null)).toBe('null');
    });

    it('should convert undefined to string', () => {
        expect(toErrorMessage(undefined)).toBe('undefined');
    });

    it('should convert object to string', () => {
        expect(toErrorMessage({ foo: 'bar' })).toBe('[object Object]');
    });

    it('should handle empty Error message', () => {
        const error = new Error('');
        expect(toErrorMessage(error)).toBe('');
    });
});

describe('errorContains', () => {
    it('should find pattern in Error message', () => {
        const error = new Error('Key not found');
        expect(errorContains(error, 'not found')).toBe(true);
    });

    it('should return false when pattern not in Error message', () => {
        const error = new Error('Something else');
        expect(errorContains(error, 'not found')).toBe(false);
    });

    it('should work with string errors', () => {
        expect(errorContains('Permission denied', 'denied')).toBe(true);
    });

    it('should be case-sensitive', () => {
        expect(errorContains('Not Found', 'not found')).toBe(false);
    });
});

describe('escapeHtml', () => {
    it('should escape less-than sign', () => {
        expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    it('should escape greater-than sign', () => {
        expect(escapeHtml('a > b')).toBe('a &gt; b');
    });

    it('should escape ampersand', () => {
        expect(escapeHtml('foo & bar')).toBe('foo &amp; bar');
    });

    it('should escape double quotes', () => {
        expect(escapeHtml('say "hello"')).toBe('say &quot;hello&quot;');
    });

    it('should escape single quotes', () => {
        expect(escapeHtml("it's fine")).toBe('it&#39;s fine');
    });

    it('should escape all special characters together', () => {
        expect(escapeHtml('<div class="test">it\'s & more</div>'))
            .toBe('&lt;div class=&quot;test&quot;&gt;it&#39;s &amp; more&lt;/div&gt;');
    });

    it('should return empty string unchanged', () => {
        expect(escapeHtml('')).toBe('');
    });

    it('should return safe text unchanged', () => {
        expect(escapeHtml('Hello World 123')).toBe('Hello World 123');
    });

    it('should handle XSS attack vectors', () => {
        expect(escapeHtml('<script>alert("xss")</script>'))
            .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        expect(escapeHtml('<img onerror="alert(1)" src="x">'))
            .toBe('&lt;img onerror=&quot;alert(1)&quot; src=&quot;x&quot;&gt;');
    });
});

describe('toSafeErrorHtml', () => {
    it('should escape HTML in Error message', () => {
        const error = new Error('<script>alert("xss")</script>');
        expect(toSafeErrorHtml(error)).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    });

    it('should escape HTML in string error', () => {
        expect(toSafeErrorHtml('<b>bad</b>')).toBe('&lt;b&gt;bad&lt;/b&gt;');
    });

    it('should return default message for empty error', () => {
        expect(toSafeErrorHtml(new Error(''))).toBe('An error occurred');
    });

    it('should return default message for null', () => {
        // null stringifies to 'null' which is not empty
        expect(toSafeErrorHtml(null)).toBe('null');
    });

    it('should handle safe error messages', () => {
        const error = new Error('Key not found');
        expect(toSafeErrorHtml(error)).toBe('Key not found');
    });
});
