import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * JWT payload attached to authenticated requests.
 */
export interface JwtUserPayload {
    pubkey: string;
    iat?: number;
    exp?: number;
}

/**
 * Authenticated request with user payload attached.
 * Use this type in route handlers that require authentication.
 */
export interface AuthenticatedRequest extends FastifyRequest {
    user: JwtUserPayload;
}

/**
 * Request with URL params containing an ID.
 */
export interface RequestWithId extends FastifyRequest {
    params: { id: string };
}

/**
 * Body for processing (approving) a request.
 */
export interface ProcessRequestBody {
    trustLevel?: string;
    alwaysAllow?: boolean;
    allowKind?: number;
    appName?: string;
}

/**
 * Request for processing (approving) a pending request.
 */
export interface ProcessRequestRequest extends FastifyRequest {
    params: { id: string };
    body: ProcessRequestBody;
}

/**
 * Type for Fastify preHandler middleware functions.
 * All auth, CSRF, and rate limit middleware conform to this signature.
 */
export type PreHandler = (
    request: FastifyRequest,
    reply: FastifyReply
) => Promise<void>;

/**
 * PreHandler configuration for routes that only need authentication.
 */
export type PreHandlerAuth = PreHandler[];

/**
 * PreHandler configuration for routes that need auth and CSRF protection.
 */
export interface PreHandlerAuthCsrf {
    auth: PreHandler[];
    csrf: PreHandler[];
}

/**
 * PreHandler configuration for routes that need auth, CSRF, and rate limiting.
 */
export interface PreHandlerFull {
    auth: PreHandler[];
    csrf: PreHandler[];
    rateLimit: PreHandler[];
}
