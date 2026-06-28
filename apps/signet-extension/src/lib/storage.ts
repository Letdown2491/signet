import { browser } from '#imports';

/**
 * A configured Signet server (daemon). The URL/label are non-secret and live in
 * plaintext `storage.local` so the background can reach the active server (for
 * the badge) even while locked. A server's optional `requireAuth` token lives
 * encrypted in the PIN vault (keyed by server id), never here.
 */
export interface Server {
  id: string;
  label: string;
  url: string;
}

// Storage keys keep their original names for backward compatibility with data
// already written before the "Server" rename.
const SERVERS_KEY = 'profiles';
const ACTIVE_KEY = 'activeProfileId';
const LEGACY_SINGLE_KEY = 'profile';

export async function getServers(): Promise<Server[]> {
  const res = await browser.storage.local.get([SERVERS_KEY, LEGACY_SINGLE_KEY]);
  const servers = res[SERVERS_KEY] as Server[] | undefined;
  if (servers) return servers;

  // Migrate a pre-switcher single server { url } into the list.
  const legacy = res[LEGACY_SINGLE_KEY] as { url: string } | undefined;
  if (legacy?.url) {
    const migrated: Server = { id: newId(), label: labelFromUrl(legacy.url), url: legacy.url };
    await browser.storage.local.set({ [SERVERS_KEY]: [migrated], [ACTIVE_KEY]: migrated.id });
    await browser.storage.local.remove(LEGACY_SINGLE_KEY);
    return [migrated];
  }
  return [];
}

export async function getActiveServerId(): Promise<string | null> {
  const res = await browser.storage.local.get(ACTIVE_KEY);
  return (res[ACTIVE_KEY] as string | undefined) ?? null;
}

export async function getActiveServer(): Promise<Server | null> {
  const servers = await getServers();
  if (servers.length === 0) return null;
  const activeId = await getActiveServerId();
  return servers.find((s) => s.id === activeId) ?? servers[0];
}

export async function setActiveServer(id: string): Promise<void> {
  await browser.storage.local.set({ [ACTIVE_KEY]: id });
}

/** Append a server and make it active. */
export async function addServer(input: { label: string; url: string }): Promise<Server> {
  const servers = await getServers();
  const server: Server = { id: newId(), label: input.label, url: input.url };
  await browser.storage.local.set({
    [SERVERS_KEY]: [...servers, server],
    [ACTIVE_KEY]: server.id,
  });
  return server;
}

export async function removeServer(id: string): Promise<void> {
  const servers = await getServers();
  const remaining = servers.filter((s) => s.id !== id);
  const updates: Record<string, unknown> = { [SERVERS_KEY]: remaining };
  if ((await getActiveServerId()) === id) updates[ACTIVE_KEY] = remaining[0]?.id ?? null;
  await browser.storage.local.set(updates);
}

export async function renameServer(id: string, label: string): Promise<void> {
  const servers = await getServers();
  await browser.storage.local.set({
    [SERVERS_KEY]: servers.map((s) => (s.id === id ? { ...s, label } : s)),
  });
}

export function labelFromUrl(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

function newId(): string {
  return crypto.randomUUID();
}
