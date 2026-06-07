/**
 * Resolution of the HTTP server's network binding.
 *
 * Precedence is, consistently for every setting: an explicit environment variable
 * (deployment-time override) > the value persisted in the config file > a built-in
 * default. This matches 12-factor expectations and, importantly, lets the Docker
 * image's SIGNET_HOST=0.0.0.0 take effect even though loadConfig() persists an
 * `authHost` default into signet.json (which previously shadowed the env var and
 * left the daemon bound to container-loopback, unreachable from outside).
 *
 * Both the current (SIGNET_HOST/PORT, EXTERNAL_URL) and legacy (AUTH_HOST/PORT,
 * BASE_URL) env names are honoured, current taking priority.
 */

export interface ServerBindingConfig {
    authHost?: string;
    authPort?: number;
    baseUrl?: string;
}

export interface ServerBinding {
    host: string;
    /** undefined means "no port configured" → HTTP server disabled. */
    port: number | undefined;
    baseUrl: string | undefined;
}

const DEFAULT_HOST = '127.0.0.1';

/**
 * Return the first value that is neither undefined nor blank.
 * Treating empty strings as unset matters for env files like `SIGNET_HOST=`.
 */
function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
    for (const value of values) {
        if (value !== undefined && value.trim() !== '') {
            return value.trim();
        }
    }
    return undefined;
}

export function resolveServerBinding(
    config: ServerBindingConfig,
    env: NodeJS.ProcessEnv = process.env,
): ServerBinding {
    const host = firstNonEmpty(env.SIGNET_HOST, env.AUTH_HOST, config.authHost) ?? DEFAULT_HOST;

    const portEnv = firstNonEmpty(env.SIGNET_PORT, env.AUTH_PORT);
    let port: number | undefined;
    if (portEnv !== undefined) {
        const parsed = Number.parseInt(portEnv, 10);
        // Fall back to the config value when the env var is set but not a valid port.
        port = Number.isInteger(parsed) ? parsed : config.authPort;
    } else {
        port = config.authPort;
    }

    const baseUrl = firstNonEmpty(env.EXTERNAL_URL, env.BASE_URL, config.baseUrl);

    return { host, port, baseUrl };
}
