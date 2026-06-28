export function describeError(e: unknown): string {
  if (e instanceof TypeError) {
    // fetch network failure — most often an unreachable server (off the tailnet,
    // asleep, or a wrong URL).
    return 'Could not reach the server. Check the URL and that you are on the same network.';
  }
  return e instanceof Error ? e.message : String(e);
}
