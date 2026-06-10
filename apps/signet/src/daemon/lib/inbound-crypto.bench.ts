// Throughput benchmark for the inbound NIP-46 crypto path.
//
// Establishes the baseline cost of each step the daemon performs on every
// incoming request, so we can quantify the win from caching the ECDH-derived
// conversation key (getConversationKey). Run with: `npm run bench`.
//
// The numbers to watch:
//   - getConversationKey (ECDH) dominates; the symmetric decrypt is ~90x faster
//   - "full inbound" = verifyEvent + ECDH + decrypt, the real per-request cost
//   - caching the conversation key should move "full inbound" toward the
//     verifyEvent rate (the security-mandated floor)

import { bench, describe } from 'vitest'
import {
  generateSecretKey,
  getPublicKey,
  finalizeEvent,
  verifyEvent,
  type Event,
} from 'nostr-tools/pure'
import {
  encrypt as nip44Encrypt,
  decrypt as nip44Decrypt,
  getConversationKey,
} from 'nostr-tools/nip44'
import {
  encrypt as nip04Encrypt,
  decrypt as nip04Decrypt,
} from 'nostr-tools/nip04'

const NIP46_KIND = 24133

// Fixtures: a signer (the bunker key) and a client (a connected app).
const signerSecret = generateSecretKey()
const signerPubkey = getPublicKey(signerSecret)
const clientSecret = generateSecretKey()
const clientPubkey = getPublicKey(clientSecret)

const requestPayload = JSON.stringify({
  id: 'bench-1',
  method: 'get_public_key',
  params: [],
})

// The ECDH-derived conversation key — this is exactly what Signet would cache.
const conversationKey = getConversationKey(signerSecret, clientPubkey)

// A realistic inbound request event: kind 24133, NIP-44 sealed, signed by the
// client, p-tagged to the signer — exactly what the relay delivers.
const nip44Content = nip44Encrypt(requestPayload, conversationKey)
const inboundEvent = finalizeEvent(
  {
    kind: NIP46_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['p', signerPubkey]],
    content: nip44Content,
  },
  clientSecret,
)

// NIP-04 ciphertext for the legacy-fallback comparison.
const nip04Content = nip04Encrypt(clientSecret, signerPubkey, requestPayload)

// nostr-tools memoizes verifyEvent's result on the event object (via an internal
// symbol), so verifying the same object twice is a no-op. The daemon receives a
// fresh, unverified event per request, so we rebuild a clean event each
// iteration to measure real Schnorr verification.
function freshInboundEvent(): Event {
  return {
    id: inboundEvent.id,
    pubkey: inboundEvent.pubkey,
    created_at: inboundEvent.created_at,
    kind: inboundEvent.kind,
    tags: inboundEvent.tags,
    content: inboundEvent.content,
    sig: inboundEvent.sig,
  }
}

describe('inbound NIP-46 crypto throughput', () => {
  bench('getConversationKey (ECDH)', () => {
    getConversationKey(signerSecret, clientPubkey)
  })

  bench('nip44 symmetric decrypt (key precomputed)', () => {
    nip44Decrypt(nip44Content, conversationKey)
  })

  bench('verifyEvent (Schnorr verify)', () => {
    verifyEvent(freshInboundEvent())
  })

  bench('nip44_decrypt (ECDH + decrypt, key recomputed)', () => {
    const key = getConversationKey(signerSecret, inboundEvent.pubkey)
    nip44Decrypt(inboundEvent.content, key)
  })

  bench('nip04_decrypt (ECDH + decrypt)', () => {
    nip04Decrypt(signerSecret, inboundEvent.pubkey, nip04Content)
  })

  bench('full inbound crypto (verify + ECDH + decrypt)', () => {
    const event = freshInboundEvent()
    if (!verifyEvent(event)) throw new Error('verify failed')
    const key = getConversationKey(signerSecret, event.pubkey)
    nip44Decrypt(event.content, key)
  })

  // The optimized path: the conversation key is served from cache (a hit), so
  // the per-request cost is just verify + symmetric decrypt. This is the target
  // throughput once the ECDH is memoized.
  bench('full inbound crypto (cached key: verify + decrypt)', () => {
    const event = freshInboundEvent()
    if (!verifyEvent(event)) throw new Error('verify failed')
    nip44Decrypt(event.content, conversationKey)
  })
})
