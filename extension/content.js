// Classic script (no import/export). Shared code lives on globalThis.Pause.
globalThis.Pause = globalThis.Pause || {};

(() => {
  const KEYWORDS = [
    "parlay",
    "odds",
    "sportsbook",
    "place bet",
    "bet slip",
    "deposit bonus",
    "free spins",
    "jackpot",
    "slots",
    "roulette",
    "blackjack",
    "lottery tickets",
  ];
  const STRONG_MATCH_COUNT = 3;
  const SCAN_CHARS = 3000;
  const SAMPLE_CHARS = 1500;

  const KEYWORD_PATTERNS = KEYWORDS.map((term) => ({
    term,
    re: new RegExp("\\b" + term.replace(/ /g, "\\s+") + "\\b", "i"),
  }));

  function getVisibleText() {
    return (document.body && document.body.innerText) || "";
  }

  function getMetaDescription() {
    const el = document.querySelector('meta[name="description"]');
    return (el && el.getAttribute("content")) || "";
  }

  function scoreKeywords() {
    const haystack = [
      document.title || "",
      getMetaDescription(),
      getVisibleText().slice(0, SCAN_CHARS),
    ].join("\n");

    const matched = KEYWORD_PATTERNS.filter(({ re }) => re.test(haystack)).map(
      ({ term }) => term
    );
    const score = Math.min(1, matched.length / STRONG_MATCH_COUNT);
    return { score, matched, strong: matched.length >= STRONG_MATCH_COUNT };
  }

  globalThis.Pause.scoreKeywords = scoreKeywords;

  async function sendPageSignal() {
    try {
      const { score, matched, strong } = scoreKeywords();
      console.log("[PausePet] keyword scan", { score, matched, strong });

      const reply = await chrome.runtime.sendMessage({
        type: "PAGE_SIGNAL",
        hostname: location.hostname,
        url: location.href,
        title: document.title,
        keywordScore: score,
        textSample: getVisibleText().slice(0, SAMPLE_CHARS),
      });
      console.log("[PausePet] reply", reply);
    } catch (err) {
      // Extension reloaded or worker unavailable; never break the page.
      console.log("[PausePet] signal failed", err && err.message);
    }
  }

  sendPageSignal();
})();
