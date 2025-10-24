import NDK, {
    NDKNip46Backend,
    NDKPrivateKeySigner,
    Nip46PermitCallback,
} from '@nostr-dev-kit/ndk';
import type { FastifyInstance } from 'fastify';
import prisma from '../db.js';

export class BunkerBackend extends NDKNip46Backend {
    public readonly baseUrl?: string;
    public readonly fastify: FastifyInstance;

    constructor(
        ndk: NDK,
        fastify: FastifyInstance,
        secret: string,
        permitCallback: Nip46PermitCallback,
        baseUrl?: string
    ) {
        const signer = new NDKPrivateKeySigner(secret);
        super(ndk, signer, permitCallback);
        this.fastify = fastify;
        this.baseUrl = baseUrl;
    }

    private async fetchValidToken(token: string) {
        const record = await prisma.token.findUnique({
            where: { token },
            include: { policy: { include: { rules: true } } },
        });

        if (!record) {
            throw new Error('Token not found');
        }

        if (record.redeemedAt) {
            throw new Error('Token already redeemed');
        }

        if (!record.policy) {
            throw new Error('Token policy missing');
        }

        if (record.expiresAt && record.expiresAt < new Date()) {
            throw new Error('Token expired');
        }

        return record;
    }

    public async applyToken(remotePubkey: string, token: string): Promise<void> {
        const record = await this.fetchValidToken(token);

        const keyUser = await prisma.keyUser.upsert({
            where: { unique_key_user: { keyName: record.keyName, userPubkey: remotePubkey } },
            update: {},
            create: {
                keyName: record.keyName,
                userPubkey: remotePubkey,
                description: record.clientName,
            },
        });

        await prisma.signingCondition.create({
            data: {
                keyUserId: keyUser.id,
                method: 'connect',
                allowed: true,
            },
        });

        for (const rule of record.policy!.rules) {
            await prisma.signingCondition.create({
                data: {
                    keyUserId: keyUser.id,
                    method: rule.method,
                    allowed: true,
                    kind: rule.kind !== null && rule.kind !== undefined ? rule.kind.toString() : undefined,
                },
            });
        }

        await prisma.token.update({
            where: { id: record.id },
            data: {
                redeemedAt: new Date(),
                keyUserId: keyUser.id,
            },
        });
    }
}
