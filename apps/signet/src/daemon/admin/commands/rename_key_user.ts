import type { NDKRpcRequest } from '@nostr-dev-kit/ndk';
import AdminInterface from '../index.js';
import prisma from '../../../db.js';

export default async function renameKeyUser(admin: AdminInterface, req: NDKRpcRequest): Promise<void> {
    const [pubkey, description] = req.params as [string, string];

    if (!pubkey || !description) {
        throw new Error('Missing parameters for rename_key_user');
    }

    const userRecord = await prisma.keyUser.findFirst({
        where: { userPubkey: pubkey },
    });

    if (!userRecord) {
        throw new Error('Key user not found');
    }

    await prisma.keyUser.update({
        where: { id: userRecord.id },
        data: { description },
    });

    admin.rpc.sendResponse(req.id, req.pubkey, JSON.stringify(['ok']), 24134);
}
