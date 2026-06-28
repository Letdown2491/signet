# Signet Extension — Privacy Policy

_Last updated: 2026-06-28_

The Signet browser extension is a client for your own Signet server (a NIP-46
remote signer you run). It is designed to send your data **nowhere except the
server you configure**.

## What the extension does NOT do

- It does **not** collect analytics or telemetry.
- It does **not** send any data to the developer or any third party.
- It does **not** include trackers, ads, or remote code.
- It never has access to your private keys — those stay on your Signet server.

## What it stores, and where

All data is stored **locally in your browser** and is never transmitted anywhere
except to the Signet server(s) you configure:

- **Server list** — the label and URL of each Signet server you add
  (`chrome.storage.local`).
- **Encrypted vault** — if your server requires an auth token, that token is
  encrypted with a key derived from your PIN (Argon2id) and stored locally. The
  PIN itself is never stored.
- **Settings** — e.g. your auto-lock timeout (`chrome.storage.local`).
- **Unlock session** — held in memory only (`chrome.storage.session`) and cleared
  when the browser closes.

Removing the extension, or using "Reset extension" in Settings, deletes all of
this local data.

## Network access

The extension communicates **only** with the Signet server URL(s) you enter, to:

- check the server is reachable (`/health`),
- receive live request updates (`/events`),
- list and approve/deny signing requests, and manage connected apps.

The host permission you grant at setup is scoped to the server URL you provide.

## Permissions

- **storage** — to save your server list, settings, and the encrypted vault.
- **alarms** — to periodically reconnect the live update stream.
- **host permission (your server URL)** — to reach your Signet server.

## Contact

Questions: open an issue at the Signet repository.
