import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent, NDKUser, type NostrEvent } from '@nostr-dev-kit/ndk';

export async function dmUser(ndk: NDK, target: NDKUser | string, content: string): Promise<void> {
    const recipient = typeof target === 'string' ? new NDKUser({ npub: target }) : target;

    const event = new NDKEvent(ndk, {
        kind: 4,
        content,
    } as NostrEvent);

    event.tag(recipient);
    await event.encrypt(recipient);
    await event.sign();

    try {
        await event.publish();
    } catch (error) {
        console.log(`Failed to deliver DM: ${(error as Error).message}`);
    }
}
