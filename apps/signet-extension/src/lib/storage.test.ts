import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  addServer,
  getActiveServer,
  getActiveServerId,
  getServers,
  labelFromUrl,
  removeServer,
  renameServer,
} from './storage';

beforeEach(() => fakeBrowser.reset());

describe('storage migration', () => {
  it('migrates a legacy single profile into a server and sets it active', async () => {
    await fakeBrowser.storage.local.set({ profile: { url: 'http://localhost:3000' } });

    const servers = await getServers();
    expect(servers).toHaveLength(1);
    expect(servers[0].url).toBe('http://localhost:3000');
    expect(servers[0].label).toBe('localhost');
    expect(await getActiveServerId()).toBe(servers[0].id);
    // legacy key is cleared
    expect((await fakeBrowser.storage.local.get('profile')).profile).toBeUndefined();
  });

  it('returns an empty list when nothing is configured', async () => {
    expect(await getServers()).toEqual([]);
    expect(await getActiveServer()).toBeNull();
  });
});

describe('storage CRUD', () => {
  it('addServer appends and makes the new one active', async () => {
    const a = await addServer({ label: 'A', url: 'http://a' });
    const b = await addServer({ label: 'B', url: 'http://b' });
    expect((await getServers()).map((s) => s.label)).toEqual(['A', 'B']);
    expect(await getActiveServerId()).toBe(b.id);
    expect((await getActiveServer())?.label).toBe('B');
    expect(a.id).not.toBe(b.id);
  });

  it('removeServer falls the active id back to a remaining server', async () => {
    const a = await addServer({ label: 'A', url: 'http://a' });
    const b = await addServer({ label: 'B', url: 'http://b' }); // active = b
    await removeServer(b.id);
    expect((await getServers()).map((s) => s.label)).toEqual(['A']);
    expect(await getActiveServerId()).toBe(a.id);
  });

  it('renameServer updates the label only', async () => {
    const a = await addServer({ label: 'A', url: 'http://a' });
    await renameServer(a.id, 'Local');
    const [s] = await getServers();
    expect(s.label).toBe('Local');
    expect(s.url).toBe('http://a');
  });

  it('getActiveServer falls back to the first server when activeId is stale', async () => {
    const a = await addServer({ label: 'A', url: 'http://a' });
    await fakeBrowser.storage.local.set({ activeProfileId: 'does-not-exist' });
    expect((await getActiveServer())?.id).toBe(a.id);
  });
});

describe('labelFromUrl', () => {
  it('uses the hostname', () => {
    expect(labelFromUrl('http://10.0.0.118:59336')).toBe('10.0.0.118');
    expect(labelFromUrl('https://signer.example.com/')).toBe('signer.example.com');
  });
  it('falls back to the raw string when unparseable', () => {
    expect(labelFromUrl('not a url')).toBe('not a url');
  });
});
