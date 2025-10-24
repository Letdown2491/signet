import type { NDKEvent, NostrEvent } from '@nostr-dev-kit/ndk';
import prisma from '../../db.js';

export type RpcMethod = 'connect' | 'sign_event' | 'encrypt' | 'decrypt' | 'ping';

export type AllowScope = {
    kind?: number | 'all';
};

type SigningConditionQuery = {
    method: string;
    kind?: string | { in: string[] };
};

function extractKind(payload?: string | NostrEvent | NDKEvent): number | undefined {
    if (!payload) {
        return undefined;
    }

    if (typeof payload === 'string') {
        try {
            const parsed = JSON.parse(payload);
            if (typeof parsed?.kind === 'number') {
                return parsed.kind;
            }
        } catch {
            return undefined;
        }
        return undefined;
    }

    if ('kind' in payload && typeof (payload as NostrEvent).kind === 'number') {
        return (payload as NostrEvent).kind;
    }

    if (typeof (payload as NDKEvent).rawEvent === 'function') {
        const raw = (payload as NDKEvent).rawEvent();
        if (raw && typeof raw.kind === 'number') {
            return raw.kind;
        }
    }

    return undefined;
}

function buildConditionQuery(
    method: RpcMethod,
    payload?: string | NostrEvent | NDKEvent
): SigningConditionQuery {
    if (method !== 'sign_event') {
        return { method };
    }

    const kind = extractKind(payload);
    const kinds = new Set<string>(['all']);
    if (typeof kind === 'number') {
        kinds.add(kind.toString());
    }

    return {
        method,
        kind: { in: Array.from(kinds) },
    };
}

export async function isRequestPermitted(
    keyName: string,
    remotePubkey: string,
    method: RpcMethod,
    payload?: string | NDKEvent | NostrEvent
): Promise<boolean | undefined> {
    const keyUser = await prisma.keyUser.findUnique({
        where: { unique_key_user: { keyName, userPubkey: remotePubkey } },
    });

    if (!keyUser) {
        return undefined;
    }

    const explicitDeny = await prisma.signingCondition.findFirst({
        where: {
            keyUserId: keyUser.id,
            method: '*',
            allowed: false,
        },
    });

    if (explicitDeny) {
        return false;
    }

    const query = buildConditionQuery(method, payload);

    const condition = await prisma.signingCondition.findFirst({
        where: {
            keyUserId: keyUser.id,
            ...query,
        },
    });

    if (!condition) {
        return undefined;
    }

    if (condition.allowed && keyUser.revokedAt) {
        return false;
    }

    if (condition.allowed === true || condition.allowed === false) {
        return condition.allowed;
    }

    return undefined;
}

export function scopeToCondition(method: RpcMethod | string, scope?: AllowScope): SigningConditionQuery {
    if (!scope || scope.kind === undefined) {
        return { method };
    }

    return {
        method,
        kind: scope.kind.toString(),
    };
}

export async function permitAllRequests(
    remotePubkey: string,
    keyName: string,
    method: RpcMethod | string,
    description?: string,
    scope?: AllowScope
): Promise<void> {
    const keyUser = await prisma.keyUser.upsert({
        where: { unique_key_user: { keyName, userPubkey: remotePubkey } },
        update: {},
        create: { keyName, userPubkey: remotePubkey, description },
    });

    const conditionQuery = scopeToCondition(method, scope);

    await prisma.signingCondition.create({
        data: {
            keyUserId: keyUser.id,
            allowed: true,
            ...conditionQuery,
        },
    });
}

export async function blockAllRequests(remotePubkey: string, keyName: string): Promise<void> {
    const keyUser = await prisma.keyUser.upsert({
        where: { unique_key_user: { keyName, userPubkey: remotePubkey } },
        update: {},
        create: { keyName, userPubkey: remotePubkey },
    });

    await prisma.signingCondition.create({
        data: {
            keyUserId: keyUser.id,
            allowed: false,
            method: '*',
        },
    });
}
