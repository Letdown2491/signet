# Signet REST API Reference

This document describes all REST API endpoints provided by the Signet daemon.

## Base URL

- **Development**: `http://localhost:3000`
- **Docker**: `http://localhost:3000` (internal), exposed via UI proxy
- **Production**: Configure via `baseUrl` in `signet.json`

## Authentication

Most endpoints require JWT authentication. The token is stored in an HTTP-only cookie after login.

### Headers

| Header | Required | Description |
|--------|----------|-------------|
| `Authorization` | Optional | Bearer token (alternative to cookie) |
| `X-CSRF-Token` | For mutations | CSRF token for POST/PATCH/DELETE requests (not required when using Bearer auth) |
| `X-Signet-Client` | Optional | Client identification in format `name/version` (e.g., `Signet Android/1.4.0`). Used for admin activity logging. |

### Getting a CSRF Token

**Note:** CSRF tokens are only required when authenticating via cookies (browser-based access). API clients using Bearer token authentication (`Authorization: Bearer <token>`) do not need CSRF tokens, as Bearer auth is not vulnerable to cross-site request forgery attacks.

Before making state-changing requests with cookie auth, fetch a CSRF token:

```bash
curl -c cookies.txt http://localhost:3000/csrf-token
```

Include the token in subsequent requests:

```bash
curl -b cookies.txt -H "X-CSRF-Token: <token>" -X POST ...
```

---

## Endpoints

### Health

#### `GET /health`

Health check endpoint. No authentication required. Returns full daemon status for programmatic monitoring.

**Response:**
```json
{
  "status": "ok",
  "uptime": 3600,
  "memory": {
    "heapMB": 45.2,
    "rssMB": 89.7
  },
  "relays": {
    "connected": 4,
    "total": 5
  },
  "keys": {
    "active": 2,
    "locked": 1,
    "offline": 0
  },
  "subscriptions": 3,
  "sseClients": 1,
  "lastPoolReset": "2026-01-07T10:30:00.000Z"
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `status` | string | `ok` if at least one relay connected, `degraded` otherwise |
| `uptime` | number | Daemon uptime in seconds |
| `memory.heapMB` | number | V8 heap memory usage in MB |
| `memory.rssMB` | number | Resident set size memory in MB |
| `relays.connected` | number | Number of connected relays |
| `relays.total` | number | Total configured relays |
| `keys.active` | number | Unlocked keys ready for signing |
| `keys.locked` | number | Encrypted keys requiring passphrase |
| `keys.offline` | number | Unencrypted keys not loaded |
| `subscriptions` | number | Active NIP-46 subscriptions |
| `sseClients` | number | Connected SSE clients (web UI, Android app) |
| `lastPoolReset` | string \| null | ISO 8601 timestamp of last relay pool reset, or null if never reset |

**Notes:**
- `lastPoolReset` is set after system suspend/resume recovery or watchdog-triggered resets
- A `degraded` status indicates no relays are connected; NIP-46 requests will fail until connectivity is restored

---

### CSRF Token

#### `GET /csrf-token`

Get a CSRF token for state-changing requests.

**Authentication:** Required

**Response:**
```json
{
  "token": "abc123..."
}
```

The token is also set in a cookie named `signet_csrf`.

---

### Connection

#### `GET /connection`

Get bunker connection information for NIP-46 clients.

**Authentication:** Required

**Response:**
```json
{
  "npub": "npub1...",
  "pubkey": "hex...",
  "npubUri": "bunker://npub1...?relay=wss://...",
  "hexUri": "bunker://hex...?relay=wss://...",
  "relays": ["wss://relay.example.com"],
  "nostrRelays": ["wss://relay.damus.io"]
}
```

---

### Relays

#### `GET /relays`

Get relay connection status.

**Authentication:** Required

**Response:**
```json
{
  "connected": 4,
  "total": 5,
  "relays": [
    {
      "url": "wss://relay.damus.io",
      "connected": true,
      "lastConnected": "2025-01-15T10:30:00.000Z",
      "lastDisconnected": null
    }
  ]
}
```

---

#### `POST /connections/refresh`

Force reset the relay pool and recreate all WebSocket connections. Use when connections are silently dead (e.g., after fail2ban/iptables changes that flush the conntrack table).

**Authentication:** Required
**CSRF:** Required

**Request Body:** Empty object `{}`

**Response:**
```json
{
  "ok": true,
  "message": "Relay pool reset initiated"
}
```

**Use Cases:**
- After fail2ban bans an IP (conntrack table flush kills existing connections)
- After iptables rule changes
- When NIP-46 requests mysteriously stop working but health checks pass
- As a recovery action when the daemon appears healthy but isn't receiving events

**Example (fail2ban hook):**
```bash
curl -s -X POST http://localhost:3000/connections/refresh
```

**Notes:**
- The pool reset is asynchronous; new connections are established in the background
- All NIP-46 subscriptions are automatically recreated after the pool resets
- A `pool-reset` event is emitted internally for dependent services to refresh their state
- Health checks create new connections and may pass even when existing subscriptions are dead; this endpoint forces a full reset

---

### Requests

#### `GET /requests`

List authorization requests.

**Authentication:** Required

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `status` | string | `pending` | Filter by status: `pending`, `all`, `approved`, `denied`, `expired`, `admin` |
| `limit` | number | 10 | Max results (1-50) |
| `offset` | number | 0 | Pagination offset |
| `excludeAdmin` | boolean | `false` | When `status=all`, exclude admin events (return only NIP-46 requests) |

**Status Filter Values:**

| Value | Description |
|-------|-------------|
| `pending` | Requests awaiting approval (default) |
| `all` | All processed requests (approved, denied, expired) plus admin events |
| `approved` | Approved requests only |
| `denied` | Denied requests only |
| `expired` | Expired requests only |
| `admin` | Admin activity only (key lock/unlock, app suspend/resume, daemon start) |

**Response:**
```json
{
  "requests": [
    {
      "id": "uuid-string",
      "keyName": "main-key",
      "method": "sign_event",
      "remotePubkey": "hex...",
      "params": "{\"kind\":1,\"content\":\"Hello\"}",
      "eventPreview": {
        "kind": 1,
        "content": "Hello",
        "tags": []
      },
      "createdAt": "2025-01-15T10:30:00.000Z",
      "expiresAt": "2025-01-15T10:31:00.000Z",
      "ttlSeconds": 45,
      "requiresPassword": false,
      "processedAt": null,
      "autoApproved": false,
      "approvalType": "manual",
      "appName": "Primal",
      "allowed": true
    }
  ]
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `allowed` | boolean \| null | `true` = approved, `false` = denied, `null` = pending/expired |
| `approvalType` | string \| null | How the request was approved (see table below) |

**Approval Types:**

| Value | Description | UI Badge |
|-------|-------------|----------|
| `manual` | User clicked Approve | ✓ Approved |
| `auto_trust` | Auto-approved by app's trust level | 🛡 Approved |
| `auto_permission` | Auto-approved by "Always Allow" permission | 🔁 Approved |
| `null` | Not yet approved or denied | - |

---

#### `GET /requests/:id`

Web authorization page (HTML). Used for manual approval via browser.

**Authentication:** Not required (uses request secret)

**Response:** HTML page for approving/denying the request.

---

#### `POST /requests/:id`

Approve or deny a request.

**Authentication:** Not required (uses form submission from web page)
**Rate Limited:** Yes (10 req/min)

**Request Body (form-encoded):**

| Field | Type | Description |
|-------|------|-------------|
| `passphrase` | string | Key passphrase (if encrypted) |
| `trustLevel` | string | For connect: `paranoid`, `reasonable`, `full` |
| `alwaysAllow` | boolean | Grant permission for future requests of this type |

**Response:** Redirect to success/error page.

---

#### `POST /requests/batch`

Batch approve multiple requests.

**Authentication:** Required
**CSRF:** Required
**Rate Limited:** Yes (10 req/min)

**Request Body:**
```json
{
  "ids": ["uuid1", "uuid2", "uuid3"],
  "trustLevel": "reasonable",
  "alwaysAllow": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `ids` | string[] | required | Request IDs to approve (max 50) |
| `trustLevel` | string | `reasonable` | Trust level for connect requests |
| `alwaysAllow` | boolean | `false` | Grant permanent permission |

**Response:**
```json
{
  "results": [
    { "id": "uuid1", "success": true },
    { "id": "uuid2", "success": false, "error": "Request not found" }
  ],
  "summary": {
    "approved": 1,
    "failed": 1
  }
}
```

---

### Keys

#### `GET /keys`

List all keys.

**Authentication:** Required

**Response:**
```json
{
  "keys": [
    {
      "name": "main-key",
      "npub": "npub1...",
      "bunkerUri": "bunker://...",
      "status": "online",
      "isEncrypted": true,
      "userCount": 5,
      "tokenCount": 2,
      "requestCount": 150,
      "lastUsedAt": "2025-01-15T10:30:00.000Z"
    }
  ]
}
```

**Key Status Values:**
- `online` - Key is unlocked and active
- `locked` - Key is encrypted and needs passphrase
- `offline` - Key is not loaded

---

#### `POST /keys`

Create a new key.

**Authentication:** Required
**CSRF:** Required
**Rate Limited:** Yes (10 req/min)

**Request Body:**
```json
{
  "keyName": "my-key",
  "passphrase": "optional-passphrase",
  "nsec": "nsec1... (optional, generates new if omitted)"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `keyName` | string | Yes | Unique key identifier |
| `passphrase` | string | No | Encrypt key with passphrase |
| `nsec` | string | No | Import existing nsec (generates new if omitted) |

**Response:**
```json
{
  "ok": true,
  "key": {
    "name": "my-key",
    "npub": "npub1...",
    "status": "online",
    "isEncrypted": false
  }
}
```

---

#### `PATCH /keys/:keyName`

Rename a key.

**Authentication:** Required
**CSRF:** Required

**Request Body:**
```json
{
  "newName": "renamed-key"
}
```

**Response:**
```json
{
  "ok": true
}
```

---

#### `POST /keys/:keyName/unlock`

Unlock an encrypted key.

**Authentication:** Required
**CSRF:** Required

**Request Body:**
```json
{
  "passphrase": "your-passphrase"
}
```

**Response:**
```json
{
  "ok": true
}
```

**Errors:**
- `400` - Passphrase is required
- `401` - Incorrect passphrase
- `404` - Key not found

---

#### `POST /keys/:keyName/lock`

Lock an active key, removing it from memory. The key remains encrypted on disk; all apps and permissions are preserved. When unlocked again, the key resumes with all existing connections.

**Authentication:** Required
**CSRF:** Required

**Request Body:** Empty object `{}`

**Response:**
```json
{
  "ok": true
}
```

**Errors:**
- `400` - Key is not active (already locked or offline)
- `400` - Cannot lock unencrypted key (must set passphrase first)
- `404` - Key not found

---

#### `POST /keys/:keyName/set-passphrase`

Encrypt an unencrypted key with a passphrase.

**Authentication:** Required
**CSRF:** Required
**Rate Limited:** Yes (10 req/min)

**Request Body:**
```json
{
  "passphrase": "new-passphrase"
}
```

**Response:**
```json
{
  "ok": true
}
```

---

#### `POST /keys/:keyName/connection-token`

Generate a one-time connection token for a key. Returns a bunker URI with a token that expires in 5 minutes and can only be used once.

**Authentication:** Required
**CSRF:** Required
**Rate Limited:** Yes (10 req/min)

**Request Body:** Empty object `{}`

**Response:**
```json
{
  "ok": true,
  "bunkerUri": "bunker://npub...?relay=wss://...&secret=<one-time-token>",
  "expiresAt": "2025-01-15T10:35:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `bunkerUri` | string | Complete bunker URI with one-time token |
| `expiresAt` | string | ISO 8601 timestamp when token expires (5 minutes from creation) |

**Errors:**
- `400` - Key is not active (locked or offline)
- `404` - Key not found

**Notes:**
- The token in the URI differs from the persistent `admin.secret`
- Each call generates a unique token
- Tokens are single-use: once redeemed, they cannot be used again
- After initial connection, the client's pubkey is remembered and no token is needed for future requests

---

#### `POST /keys/lock-all`

Lock all active (unlocked) keys at once. Keys are removed from memory but remain encrypted on disk with all apps and permissions preserved.

**Authentication:** Required
**CSRF:** Required

**Request Body:** Empty object `{}`

**Response:**
```json
{
  "ok": true,
  "lockedCount": 3
}
```

| Field | Type | Description |
|-------|------|-------------|
| `lockedCount` | number | Number of keys that were locked |

**Notes:**
- Only locks keys that are currently active (unlocked)
- Keys that are already locked or unencrypted are skipped
- Each locked key is logged as a `key_locked` admin event

---

#### `DELETE /keys/:keyName`

Delete a key and revoke all connected apps.

**Authentication:** Required
**CSRF:** Required
**Rate Limited:** Yes (10 req/min)

**Request Body:**
```json
{
  "passphrase": "required-if-encrypted"
}
```

**Response:**
```json
{
  "ok": true,
  "revokedApps": 3
}
```

---

### Apps

#### `GET /apps`

List all connected applications.

**Authentication:** Required

**Response:**
```json
{
  "apps": [
    {
      "id": 1,
      "keyName": "main-key",
      "userPubkey": "hex...",
      "description": "Primal",
      "trustLevel": "reasonable",
      "permissions": ["sign_event", "nip04_encrypt"],
      "connectedAt": "2025-01-10T08:00:00.000Z",
      "lastUsedAt": "2025-01-15T10:30:00.000Z",
      "suspendedAt": null,
      "suspendUntil": null,
      "requestCount": 42,
      "methodBreakdown": {
        "sign_event": 35,
        "nip04_encrypt": 5,
        "nip04_decrypt": 2,
        "nip44_encrypt": 0,
        "nip44_decrypt": 0,
        "get_public_key": 0,
        "other": 0
      }
    }
  ]
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `suspendedAt` | string \| null | ISO 8601 timestamp when app was suspended, or null if active |
| `suspendUntil` | string \| null | ISO 8601 timestamp when suspension ends (auto-resume), or null for indefinite |

**Trust Levels:**
- `paranoid` - Always ask for approval (including reconnects)
- `reasonable` - Auto-approve safe event kinds (1, 6, 7, 16, 1111, 24242), NIP-44 encryption, and reconnects
- `full` - Auto-approve all requests

Note: NIP-04 encryption (`nip04_encrypt`, `nip04_decrypt`) always requires approval at `paranoid` and `reasonable` levels due to privacy sensitivity (legacy DMs).

---

#### `PATCH /apps/:id`

Update an app's description or trust level.

**Authentication:** Required
**CSRF:** Required

**Request Body:**
```json
{
  "description": "My Nostr Client",
  "trustLevel": "full"
}
```

At least one field is required.

**Response:**
```json
{
  "ok": true
}
```

---

#### `POST /apps/:id/revoke`

Revoke an app's access.

**Authentication:** Required
**CSRF:** Required

**Response:**
```json
{
  "ok": true
}
```

---

#### `POST /apps/:id/suspend`

Suspend an app, temporarily blocking all signing requests.

**Authentication:** Required
**CSRF:** Required

**Request Body:**
```json
{
  "until": "2025-01-20T15:00:00.000Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `until` | string | No | ISO 8601 timestamp when suspension should automatically end. If omitted, suspension is indefinite until manually resumed. |

**Response:**
```json
{
  "ok": true
}
```

**Errors:**
- `400` - Invalid app ID
- `400` - Invalid date format for "until"
- `400` - "until" must be in the future
- `400` - App is already suspended
- `404` - App not found

**Notes:**
- Suspended apps cannot make any signing requests
- The ACL automatically checks if the suspension has expired and allows requests after `suspendUntil` passes
- Use `POST /apps/:id/unsuspend` to manually resume before the scheduled time

---

#### `POST /apps/:id/unsuspend`

Resume a suspended app, allowing signing requests again.

**Authentication:** Required
**CSRF:** Required

**Request Body:** Empty object `{}`

**Response:**
```json
{
  "ok": true
}
```

**Errors:**
- `400` - Invalid app ID
- `400` - App is not suspended
- `404` - App not found

---

#### `POST /apps/suspend-all`

Suspend all active (non-suspended) apps at once, temporarily blocking all signing requests.

**Authentication:** Required
**CSRF:** Required

**Request Body:**
```json
{
  "until": "2025-01-20T15:00:00.000Z"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `until` | string | No | ISO 8601 timestamp when suspensions should automatically end. If omitted, suspensions are indefinite until manually resumed. |

**Response:**
```json
{
  "ok": true,
  "suspendedCount": 5
}
```

| Field | Type | Description |
|-------|------|-------------|
| `suspendedCount` | number | Number of apps that were suspended |

**Notes:**
- Only suspends apps that are currently active (not already suspended)
- Already suspended apps are skipped
- Each suspended app is logged as an `app_suspended` admin event

---

#### `POST /apps/resume-all`

Resume all suspended apps at once, allowing signing requests again.

**Authentication:** Required
**CSRF:** Required

**Request Body:** Empty object `{}`

**Response:**
```json
{
  "ok": true,
  "resumedCount": 5
}
```

| Field | Type | Description |
|-------|------|-------------|
| `resumedCount` | number | Number of apps that were resumed |

**Notes:**
- Only resumes apps that are currently suspended
- Active apps are skipped
- Each resumed app is logged as an `app_unsuspended` admin event

---

### NostrConnect

#### `POST /nostrconnect`

Connect an app via nostrconnect:// URI. This is an alternative to the bunker:// flow where the app initiates the connection.

**Authentication:** Required
**CSRF:** Required

**Request Body:**
```json
{
  "uri": "nostrconnect://pubkey?relay=wss://relay.example.com&secret=abc123",
  "keyName": "main-key",
  "trustLevel": "reasonable",
  "description": "Primal"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uri` | string | Yes | Full nostrconnect:// URI from the app |
| `keyName` | string | Yes | Key to use for this connection |
| `trustLevel` | string | Yes | Trust level: `paranoid`, `reasonable`, `full` |
| `description` | string | No | App name/description |

**URI Components:**

The nostrconnect:// URI contains:
- **Client pubkey** (path): 64-character hex pubkey of the connecting app
- **relay** (required): One or more relay URLs for communication
- **secret** (required): One-time secret for the initial handshake
- **perms** (optional): Comma-separated permissions the app requests
- **name** (optional): App name suggested by the client
- **url** (optional): App's website URL

**Response (Success):**
```json
{
  "ok": true,
  "appId": 42,
  "connectResponseSent": true
}
```

**Response (Partial Success):**
```json
{
  "ok": true,
  "appId": 42,
  "connectResponseSent": false,
  "connectResponseError": "Failed to publish to relay"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `ok` | boolean | Whether the connection was created |
| `appId` | number | ID of the newly connected app |
| `connectResponseSent` | boolean | Whether the ACK was successfully sent to the app via relay |
| `connectResponseError` | string | Error message if relay notification failed |

**Errors:**
- `400` - Invalid URI format, missing required fields, or key not active
- `404` - Key not found
- `409` - App already connected to this key (returns `errorType: 'already_connected'`)

**Example:**
```bash
curl -X POST http://localhost:3000/nostrconnect \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: <token>" \
  -b cookies.txt \
  -d '{
    "uri": "nostrconnect://abc123...?relay=wss://relay.damus.io&secret=xyz",
    "keyName": "main-key",
    "trustLevel": "reasonable",
    "description": "My Nostr App"
  }'
```

**Notes:**
- The daemon sends a NIP-46 `connect` response to the app via the specified relay(s)
- If relay notification fails, the connection is still created (partial success)
- The app may need to retry its connection request if it doesn't receive the ACK

---

### Dead Man's Switch (Inactivity Lock)

The Dead Man's Switch (also called Inactivity Lock) is a security feature that automatically locks all keys and suspends all apps if not reset within a configured timeframe.

#### `GET /dead-man-switch`

Get the current Dead Man's Switch status.

**Authentication:** Required

**Response:**
```json
{
  "enabled": true,
  "timeframeSec": 604800,
  "lastResetAt": 1704067200000,
  "remainingSec": 345600,
  "panicTriggeredAt": null,
  "remainingAttempts": 3
}
```

**Response Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `enabled` | boolean | Whether the Dead Man's Switch is enabled |
| `timeframeSec` | number | Configured timeframe in seconds (default: 7 days) |
| `lastResetAt` | number \| null | Unix timestamp (ms) of last reset |
| `remainingSec` | number \| null | Seconds remaining until panic triggers |
| `panicTriggeredAt` | number \| null | Unix timestamp (ms) when panic was triggered, or null if not triggered |
| `remainingAttempts` | number | Password attempts remaining before permanent lockout |

---

#### `PUT /dead-man-switch`

Enable, disable, or update the Dead Man's Switch timeframe.

**Authentication:** Required
**CSRF:** Required

**Request Body (Enable):**
```json
{
  "enabled": true,
  "timeframeSec": 604800
}
```

**Request Body (Disable):**
```json
{
  "enabled": false,
  "keyName": "main-key",
  "passphrase": "your-passphrase"
}
```

**Request Body (Update Timeframe):**
```json
{
  "timeframeSec": 259200,
  "keyName": "main-key",
  "passphrase": "your-passphrase"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `enabled` | boolean | For enable/disable | Set to `true` to enable, `false` to disable |
| `timeframeSec` | number | For enable/update | Timeframe in seconds (min: 1 hour, max: 30 days) |
| `keyName` | string | For disable/update | Key name for passphrase verification |
| `passphrase` | string | For disable/update | Passphrase to verify ownership |

**Response:**
```json
{
  "ok": true,
  "status": {
    "enabled": true,
    "timeframeSec": 604800,
    "remainingSec": 604800,
    "panicTriggeredAt": null,
    "remainingAttempts": 3
  }
}
```

**Errors:**
- `400` - Invalid timeframe (must be between 1 hour and 30 days)
- `401` - Incorrect passphrase
- `404` - Key not found

---

#### `POST /dead-man-switch/reset`

Reset the Dead Man's Switch timer. Also clears panic state if triggered.

**Authentication:** Required
**CSRF:** Required

**Request Body:**
```json
{
  "keyName": "main-key",
  "passphrase": "your-passphrase"
}
```

**Response:**
```json
{
  "ok": true,
  "status": {
    "enabled": true,
    "timeframeSec": 604800,
    "remainingSec": 604800,
    "panicTriggeredAt": null,
    "remainingAttempts": 3
  }
}
```

**Errors:**
- `400` - Dead Man's Switch is not enabled
- `401` - Incorrect passphrase
- `404` - Key not found

---

#### `POST /dead-man-switch/test-panic`

Manually trigger panic mode. This locks all keys and suspends all apps immediately.

**Authentication:** Required
**CSRF:** Required

**Request Body:**
```json
{
  "keyName": "main-key",
  "passphrase": "your-passphrase"
}
```

**Response:**
```json
{
  "ok": true,
  "status": {
    "enabled": true,
    "panicTriggeredAt": 1704153600000,
    "remainingAttempts": 3
  }
}
```

**Effects:**
- All active keys are locked
- All connected apps are suspended
- The UI shows a lock screen overlay until recovered

**Errors:**
- `400` - Dead Man's Switch is not enabled
- `401` - Incorrect passphrase
- `404` - Key not found

---

### Dashboard

#### `GET /dashboard`

Get dashboard statistics and recent activity.

**Authentication:** Required

**Response:**
```json
{
  "stats": {
    "totalKeys": 3,
    "activeKeys": 2,
    "connectedApps": 5,
    "pendingRequests": 1,
    "recentActivity24h": 54
  },
  "activity": [
    {
      "id": 123,
      "timestamp": "2025-01-15T10:30:00.000Z",
      "type": "approval",
      "method": "sign_event",
      "eventKind": 1,
      "keyName": "main-key",
      "userPubkey": "hex...",
      "appName": "Primal",
      "autoApproved": false,
      "approvalType": "manual"
    }
  ]
}
```

**Activity Entry Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `approval` or `denial` |
| `autoApproved` | boolean | `true` if auto-approved (backwards compat) |
| `approvalType` | string \| undefined | `manual`, `auto_trust`, or `auto_permission` |
| `eventKind` | number \| undefined | Event kind for `sign_event` requests |

**Activity Entry Types:**

| Type | Description |
|------|-------------|
| `approval` | Request was approved (manual or auto) |
| `denial` | Request was denied |

---

### Events (SSE)

#### `GET /events`

Server-Sent Events stream for real-time updates.

**Authentication:** Required

**Connection:**
```javascript
const eventSource = new EventSource('/events', { withCredentials: true });

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.type, data);
};
```

**Event Types:**

| Type | Description | Payload |
|------|-------------|---------|
| `connected` | Initial connection established | `{}` |
| `request:created` | New authorization request | `{ request: PendingRequest }` |
| `request:approved` | Request was approved | `{ requestId: string, activity: ActivityEntry }` |
| `request:denied` | Request was denied | `{ requestId: string, activity: ActivityEntry }` |
| `request:expired` | Request expired | `{ requestId: string }` |
| `request:auto_approved` | Request auto-approved via trust level | `{ activity: ActivityEntry }` |
| `app:connected` | New app connected | `{ app: ConnectedApp }` |
| `app:revoked` | App access was revoked | `{ appId: number }` |
| `app:updated` | App description or trust level changed | `{ app: ConnectedApp }` |
| `key:created` | Key was created | `{ key: KeyInfo }` |
| `key:unlocked` | Key was unlocked | `{ keyName: string }` |
| `key:locked` | Key was locked | `{ keyName: string }` |
| `key:deleted` | Key was deleted | `{ keyName: string }` |
| `key:renamed` | Key was renamed | `{ oldName: string, newName: string }` |
| `key:updated` | Key encryption status changed | `{ keyName: string }` |
| `stats:updated` | Dashboard stats changed | `{ stats: DashboardStats }` |
| `relays:updated` | Relay connection status changed | `{ relays: RelayStatusResponse }` |
| `deadman:panic` | Dead Man's Switch panic triggered | `{ status: DeadManSwitchStatus }` |
| `deadman:reset` | Dead Man's Switch timer reset | `{ status: DeadManSwitchStatus }` |
| `deadman:updated` | Dead Man's Switch settings changed | `{ status: DeadManSwitchStatus }` |
| `ping` | Keep-alive (every 30s) | n/a (comment line) |
| `admin:event` | Admin action performed | `{ activity: AdminActivityEntry }` |

**Admin Event Types:**

The `admin:event` payload contains an `AdminActivityEntry` with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Unique log entry ID |
| `timestamp` | string | ISO 8601 timestamp |
| `category` | string | Always `"admin"` |
| `eventType` | string | Admin event type (see table below) |
| `keyName` | string \| undefined | Key name (for key events) |
| `appId` | number \| undefined | App ID (for app events) |
| `appName` | string \| undefined | App name (for app events) |
| `clientName` | string \| undefined | Client that performed the action (e.g., `"Signet UI"`, `"Signet Android"`, `"kill-switch"`) |
| `clientVersion` | string \| undefined | Client version (e.g., `"1.4.0"`) |
| `ipAddress` | string \| undefined | Client IP address |
| `command` | string \| undefined | Kill switch command text (for `command_executed`) |
| `commandResult` | string \| undefined | Kill switch command result (for `command_executed`) |

**Admin Event Type Values:**

| Value | Description |
|-------|-------------|
| `key_locked` | Key was locked via UI or kill switch |
| `key_unlocked` | Key was unlocked |
| `app_suspended` | App was suspended |
| `app_unsuspended` | App was resumed |
| `daemon_started` | Daemon process started |
| `status_checked` | Kill switch `status` command was executed |
| `command_executed` | Kill switch command was executed (includes `command` and `commandResult` fields) |

---

#### `GET /events/status`

Get SSE connection status.

**Authentication:** Required

**Response:**
```json
{
  "subscribers": 2
}
```

---

### Tokens

#### `GET /tokens`

List all delegation tokens.

**Authentication:** Required

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `keyName` | string | Filter by key name |

**Response:**
```json
{
  "tokens": [
    {
      "id": 1,
      "keyName": "main-key",
      "clientName": "Mobile App",
      "token": "hex-token...",
      "policyId": 1,
      "policyName": "Read Only",
      "createdAt": "2025-01-10T08:00:00.000Z",
      "expiresAt": "2025-02-10T08:00:00.000Z",
      "redeemedAt": null,
      "redeemedBy": null
    }
  ]
}
```

---

#### `POST /tokens`

Create a new delegation token.

**Authentication:** Required
**CSRF:** Required
**Rate Limited:** Yes (10 req/min)

**Request Body:**
```json
{
  "keyName": "main-key",
  "clientName": "Mobile App",
  "policyId": 1,
  "expiresInHours": 720
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `keyName` | string | Yes | Key to delegate |
| `clientName` | string | Yes | Name for the client |
| `policyId` | number | Yes | Policy to apply |
| `expiresInHours` | number | No | Token expiration (hours) |

**Response:**
```json
{
  "ok": true,
  "token": {
    "id": 1,
    "token": "hex-token...",
    "expiresAt": "2025-02-10T08:00:00.000Z"
  }
}
```

---

#### `DELETE /tokens/:id`

Delete a token.

**Authentication:** Required
**CSRF:** Required

**Response:**
```json
{
  "ok": true
}
```

---

### Policies

#### `GET /policies`

List all policies.

**Authentication:** Required

**Response:**
```json
{
  "policies": [
    {
      "id": 1,
      "name": "Read Only",
      "description": "Only allows reading public key",
      "createdAt": "2025-01-10T08:00:00.000Z",
      "expiresAt": null,
      "rules": [
        {
          "id": 1,
          "method": "get_public_key",
          "kind": null,
          "maxUsageCount": null,
          "currentUsageCount": 0
        }
      ]
    }
  ]
}
```

---

#### `POST /policies`

Create a new policy.

**Authentication:** Required
**CSRF:** Required
**Rate Limited:** Yes (10 req/min)

**Request Body:**
```json
{
  "name": "Social Only",
  "description": "Allow signing social events",
  "expiresAt": "2025-12-31T23:59:59.000Z",
  "rules": [
    { "method": "sign_event", "kind": 1, "maxUsageCount": 100 },
    { "method": "sign_event", "kind": 6 },
    { "method": "sign_event", "kind": 7 }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Policy name |
| `description` | string | No | Policy description |
| `expiresAt` | string | No | ISO 8601 expiration date |
| `rules` | array | No | Permission rules |

**Rule Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `method` | string | NIP-46 method name (see [valid methods](#nip-46-methods)) |
| `kind` | number/string | Event kind (for sign_event) |
| `maxUsageCount` | number | Usage limit (null = unlimited) |

**Errors:**
- `400 Bad Request` - Invalid method name(s). Response includes the list of valid methods.

**Response:**
```json
{
  "ok": true,
  "policy": {
    "id": 2,
    "name": "Social Only",
    "rules": [
      { "id": 4, "method": "sign_event", "kind": "1" },
      { "id": 5, "method": "sign_event", "kind": "6" },
      { "id": 6, "method": "sign_event", "kind": "7" }
    ]
  }
}
```

---

#### `DELETE /policies/:id`

Delete a policy and its rules.

**Authentication:** Required
**CSRF:** Required

**Response:**
```json
{
  "ok": true
}
```

---

## Error Responses

All endpoints return consistent error responses:

```json
{
  "error": "Error message describing what went wrong"
}
```

### HTTP Status Codes

| Code | Description |
|------|-------------|
| `200` | Success |
| `400` | Bad request (invalid input) |
| `401` | Unauthorized (missing/invalid auth) |
| `403` | Forbidden (invalid CSRF token) |
| `404` | Resource not found |
| `429` | Rate limited |
| `500` | Internal server error |
| `503` | Service unavailable |

### Rate Limit Response

When rate limited, the response includes a `Retry-After` header:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 60

{
  "error": "Rate limit exceeded. Try again in 60 seconds."
}
```

---

## NIP-46 Methods

For reference, these are the NIP-46 methods that appear in requests:

| Method | Description |
|--------|-------------|
| `connect` | Initial connection request |
| `sign_event` | Sign a Nostr event |
| `get_public_key` | Get the public key |
| `nip04_encrypt` | Encrypt message (NIP-04) |
| `nip04_decrypt` | Decrypt message (NIP-04) |
| `nip44_encrypt` | Encrypt message (NIP-44) |
| `nip44_decrypt` | Decrypt message (NIP-44) |
| `ping` | Connection health check |
| `switch_relays` | Get signer's preferred relay list (requires existing connection) |

**Note:** The `switch_relays` method returns a JSON array of relay URLs. Unlike other methods, it does not require explicit permission grants, but the client must have an existing connection (completed `connect` flow). Unauthenticated clients receive "Not authorized".

---

## TypeScript Types

All API types are available in the `@signet/types` package:

```typescript
import type {
  ConnectionInfo,
  RelayStatusResponse,
  PendingRequest,
  KeyInfo,
  ConnectedApp,
  DashboardResponse,
  DashboardStats,
  ActivityEntry,
  TrustLevel,
  ApprovalType,  // 'manual' | 'auto_trust' | 'auto_permission'
} from '@signet/types';

// Dead Man's Switch status (from api-client.ts)
interface DeadManSwitchStatus {
  enabled: boolean;
  timeframeSec: number;
  lastResetAt: number | null;
  remainingSec: number | null;
  panicTriggeredAt: number | null;
  remainingAttempts: number;
}
```
