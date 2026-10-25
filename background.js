import { getState, setState } from "./storage.js";
import { isKnownGamblingDomain } from "./domains.js";
import { classifyWithGemma } from "./classifier.js";

const LOW_SCORE_THRESHOLD = 0.3;
const GEMMA_MIN_CONFIDENCE = 0.6;
const inFlight = new Map(); // hostname -> pending Gemma promise

chrome.runtime.onInstalled.addListener(async () => {
  const state = await getState();
  await setState(state);
  console.log("PausePet installed");
});

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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || msg.type !== "PAGE_SIGNAL") return;

  handlePageSignal(msg)
    .then(sendResponse)
    .catch((err) => {
      console.log("[PausePet] PAGE_SIGNAL error", err);
      sendResponse({ gambling: false, source: "unknown" });
    });
  return true; // keep the channel open for the async reply
});
