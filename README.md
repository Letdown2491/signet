# Signet

**Signet** is a modern NIP-46 remote signer for Nostr. It manages multiple keys securely and provides a clean web dashboard for administration.

![Signet Dashboard](docs/dashboard-screenshot.png)

> **Note:** Signet is forked from [nsecbunkerd](https://github.com/kind-0/nsecbunkerd) and represents a partial rewrite to modernize the codebase and align with current Nostr standards.

This monorepo contains two apps:

- `apps/signet` — the NIP-46 daemon (CLI + service)
- `apps/signet-ui` — the React dashboard for administrators

The guides below focus on concise, reproducible steps. Docker Compose is first; pnpm-based development follows right after.

---

## Docker Compose (fastest path)

**Prereqs:** Docker & Docker Compose

```bash
git clone https://github.com/Letdown2491/signet
cd signet

./scripts/setup.sh                     # scaffold $HOME/.signet-config
```

The helper script creates the config directory, copies `.env.example` to `.env` if needed, lets you add encrypted or plain keys (plain accepts either hex or an `nsec` and converts it for you), and can optionally start the Compose stack for you.

Start everything:

```bash
docker compose up --build
# or in the background:
# docker compose up -d --build
```

This launches:

- `signet` (daemon, REST+web auth on `http://localhost:3000`)
- `signet-ui` (React dashboard on `http://localhost:${NEW_UI_PORT:-4174}`)
- `migrations` (runs Prisma migrations once on boot)

**Add keys via CLI (inside the container, if you skipped the setup script prompts):**

```bash
docker compose run --rm signet add --name main-key   # encrypt + store nsec
docker compose run --rm signet start --key main-key # unlock on demand
```

Config files live at `$HOME/.signet-config/signet.json`. The daemon reads from `/app/config/signet.json` which is the same directory mounted inside the container.

**Access the UI:**

1. Open `http://localhost:${NEW_UI_PORT:-4174}`
2. The dashboard automatically connects to the bunker REST API
3. View your keys, connected apps, and pending requests
4. Approve signing requests via the web interface

The UI provides:
- **Dashboard** — Overview of active keys, connected apps, and recent activity
- **Requests** — Review and approve NIP-46 requests with bulk actions and risk indicators
- **Keys** — Manage multiple keys with status and usage stats
- **Apps** — View connected applications and permissions
- **Settings** — Configure auto-refresh, notifications, and preferences

---

## pnpm / manual workflow

**Prereqs:** Node.js 18+, pnpm

```bash
git clone https://github.com/Letdown2491/signet
cd signet

pnpm install
```

Daemon setup:

```bash
cd apps/signet
pnpm run build
pnpm run prisma:migrate

pnpm run signet -- setup --config config/signet.json
pnpm run signet -- add --name main-key
pnpm run signet -- start --key main-key
```

UI dev server:

```bash
cd ../signet-ui
pnpm run dev -- --host 0.0.0.0 --port 4174
```

The UI automatically connects to the daemon's REST API at `http://localhost:3000` and provides the same management interface as in Docker.

---

## Configuration cheat sheet

All settings live in `signet.json`. For Docker this is `$HOME/.signet-config/signet.json`; locally it defaults to `apps/signet/config/signet.json` unless you pass `--config`.

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
      "key": "0123abcd... (64 hex chars)"
    }
  },
  "verbose": false
}
```

- `keys.<name>.iv/data` entries are encrypted nsecs (CLI prompts for passphrase).
- `keys.<name>.key` stores plain nsec text (auto-unlocks; secure the file).
- `baseUrl`, `authPort`, `domains` enable the OAuth-like web approval and account creation flows (see `apps/signet/docs/oauth-flow.md` for details).

Grab the latest connection URI at any time:

```bash
cat $HOME/.signet-config/connection.txt
# or from the daemon REST endpoint
curl http://localhost:3000/connection
```

---

## Reference

- Security overview: `apps/signet/SECURITY-MODEL.md`
- OAuth-like registration flow: `apps/signet/docs/oauth-flow.md`
- Original nsecbunkerd: https://github.com/kind-0/nsecbunkerd
- Issues & feedback: https://github.com/Letdown2491/signet/issues

MIT Licensed.
