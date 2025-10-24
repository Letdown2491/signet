import 'websocket-polyfill';
import NDK, {
    NDKEvent,
    NDKNip46Signer,
    NDKPrivateKeySigner,
    NDKUser,
    type NostrEvent,
} from '@nostr-dev-kit/ndk';
import fs from 'fs';
import path from 'path';

const argv = process.argv.slice(2);
const command = argv[0];
let remoteTarget = argv[1];
let payload = argv[2];

const dontPublish = process.argv.includes('--dont-publish');
const debug = process.argv.includes('--debug');

function extractRelays(): string[] {
    const index = process.argv.indexOf('--relays');
    if (index === -1 || !process.argv[index + 1]) {
        return [];
    }
    return process.argv[index + 1].split(',').map((relay) => relay.trim()).filter(Boolean);
}

const extraRelays = extractRelays();

if (!command || !remoteTarget) {
    console.log('Usage: node client <command> <remote-npub-or-nip05-or-bunker-token> <content> [--dont-publish] [--debug] [--relays <relay1,relay2>]');
    console.log('');
    console.log('\tcommand: sign | create_account');
    console.log('\tcontent (sign): JSON event or text for kind 1');
    console.log('\tcontent (create_account): username[,domain[,email]]');
    process.exit(1);
}

const bunkerToken = remoteTarget.startsWith('bunker://') ? remoteTarget : undefined;
let bunkerRelays: string[] = [];
if (bunkerToken) {
    try {
        const parsed = new URL(bunkerToken.trim());
        bunkerRelays = parsed.searchParams.getAll('relay').map((relay) => decodeURIComponent(relay));
        if (bunkerRelays.length === 0) {
            throw new Error('No relays found in bunker token');
        }
    } catch (error) {
        console.log(`❌ Invalid bunker token: ${(error as Error).message}`);
        process.exit(1);
    }
}

function keyStorageDir(): string {
    const home = process.env.HOME ?? process.env.USERPROFILE;
    if (!home) {
        throw new Error('Unable to locate HOME directory');
    }
    return path.join(home, '.signet-client-private.key');
}

function loadPrivateKey(): string | undefined {
    try {
        return fs.readFileSync(path.join(keyStorageDir(), 'private.key'), 'utf8').trim();
    } catch {
        return undefined;
    }
}

function persistPrivateKey(key: string): void {
    const dir = keyStorageDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'private.key'), key);
}

function buildRelays(defaultsOverride: string[] = []): string[] {
    const defaults = defaultsOverride.length
        ? defaultsOverride
        : [
              'wss://relay.damus.io',
              'wss://relay.primal.net',
              'wss://nost.lol',
          ];
    return [...defaults, ...extraRelays];
}

async function resolveRemoteUser(ndk: NDK): Promise<NDKUser> {
    if (remoteTarget.includes('@') && !remoteTarget.startsWith('npub')) {
        const user = await NDKUser.fromNip05(remoteTarget, ndk);
        if (!user) {
            throw new Error(`Unable to resolve ${remoteTarget}`);
        }
        remoteTarget = user.npub;
        return user;
    }

    return new NDKUser({ npub: remoteTarget });
}

async function prepareCreateAccount(ndk: NDK): Promise<NDKUser> {
    if (remoteTarget.startsWith('npub')) {
        return new NDKUser({ npub: remoteTarget });
    }

    const [username, domain, email] = (payload ?? '').split(',').map((value) => value.trim());
    const targetDomain = domain || remoteTarget;
    const targetUsername = username || Math.random().toString(36).slice(2, 12);

    payload = [targetUsername, targetDomain, email ?? ''].join(',');

    const identifiers = new Set([`_@${targetDomain}`]);
    if (remoteTarget.includes('@')) {
        identifiers.add(remoteTarget);
    }

    for (const identifier of identifiers) {
        const candidate = await NDKUser.fromNip05(identifier, ndk);
        if (candidate) {
            remoteTarget = candidate.npub;
            return candidate;
        }
    }

    throw new Error(`Unable to resolve ${remoteTarget}`);
}

async function createNdk(relaysOverride: string[] = []): Promise<NDK> {
    const ndk = new NDK({
        explicitRelayUrls: buildRelays(relaysOverride),
        enableOutboxModel: false,
    });

    if (debug) {
        ndk.pool.on('relay:disconnect', (relay) => console.log(`❌ disconnected from ${relay.url}`));
    }

    await ndk.connect(5_000);
    return ndk;
}

async function ensureLocalSigner(): Promise<NDKPrivateKeySigner> {
    const existing = loadPrivateKey();
    if (existing) {
        return new NDKPrivateKeySigner(existing);
    }

    const generated = NDKPrivateKeySigner.generate();
    persistPrivateKey(generated.privateKey!);
    return generated;
}

async function signCommand(ndk: NDK, signer: NDKNip46Signer): Promise<void> {
    if (debug) {
        console.log('Waiting for authorization…');
    }

    const remoteUser = await signer.blockUntilReady();
    if (debug) {
        console.log(`Remote user: ${remoteUser.npub}`);
    }

    let event: NDKEvent;
    try {
        const parsed = JSON.parse(payload ?? '{}');
        event = new NDKEvent(ndk, parsed as NostrEvent);
        if (!event.kind) {
            throw new Error('Event kind missing');
        }
        event.tags ??= [];
        event.content ??= '';
    } catch (error) {
        const nostrEvent: NostrEvent = {
            kind: 1,
            content: payload ?? '',
            tags: [['client', 'signet-client']],
        };
        event = new NDKEvent(ndk, nostrEvent);
    }

    await event.sign();
    if (debug) {
        console.log(JSON.stringify(event.rawEvent(), null, 2));
    } else {
        console.log(event.sig);
    }

    if (!dontPublish) {
        await event.publish();
    }
}

async function createAccountCommand(signer: NDKNip46Signer): Promise<void> {
    const [username, domain, email] = (payload ?? '').split(',').map((value) => value.trim());
    const pubkey = await signer.createAccount(username, domain, email);
    const created = new NDKUser({ pubkey });
    console.log(`Account created: ${created.npub}`);
}

(async () => {
    try {
        const ndk = await createNdk(bunkerRelays);
        const localSigner = await ensureLocalSigner();

        if (debug) {
            const localUser = await localSigner.user();
            console.log(`Local signer: ${localUser.npub}`);
        }

        let nip46Signer: NDKNip46Signer;

        if (bunkerToken) {
            if (command === 'create_account') {
                console.log('❌ bunker tokens cannot be used with create_account');
                process.exit(1);
            }
            nip46Signer = NDKNip46Signer.bunker(ndk, bunkerToken, localSigner);
        } else {
            const remoteUser =
                command === 'create_account' ? await prepareCreateAccount(ndk) : await resolveRemoteUser(ndk);

            if (debug) {
                console.log(`Remote signer: ${remoteUser.npub}`);
            }

            nip46Signer = new NDKNip46Signer(ndk, remoteUser.pubkey, localSigner);
        }

        nip46Signer.on('authUrl', (url: string) => {
            console.log(`Authorize this request at ${url}`);
        });

        switch (command) {
            case 'sign':
                await signCommand(ndk, nip46Signer);
                break;
            case 'create_account':
                await createAccountCommand(nip46Signer);
                break;
            default:
                console.log(`Unknown command "${command}"`);
                process.exit(1);
        }
    } catch (error) {
        console.log(`❌ ${(error as Error).message}`);
        process.exit(1);
    }
})();
