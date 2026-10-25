import { MODEL_NAME, OLLAMA_URL } from "./config.js";

const TIMEOUT_MS = 8000;

function buildPrompt({ url, title, textSample }) {
  return [
    "You are a classifier that decides whether a web page is a gambling site",
    "(sports betting, casino, poker, lottery, or similar real-money wagering).",
    "News, sports scores, and articles ABOUT gambling are not gambling sites.",
    'Reply with JSON only, in exactly this shape:',
    '{"gambling": true or false, "type": "sportsbook" | "casino" | "poker" | "lottery" | "other" | "none", "confidence": number from 0 to 1}',
    "",
    `URL: ${url}`,
    `Title: ${title}`,
    "Page text:",
    textSample,
  ].join("\n");
}

function parseReply(text) {
  // Models sometimes wrap JSON in code fences even when told not to.
  const cleaned = String(text)
    .replace(/```(?:json)?/gi, "")
    .trim();
  const parsed = JSON.parse(cleaned);

  const { gambling, type, confidence } = parsed;
  if (typeof gambling !== "boolean") return null;
  if (typeof confidence !== "number" || confidence < 0 || confidence > 1) return null;
  return { gambling, type: String(type || "none"), confidence };
}

// Returns { gambling, type, confidence } or null on any failure.
// null means "don't cache"; the 0.6 confidence cutoff is applied by the caller.
export async function classifyWithGemma({ url, title, textSample }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const started = Date.now();

  try {
    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL_NAME,
        prompt: buildPrompt({ url, title, textSample }),
        stream: false,
        format: "json",
        options: { temperature: 0 },
      }),
    });
    if (!res.ok) {
      console.log(`[PausePet] Gemma HTTP ${res.status}`);
      return null;
    }

    const data = await res.json();
    const result = parseReply(data.response);
    console.log(`[PausePet] Gemma answered in ${Date.now() - started}ms`, result);
    return result;
  } catch (err) {
    console.log("[PausePet] Gemma classify failed", err && err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
