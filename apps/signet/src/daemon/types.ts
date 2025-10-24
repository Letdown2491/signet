import type { ConfigFile, StoredKey } from '../config/types.js';

export type RuntimeConfig = Omit<ConfigFile, 'keys'> & {
    keys: Record<string, string>;
};

export type DaemonBootstrapConfig = RuntimeConfig & {
    configFile: string;
    allKeys: Record<string, StoredKey>;
};
