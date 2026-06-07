# Kill Switch

Emergency remote control for Signet via Nostr DMs. Lock keys and suspend apps when you can't access the web UI or Android app.

## Overview

The kill switch allows you to send commands to your Signet daemon via Nostr direct messages. This is useful when:

- You're away from home and need to lock down your keys
- Your device with UI access is lost or stolen
- You need emergency lockdown and can't reach the web interface
- You want to check system status remotely

Commands are sent as DMs to any of your Signet-managed keys. The daemon listens for messages from your configured admin npub and executes them.

## Setup

Add the `killSwitch` configuration to your `~/.signet-config/signet.json`:

```json
{
  "killSwitch": {
    "adminNpub": "npub1youradminnpubhere...",
    "adminRelays": ["wss://nos.lol", "wss://relay.primal.net"],
    "dmType": "NIP04"
  }
}
```

| Field | Type | Description |
|-------|------|-------------|
| `adminNpub` | string | Your admin npub - only DMs from this pubkey are accepted |
| `adminRelays` | string[] | Relays to listen for admin DMs (use relays you publish to) |
| `dmType` | `NIP04` \| `NIP17` \| 'both'| DM encryption protocol |

**DM Protocol (`dmType`):**

| Type | Privacy | Compatibility |
|------|---------|---------------|
| `NIP17` | Better - gift-wrapped DMs hide metadata | Amethyst, etc |
| `NIP04` | Basic - metadata exposed | Primal, etc., wider support |

**Tip:** Use at least 2-3 relays for redundancy. Include relays that your Nostr client publishes DMs to.

## Commands

Send any of these commands as a DM to one of your Signet-managed keys:

### Emergency Lockdown

| Command | Action |
|---------|--------|
| `panic` | Lock all keys + suspend all apps |
| `lockall` | Alias for `panic` |
| `killswitch` | Alias for `panic` |

### Key Management

| Command | Action |
|---------|--------|
| `lockall keys` | Lock all encrypted keys |
| `lock <keyname>` | Lock a specific key |

**Examples:**
- `lock main` - Lock the key named "main"
- `lock geek` - Lock the key named "geek"

**Responses:**
- `✓ Locked key 'main'` - Success
- `⚠ Key 'main' not found` - Key doesn't exist
- `⚠ Key 'main' is already locked` - Already locked
- `⚠ Cannot lock 'main' - key is not encrypted` - Unencrypted keys can't be locked

### App Management

| Command | Action |
|---------|--------|
| `suspendall apps` | Suspend all connected apps |
| `suspendall apps for <keyname>` | Suspend apps for a specific key |
| `suspend <appname>` | Suspend a single app by name |
| `resumeall apps` | Resume all suspended apps |
| `resumeall apps for <keyname>` | Resume apps for a specific key |
| `resume <appname>` | Resume a single app by name |

**Examples:**
- `suspend Primal` - Suspend the app named "Primal"
- `suspendall apps for main` - Suspend all apps connected to key "main"
- `resume Damus` - Resume the app named "Damus"

### Status

| Command | Action |
|---------|--------|
| `status` | Get current system status |

**Response format:**
```
Signet v1.4.0 Status
Keys: 2 active, 1 locked
Apps: 5 connected (1 suspended)
```

## How It Works

1. **Subscribe**: Daemon connects to `adminRelays` and subscribes to DMs addressed to all managed key pubkeys
2. **Verify**: When a DM arrives, daemon checks if sender matches `adminNpub`
3. **Decrypt**: Message is decrypted using NIP-04 or NIP-17 (based on `dmType`)
4. **Execute**: Command is parsed and executed
5. **Reply**: Confirmation DM is sent back to your admin pubkey

## Audit Logging

All kill switch commands are logged for security audit purposes:

- **Event type**: `command_executed`
- **Logged data**: Command text, result, timestamp, client info
- **Visibility**: Activity page → Admin tab in web UI and Android app

Commands are logged even when they don't change state (e.g., locking an already-locked key). This provides a complete audit trail.

The `status` command is logged separately as `status_checked`.

## Troubleshooting

### Commands not received

1. **Check relay connectivity**: Look for `[KillSwitch] Connected to wss://...` in daemon logs
2. **Verify adminRelays**: Use relays your Nostr client actually publishes to
3. **Check adminNpub**: Ensure it matches the npub you're sending from (not your Signet key)

### Wrong DM type

If using NIP-17 but your client only supports NIP-04 (or vice versa):
- Change `dmType` in config to match your client
- Restart the daemon

### No response received

1. **Check relay overlap**: Your client needs to read from at least one relay in `adminRelays`
2. **Look for errors**: Check daemon logs for `[KillSwitch] Error` messages
3. **Verify decryption**: Wrong DM type will fail silently

### Relay shows "Connected" but no "subscription active"

Some relays may not support the event kinds used:
- NIP-04: kind 4 (encrypted DMs)
- NIP-17: kind 1059 (gift wraps)

Try different relays or check if the relay requires authentication.

## Security Considerations

1. **Protect your admin npub**: Anyone with access to your admin private key can control your Signet
2. **Use NIP-17 when possible**: Provides better privacy
3. **Multiple relays**: Use 2-3 relays for redundancy in case one is down
4. **Review audit logs**: Periodically check the Admin tab for unexpected commands
5. **Separate admin key**: Always use a dedicated npub for admin commands, not your main npub. The admin npub should not be added as a managed key in Signet.
