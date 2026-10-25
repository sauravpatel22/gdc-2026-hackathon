import { MODEL_NAME, OLLAMA_URL } from "./config.js";

const CLASSIFY_TIMEOUT_MS = 8000;

// One POST to Ollama. Returns the parsed response object, or null on any failure
// (HTTP error, timeout, network). Never throws, so callers only need a fallback.
async function callOllama(body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(OLLAMA_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL_NAME, stream: false, ...body }),
    });
    if (!res.ok) {
      console.log(`[PausePet] Gemma HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.log("[PausePet] Gemma request failed", err && err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Classification ----------

function buildClassifyPrompt({ url, title, textSample }) {
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

function parseClassifyReply(text) {
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
  const started = Date.now();
  const data = await callOllama(
    {
      prompt: buildClassifyPrompt({ url, title, textSample }),
      format: "json",
      options: { temperature: 0 },
    },
    CLASSIFY_TIMEOUT_MS
  );
  if (!data) return null;

  try {
    const result = parseClassifyReply(data.response);
    console.log(`[PausePet] Gemma answered in ${Date.now() - started}ms`, result);
    return result;
  } catch (err) {
    console.log("[PausePet] Gemma classify failed", err && err.message);
    return null;
  }
}

// ---------- Text generation ----------

// Plain-text generation. Returns the reply text, or null on any failure.
// Callers must always have a fallback, since Ollama may not be running.
export async function generateText(prompt, { timeoutMs = 8000, temperature = 0.7, maxTokens = 80 } = {}) {
  const data = await callOllama(
    {
      prompt,
      think: false, // Gemma 4 is a thinking model; otherwise it burns the token budget and returns ""
      options: { temperature, num_predict: maxTokens },
    },
    timeoutMs
  );
  return data && typeof data.response === "string" ? data.response : null;
}
