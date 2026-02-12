import crypto from 'crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import {
    JWT_EXPIRY,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_BLOCK_DURATION_MS,
} from '../constants.js';
import { TTLCache } from './ttl-cache.js';

const COOKIE_NAME = 'signet_auth';
const CSRF_COOKIE_NAME = 'signet_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';

interface RateLimitEntry {
    count: number;
    windowStart: number;
    blockedUntil?: number;
}

// Rate limit store using TTLCache for automatic cleanup and bounded memory
// TTL is set to block duration + window to ensure blocked entries persist long enough
// Max size prevents unbounded growth under high traffic
const RATE_LIMIT_TTL_MS = RATE_LIMIT_BLOCK_DURATION_MS + RATE_LIMIT_WINDOW_MS;
const RATE_LIMIT_MAX_ENTRIES = 10_000;

const rateLimitStore = new TTLCache<RateLimitEntry>('rate-limit', {
    ttlMs: RATE_LIMIT_TTL_MS,
    maxSize: RATE_LIMIT_MAX_ENTRIES,
    cleanupIntervalMs: 30_000, // Cleanup every 30 seconds
});

export interface JwtPayload {
    pubkey: string;
    iat?: number;
    exp?: number;
}

/**
 * Generate a cryptographically secure JWT secret
 */
export function generateJwtSecret(): string {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Register JWT and cookie plugins with Fastify
 */
export async function registerAuthPlugins(
    fastify: FastifyInstance,
    jwtSecret: string
): Promise<void> {
    await fastify.register(fastifyCookie);
    await fastify.register(fastifyJwt, {
        secret: jwtSecret,
        cookie: {
            cookieName: COOKIE_NAME,
            signed: false,
        },
    });
}

/**
 * Create a signed JWT token for a user
 */
export function signToken(fastify: FastifyInstance, pubkey: string): string {
    return fastify.jwt.sign({ pubkey }, { expiresIn: JWT_EXPIRY });
}

/**
 * Verify and decode a JWT token from the request
 * Returns the payload if valid, null otherwise
 */
export async function verifyToken(
    fastify: FastifyInstance,
    request: FastifyRequest
): Promise<JwtPayload | null> {
    try {
        // Try cookie first
        const cookieToken = (request.cookies as Record<string, string>)?.[COOKIE_NAME];
        if (cookieToken) {
            const decoded = fastify.jwt.verify<JwtPayload>(cookieToken);
            return decoded;
        }

        // Try Authorization header
        const authHeader = request.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.slice(7);
            const decoded = fastify.jwt.verify<JwtPayload>(token);
            return decoded;
        }

        return null;
    } catch {
        return null;
    }
}

/**
 * Set authentication cookie in response
 */
export function setAuthCookie(
    reply: FastifyReply,
    token: string,
    secure: boolean = true
): void {
    reply.setCookie(COOKIE_NAME, token, {
        path: '/',
        httpOnly: true,
        secure,
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
    });
}

/**
 * Clear authentication cookie
 */
export function clearAuthCookie(reply: FastifyReply): void {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
}

/**
 * Generate a CSRF token
 */
export function generateCsrfToken(): string {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Set CSRF token cookie in response.
 * The cookie is readable by JavaScript (not httpOnly) so the client can
 * include it in the X-CSRF-Token header.
 */
export function setCsrfCookie(
    reply: FastifyReply,
    token: string,
    secure: boolean = true
): void {
    reply.setCookie(CSRF_COOKIE_NAME, token, {
        path: '/',
        httpOnly: false, // Must be readable by JavaScript
        secure,
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
    });
}

/**
 * Clear CSRF cookie
 */
export function clearCsrfCookie(reply: FastifyReply): void {
    reply.clearCookie(CSRF_COOKIE_NAME, { path: '/' });
}

/**
 * Create CSRF protection middleware.
 * Validates that state-changing requests (POST, PUT, DELETE, PATCH) include
 * a valid CSRF token in the X-CSRF-Token header that matches the cookie.
 *
 * CSRF protection is skipped for Bearer token auth since CSRF attacks only
 * apply to cookie-based auth (where credentials are sent automatically).
 * Bearer tokens must be explicitly included by the client, so they're not
 * vulnerable to cross-site request forgery.
 */
export function createCsrfMiddleware() {
    return async function csrfMiddleware(
        request: FastifyRequest,
        reply: FastifyReply
    ): Promise<void> {
        // Only check state-changing methods
        const method = request.method.toUpperCase();
        if (!['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
            return;
        }

        // Skip CSRF for Bearer token auth - not vulnerable to CSRF attacks
        const authHeader = request.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            return;
        }

        const cookies = request.cookies as Record<string, string> | undefined;
        const csrfCookie = cookies?.[CSRF_COOKIE_NAME];
        const csrfHeader = request.headers[CSRF_HEADER_NAME] as string | undefined;

        if (!csrfCookie || !csrfHeader) {
            reply.code(403).send({ error: 'CSRF token missing' });
            return;
        }

        // Use timing-safe comparison to prevent timing attacks
        if (!timingSafeEqual(csrfCookie, csrfHeader)) {
            reply.code(403).send({ error: 'CSRF token mismatch' });
            return;
        }
    };
}

/**
 * Timing-safe string comparison
 */
function timingSafeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) {
        return false;
    }
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Validate that a URL is safe for redirect (no javascript:, data:, etc.)
 */
export function isValidRedirectUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        // Only allow http and https protocols
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Sanitize a callback URL - returns null if invalid
 */
export function sanitizeCallbackUrl(url: string | null | undefined): string | null {
    if (!url) {
        return null;
    }

    if (!isValidRedirectUrl(url)) {
        return null;
    }

    return url;
}

/**
 * Create authentication middleware for protected routes
 * @param fastify - Fastify instance
 * @param requireAuth - If false, skip authentication (for local-only deployments)
 */
export function createAuthMiddleware(fastify: FastifyInstance, requireAuth: boolean = true) {
    return async function authMiddleware(
        request: FastifyRequest,
        reply: FastifyReply
    ): Promise<void> {
        // Skip auth if not required (local-only mode)
        if (!requireAuth) {
            return;
        }

        const payload = await verifyToken(fastify, request);

        if (!payload) {
            reply.code(401).send({ error: 'Authentication required' });
            return;
        }

        // Attach the authenticated user info to the request
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (request as FastifyRequest & { user: JwtPayload }).user = payload;
    };
}

/**
 * Validate CORS origin against allowed list
 */
export function isAllowedOrigin(origin: string | undefined, allowedOrigins: string[]): boolean {
    if (!origin) {
        return false;
    }

    // If allowedOrigins is empty, deny all cross-origin requests
    if (allowedOrigins.length === 0) {
        return false;
    }

    // Check for exact match or wildcard patterns
    for (const allowed of allowedOrigins) {
        if (allowed === '*') {
            return true;
        }

        if (allowed === origin) {
            return true;
        }

        // Support wildcard subdomains like *.example.com
        if (allowed.startsWith('*.')) {
            const domain = allowed.slice(2);
            try {
                const originUrl = new URL(origin);
                if (originUrl.hostname === domain || originUrl.hostname.endsWith('.' + domain)) {
                    return true;
                }
            } catch {
                // Invalid origin URL
            }
        }
    }

    return false;
}

/**
 * Get client identifier for rate limiting (IP address)
 */
function getClientIdentifier(request: FastifyRequest): string {
    // Try to get the real IP from common proxy headers
    const forwarded = request.headers['x-forwarded-for'];
    if (forwarded) {
        const ip = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
        return ip.trim();
    }

    const realIp = request.headers['x-real-ip'];
    if (realIp) {
        return Array.isArray(realIp) ? realIp[0] : realIp;
    }

    return request.ip || 'unknown';
}

/**
 * Check if a request is rate limited
 * Returns { allowed: true } if allowed, or { allowed: false, retryAfter: seconds } if blocked
 */
export function checkRateLimit(
    identifier: string,
    endpoint: string = 'default'
): { allowed: boolean; retryAfter?: number } {
    const key = `${identifier}:${endpoint}`;
    const now = Date.now();
    const entry = rateLimitStore.get(key);

    if (entry) {
        // Check if currently blocked
        if (entry.blockedUntil && entry.blockedUntil > now) {
            return {
                allowed: false,
                retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
            };
        }

        // Check if we're still in the current window
        if (now - entry.windowStart < RATE_LIMIT_WINDOW_MS) {
            entry.count++;

            if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
                // Block the client
                entry.blockedUntil = now + RATE_LIMIT_BLOCK_DURATION_MS;
                return {
                    allowed: false,
                    retryAfter: Math.ceil(RATE_LIMIT_BLOCK_DURATION_MS / 1000),
                };
            }

            return { allowed: true };
        }

        // Window expired, reset
        entry.count = 1;
        entry.windowStart = now;
        entry.blockedUntil = undefined;
        return { allowed: true };
    }

    // New client
    rateLimitStore.set(key, {
        count: 1,
        windowStart: now,
    });

    return { allowed: true };
}

/**
 * Create rate limiting middleware for sensitive endpoints
 */
export function createRateLimitMiddleware(endpoint: string = 'default') {
    return async function rateLimitMiddleware(
        request: FastifyRequest,
        reply: FastifyReply
    ): Promise<void> {
        const identifier = getClientIdentifier(request);
        const result = checkRateLimit(identifier, endpoint);

        if (!result.allowed) {
            reply.header('Retry-After', String(result.retryAfter));
            reply.code(429).send({
                error: 'Too many requests',
                retryAfter: result.retryAfter,
            });
            return;
        }
    };
}
