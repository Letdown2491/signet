export type Nip07 = {
  enable?: (options?: { appName?: string; appUrl?: string }) => Promise<void>;
  getPublicKey?: () => Promise<string>;
  requestPermissions?: (options: { permissions: Array<{ method: string }> }) => Promise<void>;
};

const PERMISSIONS = [
  { method: 'get_public_key' },
  { method: 'sign_event' },
  { method: 'nip04.encrypt' },
  { method: 'nip04.decrypt' }
];

export const getNip07 = (): Nip07 | null => {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { nostr?: Nip07 }).nostr ?? null;
};

export const connectNip07 = async (): Promise<string> => {
  const nip07 = getNip07();

  if (!nip07) {
    throw new Error('No NIP-07 browser extension detected. Install one (e.g. Alby) and refresh.');
  }

  if (typeof nip07.enable === 'function') {
    await nip07.enable({ appName: 'Signet', appUrl: window.location.origin });
  }

  if (typeof nip07.requestPermissions === 'function') {
    try {
      await nip07.requestPermissions({ permissions: PERMISSIONS });
    } catch (error) {
      console.warn('[signet-ui] requestPermissions failed', error);
    }
  }

  if (typeof nip07.getPublicKey !== 'function') {
    throw new Error('The NIP-07 extension does not implement getPublicKey().');
  }

  const pubkey = await nip07.getPublicKey();
  if (!pubkey) {
    throw new Error('Extension returned an empty public key.');
  }

  return pubkey;
};
