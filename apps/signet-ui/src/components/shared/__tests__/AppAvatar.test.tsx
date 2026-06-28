import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { AppAvatar } from '../AppAvatar';

const PK = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';

describe('AppAvatar', () => {
  it('renders the identicon (no img request) when the app has no image', () => {
    const { container } = render(<AppAvatar pubkey={PK} appId={1} hasImage={false} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('span')).not.toBeNull();
  });

  it('loads from the daemon avatar proxy — never the raw client URL — when hasImage', () => {
    const { container } = render(<AppAvatar pubkey={PK} appId={42} hasImage />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    // Same-origin proxy path, keyed by app id; the untrusted URL never reaches the browser.
    expect(img!.getAttribute('src')).toBe('/apps/42/avatar');
  });

  it('falls back to the identicon when the proxied image fails to load', () => {
    const { container } = render(<AppAvatar pubkey={PK} appId={7} hasImage />);
    const img = container.querySelector('img')!;
    fireEvent.error(img);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('span')).not.toBeNull();
  });
});
