/**
 * A deterministic gradient avatar derived from a pubkey, so each connected app
 * is recognizable at a glance without fetching any profile data.
 */
export function Avatar({ pubkey, size = 28 }: { pubkey: string; size?: number }) {
  const [h1, h2] = hues(pubkey);
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${h1} 60% 58%), hsl(${h2} 62% 46%))`,
      }}
      aria-hidden="true"
    />
  );
}

function hues(pubkey: string): [number, number] {
  let a = 7;
  let b = 131;
  for (let i = 0; i < pubkey.length; i++) {
    const c = pubkey.charCodeAt(i);
    a = (a * 31 + c) % 360;
    b = (b * 17 + c) % 360;
  }
  return [a, (a + 40 + b) % 360];
}
