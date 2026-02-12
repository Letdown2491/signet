# Security Model

The premise of Signet is that you can store Nostr private keys (nsecs), use them remotely under certain policies, but these keys can never be exfiltrated from the bunker. All communication with Signet happens through encrypted, ephemeral Nostr events following the NIP-46 protocol.

## Keys

Within Signet there are two distinct sets of keys:

### User keys

The keys that users want to sign with. These keys are stored encrypted with a passphrase using one of two formats:

- **NIP-49 (recommended)**: XChaCha20-Poly1305 authenticated encryption with scrypt key derivation. Industry-standard format compatible with other Nostr tools.
- **Legacy AES-256-GCM**: PBKDF2 key derivation with 600,000 iterations. Still supported for backwards compatibility.

Every time you start Signet, you must enter the passphrase to decrypt the key. Without this passphrase, keys cannot be used. The authenticated encryption ensures that any tampering with the encrypted data is detected.

### Signet's admin key

Signet generates its own private key, which is used for NIP-46 bunker communication. If this key is compromised, no user key material is at risk.

Administration is performed via the web UI or Android app, both of which require JWT authentication. The UI should be secured via network-level access control through VPN/WireGuard/Tailscale, firewall rules, or reverse proxy authentication. For emergency situations when you can't access the UI, the [kill switch](KILLSWITCH.md) allows remote control via Nostr DMs.

We recommend running Signet on a locally trusted machine behind a VPN.

## NIP-46 (Nostr Connect)

Signet listens on configured relays, specified in `signet.json`, for NIP-46 requests from applications attempting to use the target keys.

## REST API Security

The REST API provides management functionality for the web dashboard. It implements multiple security layers:

### Authentication

All sensitive endpoints require JWT (JSON Web Token) authentication:

- Tokens are signed using HMAC-SHA256 with a 256-bit secret (`jwtSecret` in config)
- Tokens expire after 7 days
- Tokens are transmitted via HTTP-only, secure, same-site cookies

Protected endpoints include:
- `GET /connection` - Bunker connection info
- `GET /keys` - List all keys
- `POST /keys` - Create new keys
- `POST /keys/:name/unlock` - Unlock an encrypted key
- `POST /keys/:name/lock` - Lock a key (clears decrypted material from memory)
- `DELETE /keys/:name` - Delete a key
- `GET /apps` - List connected applications
- `POST /apps/:id/revoke` - Revoke application access
- `POST /apps/:id/suspend` - Suspend an application
- `POST /apps/:id/unsuspend` - Resume a suspended application
- `PATCH /apps/:id` - Update application settings
- `GET /requests` - List authorization requests
- `POST /requests/:id` - Approve a request
- `DELETE /requests/:id` - Deny a request
- `POST /requests/batch` - Batch approve multiple requests
- `GET /events` - Server-sent events stream for real-time updates
- `GET /dashboard` - Dashboard statistics
- `GET /admin/activity` - Admin activity audit log
- `GET /health` - Daemon health status
- `GET /csrf-token` - Obtain CSRF token for state-changing requests

### CORS (Cross-Origin Resource Sharing)

CORS is restricted to explicitly configured origins:

- Only origins listed in `allowedOrigins` can make cross-origin requests
- Credentials (cookies) are only sent to allowed origins
- Wildcard origins are supported but not recommended for production

### CSRF Protection

State-changing API endpoints are protected against Cross-Site Request Forgery using the double-submit cookie pattern:

1. **Token Generation**: Client fetches a CSRF token via `GET /csrf-token`
2. **Cookie Storage**: Token is set in a non-HttpOnly cookie (`signet_csrf`)
3. **Header Submission**: Client includes the token in `X-CSRF-Token` header for state-changing requests
4. **Validation**: Server compares cookie and header using timing-safe comparison

Protected methods: POST, PUT, DELETE, PATCH

**Bearer Token Exemption**: API clients using Bearer token authentication (`Authorization: Bearer <token>`) are exempt from CSRF protection. This is secure because CSRF attacks exploit the browser's automatic cookie sending behavior, which doesn't apply to Bearer tokens that must be explicitly included by the client.

The following endpoints require CSRF tokens:
- `POST /keys` - Create new keys
- `POST /keys/:name/unlock` - Unlock encrypted keys
- `POST /keys/:name/lock` - Lock keys
- `DELETE /keys/:name` - Delete keys
- `POST /apps/:id/revoke` - Revoke application access
- `POST /apps/:id/suspend` - Suspend applications
- `POST /apps/:id/unsuspend` - Resume applications
- `PATCH /apps/:id` - Update application settings
- `POST /requests/:id` - Approve requests
- `DELETE /requests/:id` - Deny requests
- `POST /requests/batch` - Batch approve requests

### Rate Limiting

Sensitive endpoints are rate-limited to prevent brute-force attacks:

- 10 requests per minute per IP address
- 1-minute lockout after exceeding the limit
- Rate limits apply to:
  - Request approval (`POST /requests/:id`)
  - Key management (`POST /keys`, `DELETE /keys/:name`)
  - Batch operations (`POST /requests/batch`)

### Input Validation

- Callback URLs are validated to prevent XSS (only `http://` and `https://` allowed)
- Error messages are HTML-escaped before rendering
- JSON parsing uses safe defaults

## Encryption Details

### Key Encryption

Signet supports two encryption formats for user keys:

#### NIP-49 (Recommended)

The industry-standard format for encrypted Nostr keys:

- **Algorithm**: XChaCha20-Poly1305 (authenticated encryption)
- **Key derivation**: scrypt (N=2^16, r=8, p=1)
- **Salt**: 16 bytes, randomly generated per key
- **Nonce**: 24 bytes, randomly generated per encryption
- **Format**: Bech32-encoded `ncryptsec1...` string

NIP-49 keys are portable and can be imported/exported to other Nostr tools that support the format.

#### Legacy AES-256-GCM

The original Signet encryption format:

- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key derivation**: PBKDF2-HMAC-SHA256
- **Iterations**: 600,000
- **Salt**: 16 bytes, randomly generated per key
- **IV/Nonce**: 12 bytes, randomly generated per encryption
- **Auth tag**: 16 bytes (automatically verified on decryption)

Legacy keys can be migrated to NIP-49 format via the key details panel in the UI. Keys encrypted with AES-256-CBC (from nsecbunkerd) are also automatically detected and supported.

### Secret Generation

All secrets (JWT secret, admin secret) are generated using Node.js `crypto.randomBytes()`:

- **Length**: 32 bytes (256 bits)
- **Encoding**: Hexadecimal (64 characters)

## One-Time Connection Tokens

When sharing a bunker URI to connect a new application, Signet generates one-time tokens instead of exposing the persistent `admin.secret`.

### How It Works

1. **Token Generation**: When you click "Generate bunker URI" in the UI (web or Android), Signet creates a fresh 32-byte random token
2. **Short Expiry**: Tokens expire after 5 minutes
3. **Single Use**: Tokens are atomically redeemed on first use—a second connection attempt with the same token will fail
4. **Session Persistence**: Once a client successfully connects, their pubkey is stored in the database. Future requests are identified by pubkey, not the token

### Security Benefits

- **No persistent secret exposure**: The `admin.secret` is never shown in the UI
- **Limited window**: Even if a bunker URI is intercepted, the attacker has only 5 minutes to use it
- **No replay**: Using the same token twice is impossible due to atomic redemption
- **Backwards compatible**: Existing connections using `admin.secret` continue to work

### Implementation Details

- **Token storage**: `ConnectionToken` table in SQLite with `keyName`, `token`, `expiresAt`, `redeemedAt`
- **Atomic redemption**: Uses database `updateMany` with `redeemedAt: null` condition to prevent race conditions
- **Cleanup**: Expired tokens are automatically deleted hourly
- **Validation order**: One-time tokens are checked first, then `admin.secret` as fallback

### Fallback Behavior

The persistent `admin.secret` (configured in `signet.json`) still works for backwards compatibility:

- Clients that already have a bunker URI with `admin.secret` can still connect
- If a one-time token is invalid or expired, Signet falls back to checking `admin.secret`
- New connections via the UI always use one-time tokens

## NostrConnect (App-Initiated Connections)

While bunker:// URIs are generated by Signet, nostrconnect:// URIs are generated by the connecting app. This is the reverse flow defined in NIP-46.

### How It Works

1. **App generates URI**: The Nostr app creates a nostrconnect:// URI containing its pubkey, relays, and a one-time secret
2. **User pastes/scans URI**: User enters the URI in Signet (web or Android)
3. **Signet validates**: Parses URI, validates format, checks for duplicates
4. **User approves**: User selects a key and trust level
5. **Signet responds**: Sends NIP-46 `connect` response to the app via the specified relays
6. **App receives ACK**: Connection is established

### Security Considerations

- **User-initiated**: Connections only happen when the user explicitly pastes/scans a URI
- **Trust level required**: User must select a trust level before the connection is accepted
- **Duplicate detection**: Signet rejects connection attempts from already-connected apps
- **Per-app relays**: Each app can specify its own relays for NIP-46 communication
- **No secret storage**: The app's one-time secret is used only for the initial handshake

### URI Components

| Component | Required | Description |
|-----------|----------|-------------|
| Client pubkey | Yes | 64-character hex pubkey of the connecting app |
| `relay` | Yes | One or more relay URLs for communication |
| `secret` | Yes | One-time secret for initial handshake |
| `perms` | No | Permissions the app requests (informational only) |
| `name` | No | App name suggested by the client |

### Per-App Relay Subscriptions

Apps connected via nostrconnect:// can use their own relays:

- Signet creates NIP-46 subscriptions on the app's specified relays
- Responses are published to both Signet's relays AND the app's relays
- Subscriptions are automatically cleaned up when apps are revoked

## Key Locking

Encrypted keys can be locked at any time without restarting the daemon. When a key is locked:

- The decrypted key material is cleared from memory
- All NIP-46 requests for that key are rejected
- The key remains locked until manually unlocked with the passphrase

This allows you to temporarily disable signing for a key without deleting it or stopping the daemon.

**Lock sources:**
- Web UI (click lock icon in sidebar or Keys page)
- Android app (key detail sheet)
- Kill switch DM commands (`lock <keyname>` or `lockall keys`)

## App Suspension

Connected applications can be suspended to temporarily block their access:

- **Indefinite suspension**: App remains suspended until manually resumed
- **Timed suspension**: App is automatically resumed after a specified time

Suspended apps receive rejection responses for all NIP-46 requests. This is useful when you suspect an app has been compromised or want to temporarily revoke access without deleting the app's permissions.

**Suspension sources:**
- Web UI (Apps page)
- Android app (app detail sheet)
- Kill switch DM commands (`suspend <appname>` or `suspendall apps`)

## Inactivity Lock (Dead Man's Switch)

Signet includes an optional Inactivity Lock feature that automatically triggers a security lockdown if you don't check in within a configurable timeframe.

**How It Works:**

1. Enable Inactivity Lock in Settings (Web UI or Android app)
2. Configure the timeframe (1 hour to 30 days, default 7 days)
3. The timer counts down continuously
4. If the timer expires without a reset, all keys are locked and all apps are suspended
5. To recover, you must unlock a key with its passphrase

**Timer Reset:**

The timer is automatically reset when you:
- Click "Reset Timer" in Settings
- Use the "Lock Now" button in System Status (which triggers panic, then you can recover)

**Panic State:**

When the timer expires (or you manually trigger "Lock Now"):
- All active keys are immediately locked
- All connected apps are suspended
- The UI shows a lock screen overlay
- Only a valid passphrase can recover the system

**Use Cases:**

- **Travel**: If you're unreachable for an extended period, your keys are automatically secured
- **Incapacitation**: Keys are protected if you can't access the system
- **Theft prevention**: Even if an attacker gains device access, keys lock after the timeout

**Sources:**
- Web UI: Settings page, System Status modal (Lock Now button)
- Android app: Settings screen, System Status sheet (Lock Now button)
- Kill switch DM commands: `panic` command also triggers the same lockdown

## Kill Switch

For emergency situations when you cannot access the web UI or Android app, Signet supports remote administration via Nostr direct messages.

**Capabilities:**
- Lock all keys instantly (`panic`, `lockall`, `killswitch`)
- Lock individual keys (`lock <keyname>`)
- Suspend all apps (`suspendall apps`)
- Check system status (`status`)

**Security:**
- Only DMs from a pre-configured admin npub are accepted
- Messages are encrypted using NIP-04 or NIP-17
- All commands are logged for audit purposes

See [KILLSWITCH.md](KILLSWITCH.md) for setup and command reference.

## Audit Logging

All administrative actions are logged for security review:

| Event Type | Description |
|------------|-------------|
| `key_locked` | Key was locked |
| `key_unlocked` | Key was unlocked |
| `key_encrypted` | Key was encrypted during creation |
| `key_migrated` | Key encryption was migrated to NIP-49 |
| `key_exported` | Key was exported (ncryptsec or nsec) |
| `app_connected` | App was connected via nostrconnect:// |
| `app_suspended` | App was suspended |
| `app_unsuspended` | App was resumed |
| `auth_failed` | Authentication attempt failed |
| `daemon_started` | Daemon process started |
| `panic_triggered` | Dead man switch panic was triggered |
| `deadman_reset` | Inactivity timer was reset |
| `command_executed` | Kill switch command was received |
| `status_checked` | Kill switch status query was received |

Each log entry includes:
- Timestamp
- Client source (Signet UI, Signet Android, kill switch)
- Client version and IP address (when available)
- Command and result (for kill switch commands)

Logs are accessible via:
- Web UI: Activity page → Admin tab
- Android app: Activity screen → Admin tab
- API: `GET /admin/activity`

## Threat Model

### What Signet protects against

1. **Key exfiltration**: Private keys never leave the bunker in plain text
2. **Unauthorized signing**: All signing requests require explicit approval (or policy-based auto-approval)
3. **Brute-force attacks**: Rate limiting and strong key derivation
4. **CSRF attacks**: Double-submit cookie pattern with timing-safe comparison
5. **XSS attacks**: CORS restrictions, input validation, and HTML escaping
6. **Replay attacks**: NIP-46 uses ephemeral encrypted events
7. **Data tampering**: Authenticated encryption detects modifications
8. **Lost device access**: Kill switch allows emergency lockdown via Nostr DMs
9. **Compromised apps**: Instant suspension blocks rogue applications

### What Signet does NOT protect against

1. **Compromised host**: If the server running Signet is compromised, an attacker could potentially extract decrypted keys from memory while they are unlocked
2. **Weak passphrases**: The encryption is only as strong as the passphrase used
3. **Configuration file exposure**: The config file contains sensitive data (JWT secret, optionally plaintext keys)
4. **Web UI access compromise**: An attacker with access to the web UI can approve signing requests but not extract user keys

## Production Recommendations

1. **Use HTTPS**: Set `baseUrl` to an HTTPS URL and use a reverse proxy (nginx, Caddy)
2. **Restrict origins**: Set `allowedOrigins` to only your UI domain(s)
3. **Secure the config file**: Restrict file permissions (`chmod 600 signet.json`)
4. **Use NIP-49 encryption**: Always encrypt keys with strong passphrases using NIP-49 format
5. **Configure kill switch**: Set up remote lockdown capability via [KILLSWITCH.md](KILLSWITCH.md)
6. **Review audit logs**: Periodically check the Admin tab for unexpected activity
7. **Monitor logs**: Enable verbose logging and monitor for suspicious activity
8. **Restrict network access**: Use VPN, firewall rules, or reverse proxy authentication to limit access to the web UI
9. **Regular updates**: Keep Signet updated to receive security patches
10. **See [DEPLOYMENT.md](DEPLOYMENT.md)**: For specific setup guides (Tailscale, reverse proxies, etc.)
