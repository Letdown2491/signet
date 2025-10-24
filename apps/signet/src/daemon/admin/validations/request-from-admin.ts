import { nip19 } from 'nostr-tools';
import type { NDKRpcRequest } from '@nostr-dev-kit/ndk';

export function decodeNpubs(npubs: string[]): string[] {
    const hexKeys: string[] = [];

    for (const npub of npubs) {
        try {
            const decoded = nip19.decode(npub);
            if (decoded.type === 'npub') {
                hexKeys.push(decoded.data as string);
            }
        } catch {
            // ignore invalid npubs
        }
    }

    return hexKeys;
}

export async function validateAdminRequest(req: NDKRpcRequest, allowedNpubs: string[]): Promise<boolean> {
    if (!req.pubkey) {
        return false;
    }

    const allowedHex = decodeNpubs(allowedNpubs);
    return allowedHex.includes(req.pubkey);
}
