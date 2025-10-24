import type { NDKRpcResponse } from '@nostr-dev-kit/ndk';

export type RpcSuccess<T> = { ok: true; data: T };
export type RpcFailure = { ok: false; error: string };
export type RpcResult<T> = RpcSuccess<T> | RpcFailure;

export const parseRpcResponse = <T = unknown>(response: NDKRpcResponse): RpcResult<T> => {
  const rawResult = (response as any)?.result ?? null;

  if ((response as any)?.error) {
    const error = (response as any).error;
    return {
      ok: false,
      error: typeof error === 'string' ? error : JSON.stringify(error)
    };
  }

  if (rawResult === null || rawResult === undefined) {
    return { ok: false, error: 'Empty response from bunker' };
  }

  let parsed: unknown = rawResult;

  if (typeof rawResult === 'string') {
    const trimmed = rawResult.trim();
    if (!trimmed) {
      return { ok: false, error: 'Empty response from bunker' };
    }

    if (trimmed.toLowerCase() === 'ok') {
      return { ok: true, data: undefined as T };
    }

    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { ok: false, error: trimmed };
    }
  }

  if (Array.isArray(parsed)) {
    const [status, payload] = parsed as [string, unknown];

    if (status === 'error') {
      return { ok: false, error: String(payload ?? 'Unknown bunker error') };
    }

    if (status === 'ok') {
      return { ok: true, data: (payload as T) ?? (undefined as T) };
    }
  }

  if (typeof parsed === 'string') {
    return { ok: false, error: parsed };
  }

  return { ok: true, data: parsed as T };
};
