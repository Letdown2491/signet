export type ConnectionInfo = {
  npub: string;
  pubkey: string;
  npubUri: string;
  hexUri: string;
  relays: string[];
  secret?: string | null;
  nostrRelays: string[];
};

function resolveConnectionInfoUrl(): string {
  const fromEnv = import.meta.env.VITE_BUNKER_INFO_URL;
  if (fromEnv && typeof fromEnv === 'string') {
    return fromEnv;
  }

  try {
    const current = new URL(window.location.href);
    current.port = '3000';
    current.pathname = '/connection';
    current.search = '';
    current.hash = '';
    return current.toString();
  } catch {
    return 'http://localhost:3000/connection';
  }
}

export async function fetchConnectionInfo(): Promise<ConnectionInfo | null> {
  const url = resolveConnectionInfoUrl();

  try {
    const response = await fetch(url, {
      credentials: 'include'
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as ConnectionInfo;

    if (!payload?.npubUri) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}
