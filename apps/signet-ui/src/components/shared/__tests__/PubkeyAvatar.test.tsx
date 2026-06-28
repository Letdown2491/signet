import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PubkeyAvatar } from '../PubkeyAvatar';

const PK_A = '3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d';
const PK_B = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';

function bg(container: HTMLElement): string {
  const span = container.querySelector('span');
  return (span as HTMLElement).style.background;
}

describe('PubkeyAvatar', () => {
  it('is deterministic — the same pubkey always renders the same gradient', () => {
    const a1 = render(<PubkeyAvatar pubkey={PK_A} />);
    const a2 = render(<PubkeyAvatar pubkey={PK_A} />);
    expect(bg(a1.container)).toBe(bg(a2.container));
    expect(bg(a1.container)).toContain('linear-gradient');
  });

  it('renders distinct gradients for distinct pubkeys (so an impostor looks different)', () => {
    const a = render(<PubkeyAvatar pubkey={PK_A} />);
    const b = render(<PubkeyAvatar pubkey={PK_B} />);
    expect(bg(a.container)).not.toBe(bg(b.container));
  });

  it('is decorative — hidden from assistive tech, with the npub as its tooltip', () => {
    const { container } = render(<PubkeyAvatar pubkey={PK_A} title="npub1abc" />);
    const span = container.querySelector('span') as HTMLElement;
    expect(span.getAttribute('aria-hidden')).toBe('true');
    expect(span.getAttribute('title')).toBe('npub1abc');
  });

  it('falls back to a neutral fill for an empty pubkey instead of crashing', () => {
    const { container } = render(<PubkeyAvatar pubkey="" />);
    expect(bg(container)).not.toContain('linear-gradient');
  });
});
