# Security Model

The premise of Signet is that you can store Nostr private keys (nsecs), use them remotely under certain policies, but these keys can never be exfiltrated from the bunker.

All communication with Signet happens through encrypted, ephemeral Nostr events following the NIP-46 protocol.

## Keys
Within Signet there are two distinct sets of keys:

### User keys (aka target keys)
The keys that users want to sign with (e.g. your personal or company's keys).

These keys are stored encrypted with a passphrase; the same way Lightning Network's LND stores keys locally: every time you start Signet, you must enter the passphrase to decrypt it.

Without this passphrase, keys cannot be used.

### Signet's admin key
Signet generates its own private key, which is used solely to communicate with the administration UI. If this key is compromised, no user key material is at risk.

To interact with Signet's administration UI, the administrator(s)' npubs must be whitelisted in the configuration. All communication between administrators and Signet is end-to-end encrypted using NIP-04.

Non-whitelisted keys simply cannot communicate with Signet's administration interface.

## NIP-46 (Nostr Connect)
Signet listens on configured relays (specified in `signet.json`) for NIP-46 requests from applications attempting to use the target keys.