import React from 'react';

interface PubkeyAvatarProps {
  /** Hex pubkey (the identity). The avatar is derived from this, never from a display name. */
  pubkey: string;
  /** Diameter in px. */
  size?: number;
  /** Tooltip — typically the full npub, so hovering reveals the identity. */
  title?: string;
  className?: string;
}

/**
 * FNV-1a hash over the hex pubkey. Deterministic and dependency-free so the same key
 * always yields the same avatar (and a spoofed name on a *different* key looks different).
 */
function hashPubkey(pubkey: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < pubkey.length; i++) {
    h ^= pubkey.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A deterministic gradient-disc identicon seeded from a pubkey. Decorative (aria-hidden) —
 * the adjacent npub/name conveys identity to assistive tech; this is a fast visual fingerprint
 * so operators recognize a returning app and notice an impostor at a glance.
 */
export function PubkeyAvatar({ pubkey, size = 20, title, className }: PubkeyAvatarProps) {
  const h = pubkey ? hashPubkey(pubkey) : 0;
  const hue1 = h % 360;
  // Keep the two stops a meaningful distance apart so the gradient is legible, not muddy.
  const hue2 = (hue1 + 90 + ((h >> 8) % 180)) % 360;
  const angle = (h >> 16) % 360;

  const style: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    background: pubkey
      ? `linear-gradient(${angle}deg, hsl(${hue1} 65% 55%), hsl(${hue2} 70% 45%))`
      : 'var(--surface-2)',
    boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, 0.25)',
  };

  return <span className={className} style={style} title={title} aria-hidden="true" />;
}
