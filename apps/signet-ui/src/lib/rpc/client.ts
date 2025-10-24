import { nip19 } from 'nostr-tools';
import NDK, { NDKNostrRpc, type NDKSigner } from '@nostr-dev-kit/ndk';
import debug from 'debug';
import type { ParsedBunkerURI } from '../bunker.js';
import { parseRpcResponse } from './response.js';

export type BunkerSession = {
  ndk: NDK;
  rpc: NDKNostrRpc;
  connection: ParsedBunkerURI;
  remoteHex: string;
};

const log = debug('signet-ui:rpc');

export const connectToBunker = async (connection: ParsedBunkerURI, signer: NDKSigner): Promise<BunkerSession> => {
  const ndk = new NDK({
    explicitRelayUrls: connection.relays,
    signer
  });

  await ndk.connect(5000);
  log('Connected to relays %o', connection.relays);

  if (!ndk.signer) {
    throw new Error('Failed to initialise signer');
  }

  const rpc = new NDKNostrRpc(ndk, signer, debug('signet-ui:nip46'));

  let remoteHex: string;
  if (connection.npub.startsWith('npub')) {
    const decoded = nip19.decode(connection.npub);
    if (decoded.type !== 'npub') {
      throw new Error('Invalid npub in bunker URI');
    }
    const data = decoded.data;
    if (typeof data === 'string') {
      remoteHex = data;
    } else {
      const bytes = data as Uint8Array;
      remoteHex = [...bytes]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    }
  } else {
    remoteHex = connection.npub;
  }

  const permissions = [
    'get_public_key',
    'sign_event',
    'nip04.encrypt',
    'nip04.decrypt',
    'get_keys',
    'create_new_key',
    'get_policies',
    'create_new_policy',
    'get_key_users',
    'get_key_tokens',
    'rename_key_user',
    'unlock_key',
    'create_new_token',
    'ping'
  ];

  await new Promise<void>((resolve, reject) => {
    rpc.sendRequest(
      remoteHex,
      'connect',
      permissions,
      24133,
      (response) => {
        const parsed = parseRpcResponse(response);
        console.debug('[signet-ui] connect response', parsed);
        if (!parsed.ok) {
          reject(new Error(parsed.error));
        } else {
          resolve();
        }
      }
    );
  });

  return {
    ndk,
    rpc,
    connection,
    remoteHex
  } satisfies BunkerSession;
};

export const rpcRequest = <T = unknown>(
  session: BunkerSession,
  method: string,
  params: unknown[] = []
): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    console.debug('[signet-ui] RPC request', method, params);
    const serialized = params.map((param) =>
      typeof param === 'string' ? param : JSON.stringify(param)
    );
    session.rpc.sendRequest(
      session.remoteHex,
      method,
      serialized,
      24133,
      (response) => {
        const parsed = parseRpcResponse<T>(response);
        console.debug('[signet-ui] RPC response', method, parsed);
        if (!parsed.ok) {
          reject(new Error(parsed.error));
        } else {
          resolve(parsed.data);
        }
      }
    );
  });
};

export const disconnectSession = async (session: BunkerSession) => {
  try {
    const pool = session.ndk.pool as unknown as {
      disconnect?: () => Promise<void>;
      closeAll?: () => Promise<void>;
      relays?: Map<string, { disconnect?: () => Promise<void> }>;
    };

    if (pool?.disconnect) {
      await pool.disconnect();
    } else if (pool?.closeAll) {
      await pool.closeAll();
    } else if (pool?.relays) {
      for (const relay of pool.relays.values()) {
        await relay.disconnect?.();
      }
    }
  } catch (error) {
    log('Error disconnecting', error);
  }
};
