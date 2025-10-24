import type { BunkerSession } from './client.js';
import { rpcRequest } from './client.js';

export type PolicyRule = {
  method: string;
  kind?: string;
  use_count?: number;
};

export type Policy = {
  id?: string;
  name: string;
  description?: string | null;
  expires_at?: string | null;
  rules: PolicyRule[];
};

export const fetchPolicies = (session: BunkerSession): Promise<Policy[]> => {
  return rpcRequest<Policy[]>(session, 'get_policies');
};

export const createPolicy = (
  session: BunkerSession,
  policy: Policy
) => {
  const payload = JSON.stringify({
    name: policy.name,
    expires_at: policy.expires_at ?? null,
    rules: policy.rules.map((rule) => ({
      method: rule.method,
      kind: rule.kind ?? 'all',
      use_count: rule.use_count ?? null
    }))
  });

  return rpcRequest(session, 'create_new_policy', [payload]);
};
