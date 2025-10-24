# OAuth-like account flow

This flow lets a bunker provision brand-new keys/accounts for end users through a browser, without them handling raw nsecs. It relies on the HTTP endpoints exposed when `baseUrl` and `authPort` are configured.

## How it works

1. A client issues a NIP‑46 `create_account` request to the bunker with desired `[username, domain, email]`.
2. The bunker responds with an `auth_url`. The client opens that URL for the user.
3. The user completes the form hosted by the bunker (`/register/:id`), supplying a password and optional email/redirect.
4. The bunker creates the key, optional wallet, records metadata, and whitelists the requesting client.
5. The original NIP‑46 request returns the new pubkey (or redirects back with a `pubkey` query param if a callback URL was provided).

## Required configuration

In `signet.json`:

- `baseUrl`: public URL pointing to the bunker (e.g., `https://bunker.example.com`). The web UI uses this to build approval links.
- `authPort`: local port Fastify should listen on (e.g., `3000`). Expose it via reverse proxy or Docker port mapping.
- `domains`: map of allowed domains and how to manage their NIP‑05/NIP‑89 records.

Example snippet:

```json
{
  "baseUrl": "https://bunker.example.com",
  "authPort": 3000,
  "domains": {
    "example.com": {
      "nip05": "/srv/nip05/example.com.json",
      "nip89": {
        "profile": {
          "name": "Example Bunker",
          "about": "Managed access to example.com keys"
        },
        "operator": "npub1operator...",
        "relays": [
          "wss://relay.damus.io",
          "wss://relay.primal.net"
        ]
      },
      "wallet": {
        "lnbits": {
          "url": "https://legend.lnbits.com",
          "key": "<lnbits-admin-key>",
          "nostdressUrl": "https://nostdress.example.com"
        }
      }
    }
  }
}
```

### Domain helpers

- `nip05`: path to the JSON file containing NIP‑05 mappings. The bunker appends new users here. Make sure it is writable and served publicly.
- `nip89`: optional metadata for NIP‑89 announcements so clients can discover the bunker.
- `wallet`: optional LNBits setup. When present, the bunker attempts to create an LN address / wallet for each new account.

## HTTP endpoints

When `authPort` is set, the daemon serves:

- `GET /connection` — JSON with bunker URI (`npubUri`, `hexUri`, relays), used by the React UI.
- `GET /requests/:id` — human review page for connect/sign requests.
- `POST /requests/:id` — authorise/deny a pending request (expects `password` if user login is required).
- `POST /register/:id` — complete the OAuth-like signup form.

Expose `/requests` and `/register` through HTTPS if you expect public traffic.

## Client expectations

Clients implementing this flow should:

- Validate the returned `auth_url` origin matches the bunker they connected to.
- Handle cases where `auth_url` is absent (some bunkers might approve directly via DM).
- Poll their original NIP‑46 request until it resolves with the new pubkey (or timeout).
- Optionally, connect again with `connect` once the user completes registration.

## Security notes

- Only admin-npub whitelisted operators can approve requests or manage user accounts.
- Passwords entered into the registration form are hashed with bcrypt before storing.
- Ensure `baseUrl` points to a trusted host and serve the web flow behind TLS.

Refer to the main `README.md` for Docker and pnpm setup, and `docs/configuration.md` for the full config reference.
