export type StoredKey = {
    iv?: string;
    data?: string;
    key?: string;
};

export type AdminConfig = {
    npubs: string[];
    adminRelays: string[];
    key: string;
    secret?: string;
    notifyAdminsOnBoot?: boolean;
};

export type Nip89Config = {
    relays: string[];
};

export type WalletConfig = {
    type: 'lnbits';
    config: LnBitsWalletConfig;
};

export type LnBitsWalletConfig = {
    endpoint: string;
    adminKey: string;
};

export type DomainConfig = {
    nip05?: string;
    nip89?: Nip89Config;
    wallet?: WalletConfig;
};

export type NostrConfig = {
    relays: string[];
};

export type ConfigFile = {
    nostr: NostrConfig;
    admin: AdminConfig;
    authPort?: number;
    authHost?: string;
    baseUrl?: string;
    database?: string;
    logs?: string;
    keys: Record<string, StoredKey>;
    domains?: Record<string, DomainConfig>;
    verbose: boolean;
};
