import { DEFAULT_BUDGET_MINUTES } from "./config.js";

// Local calendar date as YYYY-MM-DD, so the daily reset happens at local midnight.
export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function getDefaultState() {
  return {
    health: 100,
    gamblingMinutesToday: 0,
    budgetMinutes: DEFAULT_BUDGET_MINUTES,
    lastResetDate: todayISO(),
    streak: 0,
    reason: "",
    demoMode: false,
    enabled: true,
    cache: {},
    cooldowns: {},
    pausesThisWeek: 0,
    lastGamblingAt: null,
  };
}

export async function getState() {
  const stored = await chrome.storage.local.get(null);
  return { ...getDefaultState(), ...stored };
}

export async function setState(partial) {
  await chrome.storage.local.set(partial);
  return getState();
}
