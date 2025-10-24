import type { NDKRpcRequest } from '@nostr-dev-kit/ndk';
import AdminInterface from '../index.js';

export default async function unlockKey(admin: AdminInterface, req: NDKRpcRequest): Promise<void> {
    const [keyName, passphrase] = req.params as [string, string];

    if (!keyName || !passphrase) {
        throw new Error('Missing parameters for unlock_key');
    }

    if (!admin.unlockKey) {
        throw new Error('Unlock key handler is not configured');
    }

    try {
        const success = await admin.unlockKey(keyName, passphrase);
        admin.rpc.sendResponse(
            req.id,
            req.pubkey,
            JSON.stringify({ success }),
            24134
        );
    } catch (error) {
        admin.rpc.sendResponse(
            req.id,
            req.pubkey,
            JSON.stringify({ success: false, error: (error as Error).message }),
            24134
        );
    }
}
