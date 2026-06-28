import { useState } from 'react';
import { PubkeyAvatar } from './PubkeyAvatar.js';

interface AppAvatarProps {
  /** Hex pubkey — seeds the identicon fallback. */
  pubkey: string;
  /** App (KeyUser) id — used to request the daemon's avatar proxy. */
  appId: number;
  /** Whether the app supplied a validated image (from ConnectedApp.hasImage). */
  hasImage?: boolean;
  /** Diameter in px. */
  size?: number;
  /** Tooltip — typically the npub. */
  title?: string;
}

/**
 * App avatar with a safe image path. When the app supplied an image we load it from the
 * daemon's SSRF-guarded proxy (`/apps/:id/avatar`) — never the raw client URL — and fall
 * back to the deterministic {@link PubkeyAvatar} identicon when there's no image or the
 * proxy returns nothing (404 / blocked / unreachable). Decorative: identity is conveyed by
 * the adjacent name/npub, so the image is aria-hidden like the identicon.
 */
export function AppAvatar({ pubkey, appId, hasImage, size = 20, title }: AppAvatarProps) {
  const [failed, setFailed] = useState(false);

  if (!hasImage || failed) {
    return <PubkeyAvatar pubkey={pubkey} size={size} title={title} />;
  }

  return (
    <img
      src={`/apps/${appId}/avatar`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      title={title}
      onError={() => setFailed(true)}
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        objectFit: 'cover',
        flexShrink: 0,
        display: 'block',
        boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, 0.25)',
      }}
    />
  );
}
