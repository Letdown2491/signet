import bcrypt from 'bcrypt';
import createDebug from 'debug';
import prisma from '../../db.js';
import { permitAllRequests } from '../lib/acl.js';
import type { StoredKey } from '../../config/types.js';
import type { AllowScope } from '../lib/acl.js';
import { validateRegistration } from './registration-validations.js';

const debug = createDebug('signet:web');

async function validateAuthCookie(request: any): Promise<boolean> {
    const token = request?.cookies?.jwt;
    if (!token) {
        return false;
    }

    const user = await prisma.user.findUnique({ where: { pubkey: token } });
    return Boolean(user);
}

async function loadPendingRequest(request: any) {
    const record = await prisma.request.findUnique({
        where: { id: request.params.id },
    });

    if (!record || record.allowed !== null) {
        throw new Error('Request not found or already processed');
    }

    return record;
}

export async function authorizeRequestWebHandler(request: any, reply: any) {
    try {
        const record = await loadPendingRequest(request);
        const url = new URL(request.url, `http://${request.headers.host}`);
        const callbackUrl = url.searchParams.get('callbackUrl') ?? undefined;

        if (record.method === 'create_account') {
            const [username, domain, email] = JSON.parse(record.params ?? '[]');
            const nip05 = `${username}@${domain}`;
            return reply.view('/templates/createAccount.handlebar', {
                record,
                username,
                domain,
                email,
                nip05,
                callbackUrl,
            });
        }

        const authorised = await validateAuthCookie(request);
        return reply.view('/templates/authorizeRequest.handlebar', {
            record,
            callbackUrl,
            authorised,
        });
    } catch (error) {
        debug('authorizeRequestWebHandler failed', error);
        return reply.view('/templates/error.handlebar', { error: (error as Error).message });
    }
}

async function authenticateUser(
    record: any,
    request: any,
    keyStore?: Record<string, StoredKey>
) {
    if (await validateAuthCookie(request)) {
        return prisma.user.findUnique({
            where: { pubkey: record.remotePubkey },
        });
    }

    const keyName = record.keyName as string | undefined;
    const storedKey = keyName && keyStore ? keyStore[keyName] : undefined;
    const isPlainKey =
        Boolean(storedKey?.key) && !storedKey?.iv && !storedKey?.data;

    if (!keyName) {
        if (isPlainKey) {
            return undefined;
        }
        throw new Error('Request missing keyName');
    }

    if (isPlainKey) {
        return undefined;
    }

    const [username, domain] = keyName.split('@');
    if (!username || !domain) {
        throw new Error('Invalid key identifier');
    }

    const password = request.body?.password;
    if (!password) {
        throw new Error('Password required');
    }

    const userRecord = await prisma.user.findUnique({
        where: { username, domain },
    });

    if (!userRecord) {
        throw new Error('Account not found');
    }

    const valid = await bcrypt.compare(password, userRecord.password);
    if (!valid) {
        throw new Error('Invalid password');
    }

    return userRecord;
}

export async function processRequestWebHandler(
    request: any,
    reply: any,
    keyStore?: Record<string, StoredKey>
) {
    try {
        const record = await loadPendingRequest(request);
        const user = await authenticateUser(record, request, keyStore);

        await prisma.request.update({
            where: { id: record.id },
            data: {
                allowed: true,
                processedAt: new Date(),
            },
        });

        const scope: AllowScope = { kind: 'all' };
        await permitAllRequests(record.remotePubkey, record.keyName, record.method, undefined, scope);

        if (record.method === 'connect') {
            await permitAllRequests(
                record.remotePubkey,
                record.keyName,
                'sign_event',
                undefined,
                scope
            );
        }

        // Log the approved request
        if (record.keyName && record.remotePubkey) {
            const keyUser = await prisma.keyUser.findUnique({
                where: {
                    unique_key_user: {
                        keyName: record.keyName,
                        userPubkey: record.remotePubkey,
                    },
                },
            });

            if (keyUser) {
                await prisma.log.create({
                    data: {
                        timestamp: new Date(),
                        type: 'approval',
                        method: record.method,
                        params: record.params,
                        keyUserId: keyUser.id,
                    },
                });
            }
        }

        reply.type('application/json');
        return reply.send({ ok: true, pubkey: user?.pubkey });
    } catch (error) {
        reply.status(401);
        reply.type('application/json');
        return reply.send({ ok: false, error: (error as Error).message });
    }
}

async function waitForKeyCreation(keyName: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const start = Date.now();

        const interval = setInterval(async () => {
            const record = await prisma.key.findUnique({ where: { keyName } });
            if (record) {
                clearInterval(interval);
                resolve(record.pubkey);
            }

            if (Date.now() - start > 60_000) {
                clearInterval(interval);
                reject(new Error('Timed out waiting for key creation'));
            }
        }, 100);
    });
}

export async function processRegistrationWebHandler(request: any, reply: any) {
    try {
        const record = await loadPendingRequest(request);
        await validateRegistration(request);

        const payload = [request.body.username, request.body.domain, request.body.email];
        await prisma.request.update({
            where: { id: record.id },
            data: {
                params: JSON.stringify(payload),
                allowed: true,
                processedAt: new Date(),
            },
        });

        const keyName = record.keyName;
        if (!keyName) {
            throw new Error('Request missing key name');
        }

        const pubkey = await waitForKeyCreation(keyName);
        const hashedPassword = await bcrypt.hash(request.body.password, 10);

        await prisma.user.create({
            data: {
                username: request.body.username,
                domain: request.body.domain,
                email: request.body.email,
                password: hashedPassword,
                pubkey,
            },
        });

        await permitAllRequests(record.remotePubkey, keyName, record.method);

        // Log the registration
        const keyUser = await prisma.keyUser.findUnique({
            where: {
                unique_key_user: {
                    keyName: keyName,
                    userPubkey: record.remotePubkey,
                },
            },
        });

        if (keyUser) {
            await prisma.log.create({
                data: {
                    timestamp: new Date(),
                    type: 'registration',
                    method: record.method,
                    params: JSON.stringify(payload),
                    keyUserId: keyUser.id,
                },
            });
        }

        const callbackUrl = request.body.callbackUrl;
        if (callbackUrl) {
            const redirect = new URL(callbackUrl);
            redirect.searchParams.set('pubkey', pubkey);
            return reply.view('/templates/redirect.handlebar', { callbackUrl: redirect.toString() });
        }

        return reply.view('/templates/redirect.handlebar', { callbackUrl: undefined });
    } catch (error) {
        debug('processRegistrationWebHandler failed', error);
        return reply.view('/templates/error.handlebar', { error: (error as Error).message });
    }
}
