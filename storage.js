import { DEFAULT_BUDGET_MINUTES } from "./config.js";

export function getDefaultState() {
  return {
    health: 100,
    gamblingMinutesToday: 0,
    budgetMinutes: DEFAULT_BUDGET_MINUTES,
    lastResetDate: new Date().toISOString().slice(0, 10),
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
