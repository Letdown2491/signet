import type { NDKEvent } from '@nostr-dev-kit/ndk';
import prisma from '../db.js';
import AdminInterface from './admin/index.js';

let cachedBaseUrl: string | null | undefined;

function serialiseParam(payload?: string | NDKEvent): string | undefined {
    if (!payload) {
        return undefined;
    }

    if (typeof payload === 'string') {
        return payload;
    }

    try {
        return JSON.stringify(payload.rawEvent());
    } catch {
        return undefined;
    }
}

async function persistRequest(
    keyName: string | undefined,
    requestId: string,
    remotePubkey: string,
    method: string,
    payload?: string | NDKEvent
) {
    const params = serialiseParam(payload);
    const record = await prisma.request.create({
        data: {
            keyName,
            requestId,
            remotePubkey,
            method,
            params,
        },
    });

    setTimeout(() => {
        prisma.request
            .delete({ where: { id: record.id } })
            .catch(() => {});
    }, 60_000);

    return record;
}

async function resolveBaseUrl(admin: AdminInterface): Promise<string | null> {
    if (cachedBaseUrl !== undefined) {
        return cachedBaseUrl;
    }

    const config = await admin.config();
    cachedBaseUrl = config.baseUrl ?? null;
    return cachedBaseUrl;
}

function buildRequestUrl(baseUrl: string, requestId: string): string {
    return `${baseUrl.replace(/\/+$/, '')}/requests/${requestId}`;
}

function awaitWebDecision(requestId: string): Promise<string | undefined> {
    return new Promise((resolve, reject) => {
        const interval = setInterval(async () => {
            const record = await prisma.request.findUnique({ where: { id: requestId } });
            if (!record) {
                clearInterval(interval);
                return;
            }

            if (record.allowed === null || record.allowed === undefined) {
                return;
            }

            clearInterval(interval);

            if (record.allowed) {
                resolve(record.params ?? undefined);
            } else {
                reject(new Error('Request denied'));
            }
        }, 100);
    });
}

export async function requestAuthorization(
    admin: AdminInterface,
    keyName: string | undefined,
    remotePubkey: string,
    requestId: string,
    method: string,
    payload?: string | NDKEvent
): Promise<string | undefined> {
    const record = await persistRequest(keyName, requestId, remotePubkey, method, payload);
    const baseUrl = await resolveBaseUrl(admin);

    if (baseUrl) {
        const url = buildRequestUrl(baseUrl, record.id);
        admin.rpc.sendResponse(requestId, remotePubkey, 'auth_url', undefined, url);
        return await awaitWebDecision(record.id);
    }

    const decision = await admin.requestPermission(keyName, remotePubkey, method, payload);
    if (decision) {
        return undefined;
    }

    throw new Error('Request denied');
}
