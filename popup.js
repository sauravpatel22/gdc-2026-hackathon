import { getState, setState } from "./storage.js";
import { DEMO_MULTIPLIER } from "./config.js";

const { stageInfo, mascotSVG } = globalThis.Pause.pet;

const els = {
  pet: document.getElementById("pet"),
  message: document.getElementById("message"),
  fill: document.getElementById("fill"),
  healthText: document.getElementById("healthText"),
  stageLabel: document.getElementById("stageLabel"),
  today: document.getElementById("today"),
  showPet: document.getElementById("showPet"),
  demoTag: document.getElementById("demoTag"),
};

let shownStage = null;

function render(state) {
  const info = stageInfo(state.health);

  if (shownStage !== info.stage) {
    els.pet.innerHTML = mascotSVG(info.stage);
    shownStage = info.stage;
  }
  els.pet.className = `pet ${info.stage}`;
  els.message.textContent = info.message;

  els.fill.style.width = `${info.health}%`;
  els.fill.style.background = info.color;
  els.healthText.textContent = `${Math.round(info.health)} / 100`;
  els.stageLabel.textContent = info.label;
  els.stageLabel.style.color = info.color;

  els.today.textContent =
    `Today: ${Math.round(state.gamblingMinutesToday)} of ${state.budgetMinutes} minutes`;
  els.showPet.checked = !state.petHidden;

  els.demoTag.hidden = !state.demoMode;
  els.demoTag.textContent =
    `DEMO · ${DEMO_MULTIPLIER}x speed · ${Math.round(state.gamblingMinutesToday)} min · health ${Math.round(info.health)}`;
}

els.showPet.addEventListener("change", () => {
  setState({ petHidden: !els.showPet.checked });
});

document.getElementById("openSettings").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// Keep the popup live while it's open.
chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area === "local") render(await getState());
});

render(await getState());
