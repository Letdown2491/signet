/**
 * Error handling utilities for consistent error message extraction.
 *
 * JavaScript catch blocks receive `unknown` type, which requires
 * careful handling. These utilities provide safe, consistent patterns.
 */

/**
 * Safely extract an error message from an unknown caught value.
 *
 * @param error - The caught error (could be anything)
 * @returns A string message suitable for logging or display
 *
 * @example
 * try {
 *   await riskyOperation();
 * } catch (error) {
 *   console.log(`Failed: ${toErrorMessage(error)}`);
 * }
 */
export function toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'string') {
        return error;
    }
    return String(error);
}

/**
 * Check if an error matches a specific message pattern.
 * Useful for handling specific error types differently.
 *
 * @param error - The caught error
 * @param pattern - String to search for in the error message
 * @returns true if the error message contains the pattern
 */
export function errorContains(error: unknown, pattern: string): boolean {
    return toErrorMessage(error).includes(pattern);
}

/**
 * HTML entity map for escaping user content.
 */
const HTML_ENTITIES: Record<string, string> = {
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;',
};

/**
 * Escape HTML special characters to prevent XSS.
 * Use this when displaying user-provided content in HTML.
 *
 * @param text - The text to escape
 * @returns HTML-safe string
 */
export function escapeHtml(text: string): string {
    return text.replace(/[<>&"']/g, (char) => HTML_ENTITIES[char] || char);
}

/**
 * Safely convert an error to an HTML-safe message.
 * Combines toErrorMessage and escapeHtml for error display.
 *
 * @param error - The caught error
 * @returns HTML-safe error message
 */
export function toSafeErrorHtml(error: unknown): string {
    return escapeHtml(toErrorMessage(error) || 'An error occurred');
}
