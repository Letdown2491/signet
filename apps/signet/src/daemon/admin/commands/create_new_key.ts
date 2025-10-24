import { NDKPrivateKeySigner } from '@nostr-dev-kit/ndk';
import type { NDKRpcRequest } from '@nostr-dev-kit/ndk';
import { nip19 } from 'nostr-tools';
import AdminInterface from '../index.js';
import { createSkeletonProfile } from '../../lib/profile.js';
import { encryptSecret } from '../../../config/keyring.js';
import { loadConfig, saveConfig } from '../../../config/config.js';

export default async function createNewKey(admin: AdminInterface, req: NDKRpcRequest): Promise<void> {
    const [keyName, passphrase, providedNsec] = req.params as [string, string, string?];

    if (!keyName || !passphrase) {
        throw new Error('Missing parameters for create_new_key');
    }

    if (!admin.loadKeyMaterial) {
        throw new Error('loadKeyMaterial handler not registered');
    }

    let signer: NDKPrivateKeySigner;

    if (providedNsec) {
        const decoded = nip19.decode(providedNsec);
        if (decoded.type !== 'nsec') {
            throw new Error('Provided secret is not an nsec');
        }
        signer = new NDKPrivateKeySigner(decoded.data as string);
    } else {
        signer = NDKPrivateKeySigner.generate();
        await createSkeletonProfile(signer);
    }

    const nsec = nip19.nsecEncode(signer.privateKey!);

    const encrypted = encryptSecret(nsec, passphrase);
    const config = await loadConfig(admin.configFile);
    config.keys[keyName] = encrypted;
    await saveConfig(admin.configFile, config);

    admin.loadKeyMaterial(keyName, nsec);

    const user = await signer.user();
    const payload = JSON.stringify({ npub: user.npub });
    admin.rpc.sendResponse(req.id, req.pubkey, payload, 24134);
}
