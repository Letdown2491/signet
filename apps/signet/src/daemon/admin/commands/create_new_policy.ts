import type { NDKRpcRequest } from '@nostr-dev-kit/ndk';
import AdminInterface from '../index.js';
import prisma from '../../../db.js';

export default async function createNewPolicy(admin: AdminInterface, req: NDKRpcRequest): Promise<void> {
    const [rawPolicy] = req.params as [string];
    if (!rawPolicy) {
        throw new Error('Missing policy payload');
    }

    const policy = JSON.parse(rawPolicy) as {
        name: string;
        expires_at?: string;
        rules: Array<{ method: string; kind?: string | number; use_count?: number }>;
    };

    const policyRecord = await prisma.policy.create({
        data: {
            name: policy.name,
            expiresAt: policy.expires_at ? new Date(policy.expires_at) : undefined,
        },
    });

    for (const rule of policy.rules ?? []) {
        await prisma.policyRule.create({
            data: {
                policyId: policyRecord.id,
                method: rule.method,
                kind: rule.kind !== undefined ? rule.kind.toString() : undefined,
                maxUsageCount: rule.use_count ?? null,
                currentUsageCount: 0,
            },
        });
    }

    const response = JSON.stringify(['ok']);
    admin.rpc.sendResponse(req.id, req.pubkey, response, 24134);
}
