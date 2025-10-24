import type { BunkerSession } from './client.js';
import { rpcRequest } from './client.js';

export type BunkerKey = {
  name: string;
  npub?: string;
  userCount?: number;
  tokenCount?: number;
};

export const fetchKeys = (session: BunkerSession): Promise<BunkerKey[]> => {
  return rpcRequest<BunkerKey[]>(session, 'get_keys');
};

export const createKey = (
  session: BunkerSession,
  args: { name: string; passphrase: string; nsec?: string }
) => {
  const params: string[] = [args.name, args.passphrase];
  if (args.nsec && args.nsec.trim().length > 0) {
    params.push(args.nsec.trim());
  }

  return rpcRequest<{ npub: string }>(session, 'create_new_key', params);
};
