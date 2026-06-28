# signet-extension

Browser extension (Chrome + Firefox) to approve Signet NIP-46 signing requests
and new connections without keeping the dashboard tab open.

It is **not** a signer — keys never leave the daemon. The extension is a thin
remote control for the daemon's existing REST/SSE API, the same role the
dashboard and Android app play.

## Status

Phase 1 (current): enter a daemon URL, grant host permission, list pending
requests, approve/deny from the popup.

Planned next: required PIN unlock (`chrome.storage.session`-backed session),
multi-daemon profile switcher, background polling (`chrome.alarms`) with
notification action buttons, and live SSE updates while the popup is open.

## Develop

From the repo root (`@signet/types` must be built — the root `prepare` does this):

```bash
pnpm install
pnpm dev:extension          # builds + watches (HMR) on http://localhost:3030
```

Auto-launch is **disabled** (`webExt.disabled` in `wxt.config.ts`) because Flatpak/
immutable systems have no Chrome binary on PATH for chrome-launcher to find.

### Flatpak Chromium (Bluefin etc.)

Don't use "Load unpacked" — the Flatpak file picker returns a document-portal path
(`/run/flatpak/doc/…`) that Chromium can't load an extension from. Instead, with
`pnpm dev:extension` running in one terminal, launch from another:

```bash
pnpm --filter signet-extension launch     # scripts/dev-chromium.sh
```

This opens Flatpak Chromium in an isolated dev profile with the dev build loaded
by direct path (`--load-extension`), and grants the sandbox read access to the
repo. HMR still works over the dev server (port 3030, kept clear of the daemon's
3000).

### Standard Chrome/Chromium

`chrome://extensions` → **Developer mode** → **Load unpacked** →
`apps/signet-extension/.output/chrome-mv3-dev`.

Build distributables:

```bash
pnpm build:extension        # .output/chrome-mv3
pnpm --filter signet-extension build:firefox
```

## Test

```bash
pnpm --filter signet-extension test    # vitest (vault crypto, storage migration, SSE)
```

## Publishing

```bash
pnpm --filter signet-extension zip          # Chrome Web Store package
pnpm --filter signet-extension zip:firefox  # AMO package
```

Already in place: icons (`public/icon/`), the Firefox `data_collection_permissions`
declaration (set to `none`), and a [privacy policy](./PRIVACY.md). Still needed at
submission time (these are content, not code): store screenshots of the popup,
a short + long description, and the privacy-policy URL. Versions are kept in sync
from the root `VERSION` file via `pnpm sync-version`.

## How it reaches the daemon

The daemon defaults to `requireAuth: false` and trusts the private network, so —
like the Android app — you just enter its URL. The one browser-specific wrinkle
is CORS: the extension requests the daemon's origin via
`browser.permissions.request`, and MV3 grants CORS-free fetch to that host. For
hardened (`requireAuth: true`) daemons, a JWT goes in the optional token field
(coming with the PIN/profile slice).

Built with [WXT](https://wxt.dev): one `src`, per-browser manifests generated
from `wxt.config.ts`.
