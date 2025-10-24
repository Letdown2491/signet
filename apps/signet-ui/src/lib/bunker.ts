export type ParsedBunkerURI = {
  protocol: string;
  npub: string;
  relays: string[];
  secret?: string;
};

const normaliseRelay = (relay: string): string => {
  let value = relay.trim();
  if (!value) return '';
  const lower = value.toLowerCase();
  const schemeIndex = lower.indexOf('://');
  if (schemeIndex !== -1) {
    value = value.slice(schemeIndex + 3);
  }

  value = value.replace(/^\/+/g, '');
  if (!value) return '';

  return `wss://${value}`;
};

export const parseBunkerURI = (uri: string): ParsedBunkerURI | null => {
  if (!uri) {
    return null;
  }
  const input = uri.trim();
  if (!input) {
    return null;
  }

  try {
    const parsed = new URL(input);
    const protocol = parsed.protocol.replace(':', '').toLowerCase();
    if (protocol !== 'bunker') {
      return null;
    }

    if (parsed.username) {
      throw new Error('legacy-bunker-uri');
    }

    let identifier = parsed.hostname || '';
    if (!identifier && parsed.pathname) {
      identifier = parsed.pathname.replace(/^\/+/, '');
    }
    if (!identifier) {
      identifier = parsed.host;
    }
    if (!identifier) {
      return null;
    }

    const relays = parsed.searchParams
      .getAll('relay')
      .map((relay) => normaliseRelay(relay))
      .filter(Boolean);

    const secret = parsed.searchParams.get('secret') ?? undefined;

    return {
      protocol,
      npub: identifier,
      relays,
      secret: secret && secret.length > 0 ? secret : undefined
    };
  } catch (error) {
    const legacyRegex = /^(.*?):\/\/([^@\s]+)(?:@(.+))?$/i;
    const match = input.match(legacyRegex);
    if (!match) {
      return null;
    }

    const [, protocol, npub, relaySegment] = match;
    const relays = relaySegment
      ? relaySegment
          .split(',')
          .map((relay) => normaliseRelay(decodeURIComponent(relay)))
          .filter(Boolean)
      : [];

    return {
      protocol: protocol.toLowerCase(),
      npub,
      relays
    };
  }
};
