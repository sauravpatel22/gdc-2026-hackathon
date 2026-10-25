import { BACKEND_URL } from "./config.js";
import { getState, setState } from "./storage.js";

const OUTBOX_CAP = 5000;
const BATCH_SIZE = 500;
const MAX_BATCHES_PER_FLUSH = 10;
const TIMEOUT_MS = 5000;

// Serializes every read-modify-write of `outbox` and `pendingBackfill`. The demo loop ticks
// every second, so unguarded writes could overwrite each other.
let chain = Promise.resolve();
function locked(fn) {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

const keyOf = (e) => `${e.ts}|${e.hostname}`;

// Snapshot today's numbers once, before the first tick is recorded, so ticks already in the
// outbox are never counted twice. The minutes belong to lastResetDate until the daily reset runs.
export function captureBackfill() {
  return locked(async () => {
    const s = await getState();
    if (s.syncBackfillDone) return;
    await setState({
      pendingBackfill: {
        type: "backfill", user_id: s.userId, ts: Date.now(), date: s.lastResetDate,
        minutes: s.gamblingMinutesToday, streak: s.streak, budget: s.budgetMinutes,
        health: s.health, demo: false,
      },
      syncBackfillDone: true,
    });
  });
}

export function record(fields) {
  return locked(async () => {
    const s = await getState();
    const outbox = [
      ...s.outbox,
      { type: "tick", user_id: s.userId, tz_offset: new Date().getTimezoneOffset(), ...fields },
    ];
    if (outbox.length > OUTBOX_CAP) outbox.splice(0, outbox.length - OUTBOX_CAP);
    await setState({ outbox });
  });
}

let flushing = false;
let flushTimer = null;

// Push soon after a tick is recorded instead of waiting for the once-a-minute alarm, so the
// dashboard follows live. Coalesces the demo loop's once-a-second ticks into one request.
export function scheduleFlush(delayMs = 2000) {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, delayMs);
}

// Never throws: the extension must work with the backend off.
export async function flush() {
  if (flushing) return;
  flushing = true;
  try {
    for (let i = 0; i < MAX_BATCHES_PER_FLUSH; i++) {
      await captureBackfill();
      const { pendingBackfill, outbox } = await getState();
      const ticks = outbox.slice(0, BATCH_SIZE);
      const batch = [...(pendingBackfill ? [pendingBackfill] : []), ...ticks];
      if (batch.length === 0) return;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`${BACKEND_URL}/api/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batch),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        console.log(`[PausePet] sync failed (${err.message || err}); will retry`);
        return;
      } finally {
        clearTimeout(timer);
      }

      // Remove by key, not index: the cap may have trimmed the front during the request.
      const sent = new Set(ticks.map(keyOf));
      await locked(async () => {
        const s = await getState();
        await setState({
          outbox: s.outbox.filter((e) => !sent.has(keyOf(e))),
          ...(pendingBackfill ? { pendingBackfill: null } : {}),
        });
      });
      if (ticks.length < BATCH_SIZE) return;
    }
  } catch (err) {
    console.log("[PausePet] sync error", err);
  } finally {
    flushing = false;
  }
}
