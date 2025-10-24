import debug from 'debug';
import NDK, { NDKPrivateKeySigner, NDKNostrRpc } from '@nostr-dev-kit/ndk';

const token = process.argv[2];
if (!token) {
  console.error('Usage: node send-connect.mjs <bunker-token>');
  process.exit(1);
}

const parsed = new URL(token.trim());
const bunkerPubkey = parsed.hostname || parsed.pathname.replace(/^\/\//, '');
const relays = parsed.searchParams.getAll('relay');
const secret = parsed.searchParams.get('secret') ?? undefined;

if (!bunkerPubkey) {
  console.error('Failed to parse bunker pubkey from token');
  process.exit(1);
}

if (relays.length === 0) {
  console.error('Token does not contain any relay= parameters');
  process.exit(1);
}

console.log('Using relays:', relays);
console.log('Bunker pubkey:', bunkerPubkey);
if (secret) console.log('Secret:', secret);

const ndk = new NDK({ explicitRelayUrls: relays });
const localSigner = NDKPrivateKeySigner.generate();
ndk.signer = localSigner;

ndk.pool.on('relay:connect', (relay) => console.log('Connected to', relay.url));
ndk.pool.on('relay:disconnect', (relay) => console.log('Disconnected from', relay.url));

await ndk.connect(5_000);

const rpcLogger = debug('send-connect:rpc');
const rpc = new NDKNostrRpc(ndk, localSigner, rpcLogger);

rpc.on('response', (response) => {
  console.log('Received response:', response);
  process.exit(0);
});

const params = [bunkerPubkey];
if (secret) params.push(secret);
console.log('Sending connect params:', params);

rpc.sendRequest(bunkerPubkey, 'connect', params, 24133, (response) => {
  console.log('Callback response:', response);
  process.exit(0);
});

setTimeout(() => {
  console.error('Timed out waiting for response');
  process.exit(1);
}, 15000);
