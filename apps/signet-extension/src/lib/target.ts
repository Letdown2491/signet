import type { DaemonTarget } from './client';
import { getActiveServer } from './storage';
import { getUnlocked } from './vault';

/**
 * Build the live daemon target: the active server's URL plus its token from the
 * unlocked vault (if any). While locked, the token is undefined — fine for a
 * `requireAuth: false` server (the badge still works with a dummy bearer); a
 * hardened server simply rejects until unlocked. Falls back to the legacy single
 * token for vaults migrated from before the server switcher.
 */
export async function currentTarget(): Promise<DaemonTarget | null> {
  const server = await getActiveServer();
  if (!server) return null;
  const secrets = await getUnlocked();
  return { url: server.url, token: secrets?.tokens?.[server.id] ?? secrets?.token };
}
