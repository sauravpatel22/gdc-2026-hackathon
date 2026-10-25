import { getState, setState } from "./storage.js";
import { isKnownGamblingDomain } from "./domains.js";

const LOW_SCORE_THRESHOLD = 0.3;

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
    `[PausePet] ${hostname}: unknown (keywordScore ${score.toFixed(2)}), Gemma will decide in Phase 2`
  );
  return { gambling: false, source: "unknown" };
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
