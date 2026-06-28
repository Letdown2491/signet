import { browser, defineBackground } from '#imports';
import { DaemonClient, type DaemonTarget } from '../src/lib/client';
import { streamPendingChanges } from '../src/lib/sse';
import { currentTarget } from '../src/lib/target';

// Reconnect heartbeat. The live SSE stream is what gives instant updates — and
// the ongoing streamed fetch keeps the MV3 service worker alive while it's open.
// This alarm is the safety net: it both doubles as a keepalive (an alarm event
// wakes the worker, resetting its idle timer) and revives the connection if the
// stream (or the whole worker) dropped. Chrome floors alarm periods at 30s, so
// the worst case after an unexpected worker death is a ~30s-stale badge that
// then self-heals on reconnect. (A runtime.Port keepalive could tighten that if
// staleness is ever observed in practice.)
const RECONNECT_ALARM = 'reconnect';

let streaming = false;
let controller: AbortController | null = null;

export default defineBackground(() => {
  // White badge with a black number — far more legible than a tinted fill.
  browser.action.setBadgeBackgroundColor({ color: '#ffffff' });
  browser.action.setBadgeTextColor({ color: '#000000' });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === RECONNECT_ALARM) void ensureStream();
  });
  browser.runtime.onInstalled.addListener(start);
  browser.runtime.onStartup.addListener(start);

  // Reconnect when the active daemon changes (profiles/activeProfileId, local) or
  // the vault is unlocked/locked (session) — the latter so a requireAuth token
  // starts being used immediately.
  browser.storage.onChanged.addListener((changes, area) => {
    const daemonChanged = area === 'local' && (changes.profiles || changes.activeProfileId);
    const lockChanged = area === 'session' && changes.unlocked;
    if (daemonChanged || lockChanged) {
      controller?.abort();
      void ensureStream();
    }
  });

  start();
});

function start(): void {
  browser.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
  void ensureStream();
}

/** Hold a single SSE connection at a time; the alarm retries if it ends. */
async function ensureStream(): Promise<void> {
  if (streaming) return;
  streaming = true;
  try {
    await streamEvents();
  } catch {
    // Daemon unreachable or stream dropped — the reconnect alarm will retry.
  } finally {
    streaming = false;
  }
}

async function streamEvents(): Promise<void> {
  const target = await currentTarget();
  if (!target) {
    await setBadge(0);
    return;
  }

  controller = new AbortController();
  await refreshBadge(target); // reconcile up front (covers anything missed while disconnected)

  const client = new DaemonClient(target);
  await streamPendingChanges(client, () => refreshBadge(target), controller.signal);
}

async function refreshBadge(target: DaemonTarget): Promise<void> {
  try {
    const { requests } = await new DaemonClient(target).listPending();
    await setBadge(requests.length);
  } catch {
    // Leave the badge as-is rather than zeroing it on a transient error.
  }
}

async function setBadge(count: number): Promise<void> {
  await browser.action.setBadgeText({ text: count ? String(count) : '' });
}
