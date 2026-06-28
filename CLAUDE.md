# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What Signet is

Signet is a NIP-46 remote signer ("bunker") for Nostr. It holds encrypted private keys and signs Nostr events on behalf of connected apps over relays, never exposing key material to those apps. It is a heavily-rewritten fork of nsecbunkerd. The system has three deployable parts plus a shared types package, organized as a pnpm workspace.

## Repository layout

- `apps/signet` — the **daemon** (`signet` package): NIP-46 backend, REST/SSE API, SQLite persistence, CLI. This is where most backend work happens.
- `apps/signet-ui` — the **web dashboard** (`signet-ui` package): React 19 + Vite SPA, plus `server.mjs` (Express) that serves the build and reverse-proxies API calls to the daemon.
- `apps/signet-android` — native Android client (Kotlin/Gradle). Separate toolchain; see `docs/ANDROID.md`.
- `packages/signet-types` (`@signet/types`) — shared TypeScript types consumed by both daemon and UI. **Build this first** (the root `prepare` script does so) — daemon/UI typechecks depend on its `dist/`.

## Commands

All commands use pnpm. Node `>=20.19.0` is required.

### From the repo root
```bash
pnpm install            # also runs `prepare` → builds @signet/types
pnpm run build:daemon   # build apps/signet
pnpm run build:ui       # build apps/signet-ui
pnpm run start:daemon   # run the built daemon (alias for `lfg`)
pnpm run start:ui       # run the UI server (Express, proxies to daemon)
pnpm run dev:ui         # Vite dev server for the UI
pnpm run typecheck      # typecheck daemon + UI
```

### Daemon (`apps/signet`)
```bash
pnpm run build          # prisma generate + tsup bundles index/daemon/client
pnpm run prisma:migrate # apply migrations (prisma migrate deploy)
pnpm run lfg            # start daemon (runs migrations, forks the daemon process)
pnpm run typecheck      # tsc --noEmit
pnpm test               # vitest run
pnpm run test:watch     # vitest watch
vitest run path/to/file.test.ts          # run a single test file
vitest run -t "test name substring"       # run tests matching a name
```

### UI (`apps/signet-ui`)
```bash
pnpm run build      # tsc && vite build
pnpm run dev        # vite dev server
pnpm run start      # node server.mjs (serves dist + proxies API)
pnpm run lint       # eslint .
pnpm run typecheck  # tsc --noEmit
pnpm test           # vitest run (jsdom + Testing Library)
```

There is no repo-wide lint; only the UI has an ESLint config (`apps/signet-ui/eslint.config.js`).

### Docker
`docker compose up --build` runs daemon (port 3000) + UI (port 4174). The daemon image runs migrations on startup via `apps/signet/scripts/start.js`. The Android-only setup runs just the `signet` service.

## Architecture

### Process model
The daemon does **not** run in a single process. `src/commands/start.ts` loads config, interactively unlocks encrypted keys, then `fork()`s `src/daemon/index.ts` and `send()`s a `DaemonBootstrapConfig` (decrypted keys live only in the forked child). `src/daemon/run.ts` is the real orchestrator: it wires up relay pool, subscription manager, per-key NIP-46 backends, services, repositories, and the HTTP server, and owns the periodic cleanup/health loops.

### Key request flow
1. A connected app publishes an encrypted NIP-46 request event to a relay.
2. `RelayPool` + `SubscriptionManager` (`src/daemon/lib/`) deliver it; `Nip46Backend` (`src/daemon/nip46-backend.ts`) decrypts the transport with NIP-44 (per current NIP-46; the channel is NIP-44-only — `nip04_encrypt`/`nip04_decrypt` remain as RPC methods for third-party content), dedupes by event id (`TTLCache`), and parses the RPC method.
3. The backend calls a `PermitCallback` (built in `run.ts` → `buildAuthorizationCallback`).
4. `checkRequestPermission` in `src/daemon/lib/acl.ts` decides: app revoked/suspended → deny; trust level + signing conditions → auto-approve/auto-deny; otherwise the request is persisted and surfaced for manual approval via `src/daemon/authorize.ts` (polled with backoff, exposed to the UI over SSE).
5. The backend signs/encrypts and publishes the response.

Trust levels (`paranoid` | `reasonable` | `full`) and per-method signing conditions on `KeyUser` drive auto-approval. `ConnectionManager` (`src/daemon/connection-manager.ts`) handles `bunker://` URI generation and out-of-band responses like `auth_url`.

### Layering in the daemon
`http/routes/*` (Fastify route handlers) → `services/*` (business logic, singletons accessed via `services/index.ts` getters/setters) → `repositories/*` (Prisma data access) → `db.ts` (Prisma client over a better-sqlite3 adapter). Keep this direction: routes shouldn't touch Prisma directly. Cross-cutting helpers live in `lib/` (auth/JWT/CSRF, NIP-49 encryption, relay pool, logging, TTL cache, validation).

### Real-time updates
The daemon pushes state to the UI over Server-Sent Events at `/events` (`http/routes/events.ts`, `EventService`). Health stats and request/app/log changes are emitted here; the UI's `ServerEventsContext` fans them out to data hooks.

### Persistence
Prisma + SQLite. Schema at `apps/signet/prisma/schema.prisma`; migrations in `apps/signet/prisma/migrations/` apply automatically on daemon start. Core models: `Key`, `KeyUser` (a connected app = a key+pubkey pair, with trust level and suspension state), `Request`, `Token`, `SigningCondition`, `Log`. `better-sqlite3` and `@prisma/engines` are in `onlyBuiltDependencies` (root `package.json`) — they need native builds.

### Security model (touch carefully)
Keys are encrypted at rest with NIP-49 (`lib/nip49.ts`, preferred) or legacy AES-256-GCM (`config/keyring.ts`). The REST API uses JWT auth, CORS origin allowlisting, CSRF tokens, and rate limiting (all in `lib/auth.ts`). An optional Inactivity Lock / Dead Man's Switch (`services/dead-man-switch-service.ts`) locks keys and suspends apps. An optional kill switch (`services/admin-command-service.ts`, see `docs/KILLSWITCH.md`) accepts signed DM commands from an admin npub. The daemon is designed for private-network access only. See `docs/SECURITY.md`.

### UI structure
`src/App.tsx` composes context providers (`ToastContext`, `SettingsContext`, `ServerEventsContext`) and per-domain panels under `src/components/<domain>/`. Data fetching/state lives in `src/hooks/use*.ts` (`useRequests`, `useKeys`, `useApps`, `useDashboard`, `useRelays`, `useHealth`, `useDeadManSwitch`), each subscribing to SSE events. API calls go through `src/lib/api-client.ts`. In production all UI traffic goes through `server.mjs`, which proxies the daemon API paths (listed in that file) and streams `/events`.

## Conventions

- ESM throughout. Daemon source imports use explicit `.js` extensions (e.g. `./lib/acl.js`) even from `.ts` files — match this; tsup/Node ESM resolution depends on it.
- Shared types belong in `@signet/types`, not duplicated across daemon and UI.
- Version is single-sourced: `pnpm run sync-version` (root) propagates the `VERSION` file to packages.
- Config is auto-generated at `~/.signet-config/signet.json` on first boot; see `docs/CONFIGURATION.md`. Relevant env overrides: `SIGNET_PORT`/`AUTH_PORT`, `SIGNET_HOST`/`AUTH_HOST`, `EXTERNAL_URL`/`BASE_URL` (daemon); `UI_PORT`, `UI_HOST`, `DAEMON_URL` (UI server).
