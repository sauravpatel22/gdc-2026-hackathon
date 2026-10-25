import { getState, setState, todayISO } from "./storage.js";
import { isKnownGamblingDomain } from "./domains.js";
import { classifyWithGemma } from "./classifier.js";
import { computeHealth, getPetStage } from "./health.js";
import { DEMO_MULTIPLIER, RECOVERY_PER_HOUR } from "./config.js";

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
  console.log("PausePet installed");
});

chrome.runtime.onStartup.addListener(async () => {
  const state = await getState();
  await updateBadge(state.health);
});

// Runs every time the service worker wakes up.
ensureTickAlarm();

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
  if (area === "local" && changes.health && typeof changes.health.newValue === "number") {
    updateBadge(changes.health.newValue);
  }
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

async function addGamblingMinute(minutes = 1) {
  const state = await ensureDailyReset();
  const added = minutes * (state.demoMode ? DEMO_MULTIPLIER : 1);
  const gamblingMinutesToday = state.gamblingMinutesToday + added;
  const health = computeHealth(gamblingMinutesToday, state.budgetMinutes);

  await setState({ gamblingMinutesToday, health, lastGamblingAt: Date.now() });
  await updateBadge(health);
  console.log(
    `[PausePet] +${added} gambling min -> ${gamblingMinutesToday}/${state.budgetMinutes}, health ${health.toFixed(1)} (${getPetStage(health)})`
  );
}

async function maybeRecover() {
  const state = await getState();
  if (state.health >= 100) return;

  const sinceGambling = Date.now() - (state.lastGamblingAt ?? 0);
  if (state.lastGamblingAt !== null && sinceGambling < RECOVERY_DELAY_MS) {
    console.log(
      `[PausePet] no recovery yet (${Math.round(sinceGambling / 60000)} of 10 min since last gambling)`
    );
    return;
  }

  const gain = (RECOVERY_PER_HOUR / 60) * (state.demoMode ? DEMO_MULTIPLIER : 1);
  const health = Math.min(100, state.health + gain);
  await setState({ health });
  await updateBadge(health);
  console.log(
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

async function onTick() {
  const state = await getState();
  if (!state.enabled) return;

  const idleState = await chrome.idle.queryState(IDLE_SECONDS);
  if (idleState !== "active") {
    console.log(`[PausePet] tick skipped (user is ${idleState})`);
    return;
  }

  await ensureDailyReset();

  const hostname = await getActiveHostname();
  if (!hostname) {
    console.log("[PausePet] tick: no active web page");
    return maybeRecover();
  }

  const entry = (await getState()).cache[hostname];
  if (entry && entry.gambling) {
    console.log(`[PausePet] tick: on gambling site ${hostname}`);
    await addGamblingMinute();
  } else {
    console.log(`[PausePet] tick: ${hostname} is not gambling`);
    await maybeRecover();
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== TICK_ALARM) return;
  onTick().catch((err) => console.log("[PausePet] tick error", err));
});

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
