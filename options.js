import { getState, setState } from "./storage.js";
import { computeHealth } from "./health.js";
import { DEMO_MULTIPLIER } from "./config.js";

const { stageInfo, mascotSVG } = globalThis.Pause.pet;

const MIN_BUDGET = 10;
const MAX_BUDGET = 1440;

const els = {
  form: document.getElementById("form"),
  budget: document.getElementById("budget"),
  budgetHint: document.getElementById("budgetHint"),
  enabled: document.getElementById("enabled"),
  showPet: document.getElementById("showPet"),
  demoMode: document.getElementById("demoMode"),
  demoLabel: document.getElementById("demoLabel"),
  status: document.getElementById("status"),
  resetToday: document.getElementById("resetToday"),
  clearCache: document.getElementById("clearCache"),
  heroPet: document.getElementById("heroPet"),
  heroMessage: document.getElementById("heroMessage"),
  todayText: document.getElementById("todayText"),
  demoBadge: document.getElementById("demoBadge"),
  todayFill: document.getElementById("todayFill"),
  todayHint: document.getElementById("todayHint"),
  budgetRange: document.getElementById("budgetRange"),
  limitNudge: document.getElementById("limitNudge"),
  presets: document.querySelectorAll("[data-minutes]"),
};

let savedBudget = null;
let shownStage = null;
let todayMinutes = 0;
let savedHealth = 100;

els.demoLabel.textContent = `Demo mode (time moves ${DEMO_MULTIPLIER}x faster, for trying things out)`;

function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function currentBudget() {
  const value = Math.round(Number(els.budget.value));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function updateBudgetHint() {
  const value = currentBudget();
  els.budgetHint.textContent = value ? `about ${formatMinutes(value)}` : "";
  if (value) els.budgetRange.value = Math.min(value, Number(els.budgetRange.max));
  els.presets.forEach((chip) => {
    chip.setAttribute("aria-pressed", String(Number(chip.dataset.minutes) === value));
  });

  // Gentle check-in when someone raises their limit, since that's the risky direction.
  const raising = value && savedBudget && value > savedBudget;
  els.limitNudge.hidden = !raising;
  if (raising) {
    els.limitNudge.textContent =
      "Raising your limit? Take a breath first. Does this still match why you started?";
  }
  renderToday(value || savedBudget);
}

// Hero pet and "today" bar reflect today's real minutes against the limit shown in the form.
function renderToday(budget) {
  if (!budget) return;
  const minutes = todayMinutes;
  // Use the tracker's real health while the form's limit matches the saved one.
  const health = budget === savedBudget ? savedHealth : computeHealth(minutes, budget);
  const info = stageInfo(health);
  if (shownStage !== info.stage) {
    els.heroPet.innerHTML = mascotSVG(info.stage);
    els.heroPet.className = `hero-pet ${info.stage}`;
    shownStage = info.stage;
  }
  els.heroMessage.textContent = info.message;
  els.todayFill.style.width = `${info.health}%`;
  els.todayFill.style.background = info.color;
  els.todayFill.parentElement.setAttribute("aria-valuenow", String(Math.round(info.health)));
  els.todayText.textContent = `${Math.round(minutes)} of ${budget} min · health ${Math.round(info.health)}`;
  els.demoBadge.hidden = !els.demoMode.checked;
  const left = Math.max(0, Math.round(budget - minutes));
  els.todayHint.textContent = left > 0
    ? `${formatMinutes(left)} left before Testudo needs to rest. Less is always okay too.`
    : "You've reached your limit for today. Testudo is resting, and tomorrow is a fresh start.";
}

function showStatus(text) {
  els.status.textContent = text;
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => (els.status.textContent = ""), 4000);
}

async function load() {
  const state = await getState();
  savedBudget = state.budgetMinutes;
  todayMinutes = state.gamblingMinutesToday;
  savedHealth = state.health;
  els.budget.value = state.budgetMinutes;
  els.enabled.checked = state.enabled;
  els.showPet.checked = !state.petHidden;
  els.demoMode.checked = state.demoMode;
  updateBudgetHint();
}

els.budget.addEventListener("input", updateBudgetHint);
els.demoMode.addEventListener("change", updateBudgetHint);

// Keep today's minutes live while the settings page is open (demo mode moves fast).
chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== "local") return;
  const state = await getState();
  todayMinutes = state.gamblingMinutesToday;
  savedHealth = state.health;
  updateBudgetHint();
});
els.budgetRange.addEventListener("input", () => {
  els.budget.value = els.budgetRange.value;
  updateBudgetHint();
});
els.presets.forEach((chip) => chip.addEventListener("click", () => {
  els.budget.value = chip.dataset.minutes;
  updateBudgetHint();
}));
els.form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const raw = Math.round(Number(els.budget.value));
  const budget = Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, Number.isFinite(raw) ? raw : 120));
  els.budget.value = budget;
  updateBudgetHint();

  const state = await getState();
  await setState({
    budgetMinutes: budget,
    // Re-score health against the new limit so Testudo and the badge match right away.
    health: computeHealth(state.gamblingMinutesToday, budget),
    enabled: els.enabled.checked,
    petHidden: !els.showPet.checked,
    demoMode: els.demoMode.checked,
  });

  savedBudget = budget;
  updateBudgetHint();
  showStatus(raw === budget ? "Saved ✓ Testudo is on it." : `Saved. I set your limit to ${budget} minutes, the closest allowed.`);
});

els.resetToday.addEventListener("click", async () => {
  if (!confirm("Start today fresh? Today's minutes go back to 0 and Testudo feels great again.")) return;
  await setState({ gamblingMinutesToday: 0, health: 100, lastGamblingAt: null });
  todayMinutes = 0;
  updateBudgetHint();
  showStatus("All fresh. Testudo is feeling great.");
});

els.clearCache.addEventListener("click", async () => {
  if (!confirm("Forget every site PausePet has remembered?")) return;
  await setState({ cache: {} });
  showStatus("Done. PausePet will look at each site again.");
});

await load();
