# Signet Configuration

All runtime settings live in `signet.json`, located at `~/.signet-config/signet.json` by default. You can override this with `--config /path/to/signet.json`. On first boot, Signet auto-generates this file with secure defaults (including all required secrets). You only need to edit it to customize relays, CORS origins, or other settings.

## Example

```json
{
  "nostr": {
    "relays": [
      "wss://relay.nip46.com",
      "wss://relay.primal.net",
      "wss://relay.damus.io",
      "wss://theforest.nostr1.com",
      "wss://nostr.oxtr.dev"
    ]
  },
  "admin": {
    "key": "auto-generated",
    "secret": "auto-generated-256-bit"
  },
  "baseUrl": "http://localhost:4174",
  "database": "sqlite://signet.db",
  "logs": "./signet.log",
  "keys": {
    "alice": {
      "ncryptsec": "ncryptsec1..."
    },
    "bob": {
      "iv": "hex-iv",
      "data": "hex-cipher"
    },
    "charlie": {
      "key": "nsec1..."
    }
  },
  "jwtSecret": "auto-generated-256-bit-secret",
  "allowedOrigins": [
    "http://localhost:4174",
    "http://localhost:3000"
  ],
  "requireAuth": false,
  "verbose": false
}
```

## Keys

Keys can be stored in three formats:

- `keys.<name>.ncryptsec`: NIP-49 encrypted key (recommended). Industry-standard format using XChaCha20-Poly1305 with scrypt KDF.
- `keys.<name>.iv` + `keys.<name>.data`: Legacy AES-256-GCM encrypted key. Still supported, can be migrated to NIP-49 via the UI.
- `keys.<name>.key`: Plain nsec text (auto-starts without prompt; not recommended, keep the file private).

Encrypted keys require the passphrase at boot or can be unlocked through the admin UI. Existing keys can be migrated to NIP-49 format via the key details panel.

## Networking

- `nostr.relays`: relays watched for NIP-46 requests.

## Web Administration

All administration is done via the web UI. The following settings are required:

- `baseUrl`: public URL where the daemon is reachable (required for request approval flow).
- `authPort`: port for the REST API (binds to `0.0.0.0` to accept connections on all interfaces).

## Logging

Signet includes structured logging with timestamps, log levels, and optional JSON output.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LOG_LEVEL` | Minimum log level: `debug`, `info`, `warn`, `error` | `info` |
| `LOG_FORMAT` | Output format: `pretty` or `json` | `pretty` |

**Pretty format** (default):
```
[2024-01-15T10:30:45.123Z] INFO: Server started {"port":3000}
```

**JSON format** (for log aggregators):
```json
{"time":"2024-01-15T10:30:45.123Z","level":"info","msg":"Server started","port":3000}
```

### Systemd Log Redirection

When running under systemd, you can append logs to a file:

```ini
[Service]
StandardOutput=append:/var/log/signet/daemon.log
StandardError=append:/var/log/signet/daemon.log
```

All log entries include ISO timestamps, so you can use the default `LOG_FORMAT=pretty` for human-readable logs with full timestamps.

### `logs`

Path to the log file (legacy, use environment variables instead).

- **Type**: string
- **Default**: `./signet.log`

### `verbose`

Enable verbose logging for debugging.

- **Type**: boolean
- **Default**: `false`

When `true`, outputs detailed debug information including NIP-46 request/response details and relay connection events.

## Security Settings

### `jwtSecret`

Secret key used to sign JWT authentication tokens for the REST API.

- **Type**: string (hex-encoded)
- **Default**: Auto-generated 256-bit secret on first run
- **Recommendation**: Let Signet generate this automatically. If you need to set it manually, use at least 32 bytes of cryptographically random data.

```bash
# Generate a secure secret manually
openssl rand -hex 32
```

### `allowedOrigins`

List of origins allowed to make cross-origin requests to the API. This controls the CORS `Access-Control-Allow-Origin` header.

- **Type**: array of strings
- **Default**: `["http://localhost:4174", "http://localhost:3000", "http://127.0.0.1:4174", "http://127.0.0.1:3000"]`

For production, set this to your actual UI domain(s):

```json
{
  "allowedOrigins": [
    "https://signet.example.com",
    "https://admin.example.com"
  ]
}
```

Supported patterns:
- Exact match: `"https://app.example.com"`
- Wildcard subdomain: `"*.example.com"` (matches `app.example.com`, `admin.example.com`, etc.)
- Wildcard all (not recommended): `"*"`

### `requireAuth`

Require JWT authentication for all API endpoints.

- **Type**: boolean
- **Default**: `false`

When `false` (default), the API is open for local development. Set to `true` for production deployments where you want to enforce authentication.

```json
{
  "requireAuth": true
}
```

### `SIGNET_API_TOKEN` (Environment Variable)

API token for server-to-server authentication between the UI proxy and the daemon.

- **Type**: string (hex-encoded)
- **Required**: Yes (for UI deployment)
- **Location**: Environment variable (not in config file)

Both the daemon and UI server must be configured with the same token for secure communication. Generate a secure token:

```bash
# Generate a secure API token
openssl rand -hex 32
```

Set this token in your environment or `.env` file:

```bash
SIGNET_API_TOKEN=your_generated_token_here
```

**Security Model:**

The `SIGNET_API_TOKEN` provides **proxy authentication** - it verifies that requests are coming from your trusted UI proxy server. This token:

1. ✅ Authenticates the UI proxy server identity
2. ⚠️ **Does NOT bypass user authentication** - the browser must still have a valid JWT session
3. ⚠️ **Does NOT bypass CSRF protection** - state-changing requests still require CSRF tokens
4. ⚠️ **Does NOT bypass rate limiting** - rate limits still apply

When a request arrives at the daemon:
- First, the daemon validates the `X-API-Token` header matches the configured token (proxy authentication)
- Then, the daemon validates the user's JWT session from cookies/headers (user authentication)
- Finally, CSRF tokens and rate limiting are enforced as normal

This layered approach ensures that even if the API token leaks, attackers cannot bypass user authentication or perform unauthorized actions.

### `admin.secret`

Secret included in the bunker connection URI. Used to validate connection attempts from NIP-46 clients.

- **Type**: string (hex-encoded)
- **Default**: Auto-generated 256-bit secret on first run
- **Note**: This is separate from `jwtSecret` which is used for REST API auth.
- **Behavior**: The secret validates that a client has the correct bunker URI, but does **not** auto-approve the connection. All first-time connections require manual approval via the UI, where you select a trust level. Invalid secrets are silently rejected.

### `killSwitch`

Emergency remote control via Nostr DMs. Allows you to lock keys and suspend apps when you can't access the web UI.

- **Type**: object (optional)
- **Default**: Not configured (disabled)

```json
{
  "killSwitch": {
    "adminNpub": "npub1youradminnpubhere...",
    "adminRelays": ["wss://relay.damus.io", "wss://nos.lol"],
    "dmType": "NIP17"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `adminNpub` | string | Your admin npub - only DMs from this pubkey are accepted |
| `adminRelays` | string[] | Relays to listen for admin DMs |
| `dmType` | `NIP04` \| `NIP17` | DM encryption protocol (NIP-17 recommended for privacy) |

See **[Kill Switch Guide](KILLSWITCH.md)** for full command reference, usage examples, and troubleshooting.

## Rate Limiting

The API includes built-in rate limiting for sensitive endpoints:

| Endpoint Category | Limit | Block Duration |
|-------------------|-------|----------------|
| Request Approval (`POST /requests/:id`) | 10 req/min | 1 minute |
| Key Management (`POST /keys`, `DELETE /keys/:name`) | 10 req/min | 1 minute |
| Batch Operations (`POST /requests/batch`) | 10 req/min | 1 minute |

Rate limits are per-IP address. After exceeding the limit, requests receive HTTP 429 with a `Retry-After` header.

## Environment Variables

Docker Compose works out of the box with no `.env` file required. To customize settings, set these environment variables before running `docker compose`:

```bash
# Customize ports
SIGNET_PORT=3001 UI_PORT=8080 docker compose up --build

# Or set explicit URLs for complex networking
SIGNET_URL=http://signet.local:3000 UI_URL=https://ui.example.com docker compose up --build
```

### Daemon Variables (`signet`)

| Variable | Description | Default |
|----------|-------------|---------|
| `SIGNET_BIND_ADDRESS` | Network interface to bind to | `0.0.0.0` (all interfaces) |
| `SIGNET_HOST` | Hostname where daemon is accessible | `localhost` (or `signet` in Docker) |
| `SIGNET_PORT` | Port for the REST API | `3000` |
| `UI_HOST` | Hostname where UI is accessible (used for `UI_URL` if not set) | `localhost` |
| `UI_PORT` | Port where UI is accessible (used for `UI_URL` if not set) | `4174` |
| `UI_URL` | Public URL of the UI (for authorization flow). Defaults to `http://${UI_HOST}:${UI_PORT}` | `http://localhost:4174` |
| `DATABASE_URL` | SQLite database path | `file:~/.signet-config/signet.db` |
| `SIGNET_LOCAL` | Set to `1` for local development (uses relative DB path) | (not set) |
| `NODE_ENV` | Set to `development` for dev mode | `production` |
| `LOG_LEVEL` | Log level: `debug`, `info`, `warn`, `error` | `info` |
| `LOG_FORMAT` | Log format: `pretty` or `json` | `pretty` |

### UI Variables (`signet-ui`)

| Variable | Description | Default |
|----------|-------------|---------|
| `UI_BIND_ADDRESS` | Network interface to bind to | `0.0.0.0` (all interfaces) |
| `UI_PORT` | Port for the React UI | `4174` |
| `SIGNET_HOST` | Hostname where daemon is accessible (used for `SIGNET_URL` if not set) | `localhost` (or `signet` in Docker) |
| `SIGNET_PORT` | Port where daemon is accessible (used for `SIGNET_URL` if not set) | `3000` |
| `SIGNET_URL` | Internal URL to reach the daemon. Defaults to `http://${SIGNET_HOST}:${SIGNET_PORT}` | `http://localhost:3000` |

**How the services communicate:**
- **UI → Daemon**: The UI uses `SIGNET_URL` to proxy API requests to the daemon
- **Daemon → User**: The daemon uses `UI_URL` to send authorization redirect URLs

**Network binding:**
- Both services bind to `0.0.0.0` (all interfaces) by default
- Use `SIGNET_BIND_ADDRESS` and `UI_BIND_ADDRESS` to bind to specific interfaces (e.g., `127.0.0.1` for localhost only, or a Tailscale IP like `100.x.x.x`)
- The `*_HOST` and `*_PORT` variables are used to construct the URLs for service discovery, not for binding

**Example use cases:**
```bash
# Bind to Tailscale interface only
SIGNET_BIND_ADDRESS=100.101.102.103 UI_BIND_ADDRESS=100.101.102.103 docker compose up

# Localhost only (not accessible from network)
SIGNET_BIND_ADDRESS=127.0.0.1 UI_BIND_ADDRESS=127.0.0.1 docker compose up
```

> **Note:** The `authHost` config field is no longer used.

All other settings are configured in `signet.json`.

---

For deployment guides (Tailscale, reverse proxies, etc.), see [DEPLOYMENT.md](DEPLOYMENT.md).
