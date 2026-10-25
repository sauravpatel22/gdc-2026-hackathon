import { getState, setState, todayISO } from "./storage.js";
import { isKnownGamblingDomain } from "./domains.js";
import { classifyWithGemma } from "./gemma.js";
import { computeHealth, getPetStage } from "./health.js";
import { DEMO_MULTIPLIER, RECOVERY_PER_HOUR } from "./config.js";
import { refreshPetLine } from "./petLine.js";
import { record, flush, scheduleFlush, captureBackfill } from "./sync.js";

const LOW_SCORE_THRESHOLD = 0.3;
const GEMMA_MIN_CONFIDENCE = 0.6;
const inFlight = new Map(); // hostname -> pending Gemma promise
const TICK_ALARM = "tick";
const IDLE_SECONDS = 60;
const RECOVERY_DELAY_MS = 10 * 60 * 1000;

// ---------- Alarm setup ----------

async function ensureTickAlarm() {
  const existing = await chrome.alarms.get(TICK_ALARM);
  if (!existing) {
    chrome.alarms.create(TICK_ALARM, { periodInMinutes: 1 });
    console.log("[PausePet] tick alarm created");
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const state = await getState();
  await setState(state);
  await ensureTickAlarm();
  await updateBadge(state.health);
  refreshPetLine();
  console.log("PausePet installed");
});

chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  await updateBadge(state.health);
  refreshPetLine();
});

// Runs every time the service worker wakes up.
ensureTickAlarm();
refreshPetLine();

// ---------- Badge ----------

function badgeColor(health) {
  if (health >= 80) return "#4caf50"; // green
  if (health >= 50) return "#fbc02d"; // yellow
  if (health >= 20) return "#fb8c00"; // orange
  return "#e53935"; // red
}

async function updateBadge(health) {
  await chrome.action.setBadgeText({ text: String(Math.round(health)) });
  await chrome.action.setBadgeBackgroundColor({ color: badgeColor(health) });
}

// Keep the badge in sync when health changes from anywhere (e.g. the settings page).
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.health && typeof changes.health.newValue === "number") {
    updateBadge(changes.health.newValue);
  }
  if (changes.demoMode) syncDemoLoop();
  // refreshPetLine() is a cheap no-op unless the stage or reason changed.
  if (changes.health || changes.reason) refreshPetLine();
});

// ---------- Time tracking ----------

async function ensureDailyReset() {
  const state = await getState();
  const today = todayISO();
  if (state.lastResetDate === today) return state;

  const hadNoGambling = state.gamblingMinutesToday === 0;
  const streak = hadNoGambling ? state.streak + 1 : 0;
  console.log(
    `[PausePet] new day (${state.lastResetDate} -> ${today}), streak ${state.streak} -> ${streak}`
  );
  return setState({ gamblingMinutesToday: 0, streak, lastResetDate: today });
}

async function addGamblingMinute(minutes = 1, site = null) {
  const state = await ensureDailyReset();
  await captureBackfill(); // before any minute is added, so nothing is counted twice
  const added = minutes * (state.demoMode ? DEMO_MULTIPLIER : 1);
  const gamblingMinutesToday = state.gamblingMinutesToday + added;
  const health = computeHealth(gamblingMinutesToday, state.budgetMinutes);

  await setState({ gamblingMinutesToday, health, lastGamblingAt: Date.now() });
  if (site) await record({
    ts: Date.now(), date: todayISO(), hostname: site.hostname, minutes: added,
    health, budget: state.budgetMinutes, source: site.source, demo: false, // demo mode only speeds up tracking; "demo" on the server means sample data
  }).then(() => scheduleFlush());
  await updateBadge(health);
  if (minutes >= 1) console.log(
    `[PausePet] +${added} gambling min -> ${gamblingMinutesToday}/${state.budgetMinutes}, health ${health.toFixed(1)} (${getPetStage(health)})`
  );
}

async function maybeRecover(fraction = 1) {
  const state = await getState();
  if (state.health >= 100) return;

  const multiplier = state.demoMode ? DEMO_MULTIPLIER : 1;
  const delayMs = RECOVERY_DELAY_MS / multiplier;
  const sinceGambling = Date.now() - (state.lastGamblingAt ?? 0);
  if (state.lastGamblingAt !== null && sinceGambling < delayMs) {
    if (fraction >= 1) console.log(
      `[PausePet] no recovery yet (${Math.round(sinceGambling / 1000)}s of ${Math.round(delayMs / 1000)}s since last gambling)`
    );
    return;
  }

  const gain = (RECOVERY_PER_HOUR / 60) * multiplier * fraction;
  const health = Math.min(100, state.health + gain);
  await setState({ health });
  await updateBadge(health);
  if (fraction >= 1) console.log(
    `[PausePet] recovered +${gain.toFixed(2)} -> health ${health.toFixed(1)} (${getPetStage(health)})`
  );
}

async function getActiveHostname() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.url) return null;
  try {
    const url = new URL(tab.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.hostname.toLowerCase();
  } catch {
    return null;
  }
}

// `fraction` is how much of a minute this tick represents (1 for the alarm, 1/60 for the
// once-a-second demo loop).
async function onTick(fraction = 1) {
  const log = fraction >= 1 ? (...args) => console.log(...args) : () => {};
  const state = await getState();
  if (!state.enabled) return;

  const idleState = await chrome.idle.queryState(IDLE_SECONDS);
  if (idleState !== "active") {
    log(`[PausePet] tick skipped (user is ${idleState})`);
    return;
  }

  await ensureDailyReset();
  refreshPetLine();

  const hostname = await getActiveHostname();
  if (!hostname) {
    log("[PausePet] tick: no active web page");
    return maybeRecover(fraction);
  }

  const entry = (await getState()).cache[hostname];
  if (entry && entry.gambling) {
    log(`[PausePet] tick: on gambling site ${hostname}`);
    await addGamblingMinute(fraction, { hostname, source: entry.source });
  } else {
    log(`[PausePet] tick: ${hostname} is not gambling`);
    await maybeRecover(fraction);
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== TICK_ALARM) return;
  // In demo mode the once-a-second loop does the work; the alarm just restarts it if the
  // service worker was shut down.
  syncDemoLoop().then((demo) => {
    if (!demo) return onTick();
  }).then(() => flush()).catch((err) => console.log("[PausePet] tick error", err));
});

// ---------- Demo loop ----------
// Demo mode ticks every second (each worth 1/60 of a minute, times DEMO_MULTIPLIER), so the
// badge and every UI move continuously instead of once a minute.

let demoTimer = null;
let demoBusy = false;

async function syncDemoLoop() {
  const { demoMode } = await getState();
  if (demoMode && !demoTimer) {
    demoTimer = setInterval(async () => {
      if (demoBusy) return;
      demoBusy = true;
      try {
        await onTick(1 / 60);
      } catch (err) {
        console.log("[PausePet] demo tick error", err);
      } finally {
        demoBusy = false;
      }
    }, 1000);
    console.log("[PausePet] demo loop started");
  } else if (!demoMode && demoTimer) {
    clearInterval(demoTimer);
    demoTimer = null;
    console.log("[PausePet] demo loop stopped");
  }
  return demoMode;
}

syncDemoLoop();
flush(); // drain the outbox when the service worker wakes up

// ---------- Page detection ----------

async function writeCache(hostname, gambling, source) {
  const { cache } = await getState();
  cache[hostname] = { gambling, source, at: Date.now() };
  await setState({ cache });
}

async function handlePageSignal(msg) {
  const hostname = String(msg.hostname || "").toLowerCase();
  const score = msg.keywordScore;

  if (isKnownGamblingDomain(hostname)) {
    await writeCache(hostname, true, "domain");
    console.log(`[PausePet] ${hostname}: gambling (known domain)`);
    return { gambling: true, source: "domain" };
  }

  const { cache } = await getState();
  const cached = cache[hostname];
  if (cached) {
    console.log(`[PausePet] ${hostname}: cache hit, gambling=${cached.gambling}`);
    return { gambling: cached.gambling, source: "cache" };
  }

  if (score < LOW_SCORE_THRESHOLD) {
    await writeCache(hostname, false, "keyword");
    console.log(
      `[PausePet] ${hostname}: not gambling (keywordScore ${score.toFixed(2)} < ${LOW_SCORE_THRESHOLD}), cached`
    );
    return { gambling: false, source: "cache" };
  }

  console.log(
    `[PausePet] ${hostname}: unknown (keywordScore ${score.toFixed(2)}), asking Gemma`
  );

  // Share one Gemma call per hostname so two tabs don't trigger two requests.
  if (!inFlight.has(hostname)) {
    const request = classifyWithGemma({
      url: msg.url,
      title: msg.title,
      textSample: msg.textSample,
    }).finally(() => inFlight.delete(hostname));
    inFlight.set(hostname, request);
  }
  const result = await inFlight.get(hostname);

  // null means Gemma failed: treat as not gambling and don't cache.
  if (!result) return { gambling: false, source: "unknown" };

  const gambling = result.gambling && result.confidence >= GEMMA_MIN_CONFIDENCE;
  await writeCache(hostname, gambling, "gemma");
  console.log(
    `[PausePet] ${hostname}: ${gambling ? "gambling" : "not gambling"} (Gemma ${result.type}, confidence ${result.confidence}), cached`
  );
  return { gambling, source: "gemma" };
}

// ---------- Messages ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  if (msg.type === "PAGE_SIGNAL") {
    handlePageSignal(msg)
      .then(sendResponse)
      .catch((err) => {
        console.log("[PausePet] PAGE_SIGNAL error", err);
        sendResponse({ gambling: false, source: "unknown" });
      });
    return true; // keep the channel open for the async reply
  }

  if (msg.type === "PET_LINE") {
    refreshPetLine();
    return;
  }

  if (msg.type === "DEBUG_ADD_MINUTES") {
    addGamblingMinute(Number(msg.minutes) || 1)
      .then(() => getState())
      .then((s) => sendResponse({ health: s.health, minutes: s.gamblingMinutesToday }))
      .catch((err) => sendResponse({ error: String(err) }));
    return true;
  }
});

// Debug helper: in the service worker console, run debugAddMinutes(30).
// (A service worker can't message itself, so DEBUG_ADD_MINUTES only works from other contexts.)
globalThis.debugAddMinutes = (minutes = 1) => addGamblingMinute(minutes);
globalThis.debugTick = () => onTick();
