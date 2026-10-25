import { getState, setState } from "./storage.js";
import { getPetStage } from "./health.js";
import { generateText } from "./gemma.js";

const MOODS = {
  happy: "happy and energetic",
  tired: "a little tired",
  sick: "not feeling well",
  asleep: "worn out and resting",
};
const MAX_WORDS = 28;
const RETRY_AFTER_MS = 60 * 1000;

let busy = false;
let lastFailAt = 0;

function timeOfDay(date = new Date()) {
  const h = date.getHours();
  if (h < 5) return "late at night";
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  if (h < 21) return "evening";
  return "night";
}

const STAGE_ORDER = ["happy", "tired", "sick", "asleep"];

function buildPrompt({ stage, previousStage, minutes, budget, streak, reason }) {
  const lines = [
    "You are Testudo, a gentle terrapin pet who lives in the person's browser.",
    "Write ONE short sentence (at most 20 words) to the person, in Testudo's warm voice.",
    "Speak to them directly as \"you\".",
    "Never shame, scold, or lecture. Do not use emojis, quotes, or hashtags.",
    "Do not give medical advice. Reply with the sentence only.",
    "",
    previousStage && previousStage !== stage
      ? `Testudo just went from feeling ${MOODS[previousStage]} to ${MOODS[stage]}${
          STAGE_ORDER.indexOf(stage) > STAGE_ORDER.indexOf(previousStage) ? ", because of time on gambling sites" : ", because the person took a break"
        }.`
      : `Testudo's mood: ${MOODS[stage]}.`,
    `It is ${timeOfDay()}.`,
    `Today: ${Math.round(minutes)} of ${budget} gambling-site minutes used.`,
    `Clean-day streak: ${streak}.`,
  ];
  if (reason) {
    lines.push(
      "The person wrote their own reason for cutting back. Weave its spirit into your sentence, in your own words:",
      `"""${reason}"""`
    );
  }
  return lines.join("\n");
}

// Keep only a single clean sentence; reject anything that looks off so we fall back to the static line.
export function cleanLine(text) {
  if (!text) return null;
  const line = String(text)
    .split("\n")
    .map((l) => l.trim())
    .find(Boolean);
  if (!line) return null;
  const stripped = line.replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, "");
  if (!stripped || stripped.split(/\s+/).length > MAX_WORDS) return null;
  return stripped;
}

// Asks Gemma for a new line each time Testudo changes stage (and when the reason changes).
// The popup and settings page only read the cached result, so they never wait on the model.
export async function refreshPetLine() {
  if (busy || Date.now() - lastFailAt < RETRY_AFTER_MS) return;
  busy = true;
  try {
    const state = await getState();
    if (!state.enabled) return;
    const stage = getPetStage(state.health);
    const reason = (state.reason || "").trim();
    const previous = state.petLine;
    if (previous && previous.stage === stage && previous.reason === reason) return;
    console.log(`[PausePet] asking Gemma for Testudo's ${stage} line`);

    const text = cleanLine(
      await generateText(
        buildPrompt({
          stage,
          previousStage: previous && previous.stage,
          minutes: state.gamblingMinutesToday,
          budget: state.budgetMinutes,
          streak: state.streak,
          reason,
        })
      )
    );
    if (!text) {
      console.log("[PausePet] Gemma gave no usable line, will retry shortly");
      lastFailAt = Date.now();
      return;
    }
    await setState({ petLine: { stage, reason, text } });
    console.log(`[PausePet] Testudo says (${stage}): ${text}`);
  } catch (err) {
    lastFailAt = Date.now();
    console.log("[PausePet] petLine error", err);
  } finally {
    busy = false;
  }
}
