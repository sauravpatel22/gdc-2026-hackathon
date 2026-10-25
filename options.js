import { getState, setState } from "./storage.js";
import { computeHealth } from "./health.js";
import { DEMO_MULTIPLIER } from "./config.js";

const MIN_BUDGET = 10;
const MAX_BUDGET = 1440;

const els = {
  form: document.getElementById("form"),
  budget: document.getElementById("budget"),
  budgetHint: document.getElementById("budgetHint"),
  enabled: document.getElementById("enabled"),
  showPet: document.getElementById("showPet"),
  reason: document.getElementById("reason"),
  demoMode: document.getElementById("demoMode"),
  demoLabel: document.getElementById("demoLabel"),
  status: document.getElementById("status"),
  resetToday: document.getElementById("resetToday"),
  clearCache: document.getElementById("clearCache"),
};

els.demoLabel.textContent = `Demo mode (time moves ${DEMO_MULTIPLIER}x faster, for trying things out)`;

function formatMinutes(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function updateBudgetHint() {
  const value = Math.round(Number(els.budget.value));
  els.budgetHint.textContent = Number.isFinite(value) && value > 0 ? `about ${formatMinutes(value)}` : "";
}

function showStatus(text) {
  els.status.textContent = text;
  clearTimeout(showStatus.timer);
  showStatus.timer = setTimeout(() => (els.status.textContent = ""), 4000);
}

async function load() {
  const state = await getState();
  els.budget.value = state.budgetMinutes;
  els.enabled.checked = state.enabled;
  els.showPet.checked = !state.petHidden;
  els.reason.value = state.reason;
  els.demoMode.checked = state.demoMode;
  updateBudgetHint();
}

els.budget.addEventListener("input", updateBudgetHint);

els.form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const raw = Math.round(Number(els.budget.value));
  const budget = Math.min(MAX_BUDGET, Math.max(MIN_BUDGET, Number.isFinite(raw) ? raw : 120));
  els.budget.value = budget;
  updateBudgetHint();

  const state = await getState();
  await setState({
    budgetMinutes: budget,
    // Re-score health against the new limit so the pigeon and badge match right away.
    health: computeHealth(state.gamblingMinutesToday, budget),
    enabled: els.enabled.checked,
    petHidden: !els.showPet.checked,
    reason: els.reason.value.trim(),
    demoMode: els.demoMode.checked,
  });

  showStatus(raw === budget ? "Saved." : `Saved. I set your limit to ${budget} minutes, the closest allowed.`);
});

els.resetToday.addEventListener("click", async () => {
  if (!confirm("Start today fresh? Today's minutes go back to 0 and your pigeon feels great again.")) return;
  await setState({ gamblingMinutesToday: 0, health: 100, lastGamblingAt: null });
  showStatus("All fresh. Your pigeon is feeling great.");
});

els.clearCache.addEventListener("click", async () => {
  if (!confirm("Forget every site PausePet has remembered?")) return;
  await setState({ cache: {} });
  showStatus("Done. PausePet will look at each site again.");
});

await load();
