import crypto from 'crypto';
import type { NDKRpcRequest } from '@nostr-dev-kit/ndk';
import AdminInterface from '../index.js';
import prisma from '../../../db.js';

export default async function createNewToken(admin: AdminInterface, req: NDKRpcRequest): Promise<void> {
    const [keyName, clientName, policyId, durationInHours] = req.params as [string, string, string, string?];

    if (!keyName || !clientName || !policyId) {
        throw new Error('Missing required parameters for token creation');
    }

    const policy = await prisma.policy.findUnique({
        where: { id: Number(policyId) },
        include: { rules: true },
    });

    if (!policy) {
        throw new Error('Policy not found');
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt =
        durationInHours !== undefined
            ? new Date(Date.now() + Number(durationInHours) * 60 * 60 * 1000)
            : undefined;

    await prisma.token.create({
        data: {
            keyName,
            clientName,
            createdBy: req.pubkey ?? 'unknown',
            token,
            policyId: policy.id,
            expiresAt,
        },
    });

    const response = JSON.stringify(['ok']);
    admin.rpc.sendResponse(req.id, req.pubkey, response, 24134);
}
