import type { NDKRpcRequest } from '@nostr-dev-kit/ndk';
import AdminInterface from '../index.js';
import prisma from '../../../db.js';

export default async function revokeUser(admin: AdminInterface, req: NDKRpcRequest): Promise<void> {
    const [idString] = req.params as [string];
    const id = Number(idString);

    if (!Number.isInteger(id)) {
        throw new Error('Invalid key user identifier');
    }

    await prisma.keyUser.update({
        where: { id },
        data: {
            revokedAt: new Date(),
        },
    });

    admin.rpc.sendResponse(req.id, req.pubkey, JSON.stringify(['ok']), 24134);
}
