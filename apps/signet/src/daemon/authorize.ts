import type { Event } from 'nostr-tools/pure';
import createDebug from 'debug';
import prisma from '../db.js';
import type { ConnectionManager } from './connection-manager.js';
import { getEventService, emitCurrentStats } from './services/index.js';
import { requestRepository } from './repositories/request-repository.js';
import { parseEventPreview } from './lib/parse.js';
import type { PendingRequest } from '@signet/types';
import {
    POLL_INITIAL_INTERVAL_MS,
    POLL_MAX_INTERVAL_MS,
    POLL_TIMEOUT_MS,
    POLL_MULTIPLIER,
    REQUEST_EXPIRY_MS,
} from './constants.js';

const debug = createDebug('signet:authorize');

let cachedBaseUrl: string | null | undefined;

function serialiseParam(payload?: string | Event): string | undefined {
    if (!payload) {
        return undefined;
    }

    if (typeof payload === 'string') {
        return payload;
    }

    try {
        return JSON.stringify(payload);
    } catch {
        return undefined;
    }
}

async function persistRequest(
    keyName: string | undefined,
    requestId: string,
    remotePubkey: string,
    method: string,
    payload?: string | Event
) {
    const params = serialiseParam(payload);

    // Look up keyUserId for non-connect requests (connect creates the KeyUser on approval)
    let keyUserId: number | undefined;
    if (method !== 'connect' && keyName) {
        const foundId = await requestRepository.findKeyUserId(keyName, remotePubkey);
        if (foundId) {
            keyUserId = foundId;
        }
    }

    const record = await prisma.request.create({
        data: {
            keyName,
            requestId,
            remotePubkey,
            method,
            params,
            keyUserId,
        },
        include: { KeyUser: true },
    });

    // Emit event for real-time updates
    const eventService = getEventService();
    const expiresAt = new Date(record.createdAt.getTime() + REQUEST_EXPIRY_MS);

    // Parse event preview if this is a sign_event request
    const eventPreview = method === 'sign_event' ? parseEventPreview(params) : null;

    eventService.emitRequestCreated({
        id: record.id,
        keyName: record.keyName ?? null,
        method: record.method,
        remotePubkey: record.remotePubkey,
        params: record.params ?? null,
        eventPreview,
        createdAt: record.createdAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        ttlSeconds: Math.round(REQUEST_EXPIRY_MS / 1000),
        requiresPassword: false, // Will be determined by the UI
        processedAt: null,
        autoApproved: false,
        appName: record.KeyUser?.description ?? null,
    });

    // Emit stats update (pending count increased)
    await emitCurrentStats();

    // Schedule expiry notification - don't delete the record, keep for history
    const dbRecordId = record.id;
    setTimeout(async () => {
        try {
            // Check if the request is still pending (not processed)
            const currentRecord = await prisma.request.findUnique({
                where: { id: dbRecordId },
                select: { allowed: true },
            });

            // Only emit expired event if request was never processed
            if (currentRecord && currentRecord.allowed === null) {
                eventService.emitRequestExpired(dbRecordId);
                // Emit stats update (pending count decreased)
                await emitCurrentStats();
            }
        } catch (error) {
            debug(`Failed to check request expiry ${dbRecordId}: ${error}`);
        }
    }, REQUEST_EXPIRY_MS);

    return record;
}

async function resolveBaseUrl(connectionManager: ConnectionManager): Promise<string | null> {
    if (cachedBaseUrl !== undefined) {
        return cachedBaseUrl;
    }

    const config = await connectionManager.config();
    // Support both new (UI_URL) and legacy (BASE_URL) env var names
    const baseUrl = config.baseUrl ?? process.env.UI_URL ?? null;
    cachedBaseUrl = baseUrl;
    return baseUrl;
}

function buildRequestUrl(baseUrl: string, requestId: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/requests/${requestId}`;
}

/**
 * Wait for a web-based authorization decision with exponential backoff
 */
function awaitWebDecision(requestId: string): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        let pollInterval = POLL_INITIAL_INTERVAL_MS;
        let timeoutHandle: NodeJS.Timeout | null = null;
        let pollHandle: NodeJS.Timeout | null = null;

        const cleanup = () => {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
                timeoutHandle = null;
            }
            if (pollHandle) {
                clearTimeout(pollHandle);
                pollHandle = null;
            }
        };

        // Set overall timeout
        timeoutHandle = setTimeout(() => {
            cleanup();
            reject(new Error('Authorization request timed out'));
        }, POLL_TIMEOUT_MS);

        const poll = async () => {
            try {
                const record = await prisma.request.findUnique({ where: { id: requestId } });

                if (!record) {
                    // Record was deleted (expired or processed externally)
                    cleanup();
                    reject(new Error('Authorization request expired or was deleted'));
                    return;
                }

                if (record.allowed !== null && record.allowed !== undefined) {
                    cleanup();
                    if (record.allowed) {
                        resolve(record.params ?? undefined);
                    } else {
                        reject(new Error('Request denied'));
                    }
                    return;
                }

                // Still pending - schedule next poll with exponential backoff
                pollInterval = Math.min(pollInterval * POLL_MULTIPLIER, POLL_MAX_INTERVAL_MS);
                pollHandle = setTimeout(poll, pollInterval);
            } catch (error) {
                // Database error - log and continue polling
                debug(`Error polling for request ${requestId}: ${error}`);

                // Check if we've exceeded timeout
                if (Date.now() - startTime > POLL_TIMEOUT_MS) {
                    cleanup();
                    reject(new Error('Authorization request timed out'));
                    return;
                }

                pollHandle = setTimeout(poll, pollInterval);
            }
        };

        // Start polling
        poll();
    });
}

export async function requestAuthorization(
    connectionManager: ConnectionManager,
    keyName: string | undefined,
    remotePubkey: string,
    requestId: string,
    method: string,
    payload?: string | Event
): Promise<string | undefined> {
    const record = await persistRequest(keyName, requestId, remotePubkey, method, payload);
    const baseUrl = await resolveBaseUrl(connectionManager);

    if (!baseUrl) {
        throw new Error('No baseUrl configured - web authorization required');
    }

    const url = buildRequestUrl(baseUrl, record.id);

    // Ensure relay connections are active before sending auth_url
    await connectionManager.ensureConnected();
    await connectionManager.sendResponse(requestId, remotePubkey, 'auth_url', undefined, url);

    return await awaitWebDecision(record.id);
}
