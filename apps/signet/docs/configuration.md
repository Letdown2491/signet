# Signet Configuration

All runtime settings live in `signet.json`. When running via Docker, the file is mounted at `$HOME/.signet-config/signet.json`. Locally you can keep it anywhere and point the CLI at it using `--config`.

## Example

```json
{
  "nostr": {
    "relays": [
      "wss://relay.damus.io",
      "wss://relay.primal.net",
      "wss://nos.lol"
    ]
  },
  "admin": {
    "npubs": ["npub1example..."],
    "adminRelays": ["wss://relay.nsec.app"],
    "key": "auto-generated",
    "notifyAdminsOnBoot": false
  },
  "authPort": 3000,
  "authHost": "0.0.0.0",
  "baseUrl": "http://localhost:3000",
  "database": "sqlite://signet.db",
  "logs": "./signet.log",
  "keys": {
    "alice": {
      "iv": "hex-iv",
      "data": "hex-cipher"
    },
    "bob": {
      "key": "nsec1..."
    }
  },
  "verbose": false
}
```

### Keys

- `keys.<name>.iv` + `keys.<name>.data`: encrypted nsec (written by `signet add`). Provide the passphrase at boot or unlock through the admin UI.
- `keys.<name>.key`: plain nsec text (auto-starts without prompt; keep the file private).

### Networking

- `nostr.relays`: relays watched for NIP‑46 requests.
- `admin.adminRelays`: relays used for admin RPC traffic. These must be reachable by the UI/clients.

### Web approval / OAuth-like flow

- `baseUrl`: public URL where the daemon is reachable.
- `authPort` / `authHost`: local interface for the Fastify server (`/connection`, `/requests/:id`, `/register/:id`).
- `domains`: optional domain configuration for account provisioning (see `docs/oauth-flow.md`).

All other fields are optional; omitted values fall back to sensible defaults.
