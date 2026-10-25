# PausePet: Architecture (so far)

A Manifest V3 Chrome extension in plain JavaScript. No bundler, no npm, no dependencies. Load it through `chrome://extensions` → Load unpacked.

Right now the extension does four things:

1. **Detects gambling pages.** First a known-domain list and a keyword score, and for unclear pages, a local Gemma model (through Ollama). Results are cached per hostname.
2. **Tracks time on gambling pages** once a minute and turns it into a pet "health" value, shown on the toolbar badge.
3. **Shows a Testudo in the popup.** It has a health bar and a message that match the health range.
4. **Floats the Testudo on web pages**, with no background, until you hide it.

## How the pieces fit together

```
 Web page (any site)                      Service worker                  Storage
┌──────────────────────┐   PAGE_SIGNAL   ┌──────────────────────┐        ┌────────────────────┐
│ content.js           │ ──────────────▶ │ background.js        │ ─────▶ │ chrome.storage     │
│ scores keywords      │                 │ decides gambling or  │ ◀───── │ .local (storage.js)│
│ sends page info      │ ◀────────────── │ not, writes cache    │        └─────────┬──────────┘
│                      │   { gambling,   │ uses domains.js and  │                  │ health, petHidden
│ petOverlay.js        │     source }    │ gemma.js (Gemma)     │                  │ (read + live updates)
│ floating Testudo  ◀───┼─────────────────┼──────────────────────┼──────────────────┤
└──────────────────────┘                 │ "tick" alarm, 1/min  │          ┌───────┴───────┐
                                         │  idle? active tab?   │          │ popup.js      │
 chrome.alarms ────────────────────────▶ │  gambling? health    │          │ Testudo, bar,  │
                                         │  uses health.js      │          │ message       │
                                         └──────────┬───────────┘          └───────────────┘
                                                    ▼
                                           toolbar badge (health)

 pet.js (drawing, colors, messages) is loaded by both petOverlay.js and the popup.
```

The Testudo UI never talks to the service worker. It reads `health` and `petHidden` from storage and re-renders when they change.

Two kinds of script, and the difference matters:

- **ES modules** (`import`/`export`): `background.js`, `storage.js`, `config.js`, `domains.js`, `health.js`, `gemma.js`, `petLine.js`, `popup.js`.
- **Classic scripts** (no `import`/`export`): `content.js`, `pet.js`, and `petOverlay.js`. They can't import the modules above, so shared code goes on `globalThis.Pause`. This is also why the domain check and Gemma call happen in `background.js` and not on the page. The popup loads `pet.js` as a normal `<script>` before `popup.js`, so it can use the same code.

The service worker is killed after about 30 seconds idle, so nothing important lives in memory. Everything that must persist goes through `chrome.storage.local`.

## Files

### `manifest.json`
The extension's config. Declares:
- **Permissions:** `storage`, `alarms`, `idle`, `tabs`, `activeTab`.
- **Host permissions:** `<all_urls>` and `http://localhost:11434/*` (Ollama).
- **Service worker:** `background.js`, as a module.
- **Content scripts:** `pet.js`, `content.js`, `petOverlay.js` (in that order) on `<all_urls>`, at `document_idle`.
- **Popup:** `popup.html`, plus the three icons.

`alarms`, `idle`, and `tabs` are used by the time tracker in `background.js`.

### `config.js`
Constants only, no functions.

| Constant | Value | Meaning |
|---|---|---|
| `MODEL_NAME` | `"gemma4:e2b"` | The Ollama model (single place to change it) |
| `OLLAMA_URL` | `http://localhost:11434/api/generate` | Where Gemma calls go |
| `DEFAULT_BUDGET_MINUTES` | `120` | Default daily gambling-time budget |
| `DEMO_MULTIPLIER` | `10` | Speeds up time in demo mode |
| `RECOVERY_PER_HOUR` | `5` | Health recovered per hour |

`DEFAULT_BUDGET_MINUTES` is used by `storage.js`. `DEMO_MULTIPLIER` and `RECOVERY_PER_HOUR` are used by the time tracker in `background.js`. `MODEL_NAME` and `OLLAMA_URL` are used by `gemma.js`.

### `storage.js`
Thin async wrappers over `chrome.storage.local`.

- **`todayISO()`** returns today's date in your local time as `YYYY-MM-DD`. It's local so the daily reset happens at local midnight, not UTC midnight.
- **`getDefaultState()`** returns a fresh default state object: `health: 100`, `gamblingMinutesToday: 0`, `budgetMinutes: 120`, `lastResetDate` (from `todayISO()`), `streak: 0`, `reason: ""`, `demoMode: false`, `enabled: true`, `cache: {}`, `cooldowns: {}`, `pausesThisWeek: 0`, `lastGamblingAt: null`, `petHidden: false`.
- **`getState()`** reads everything from storage and merges it over the defaults, so missing keys always have a value.
- **`setState(partial)`** writes only the keys you pass (a merge, not a replace), then returns the full updated state.

### `domains.js`
Fast, no-AI domain matching.

- **`GAMBLING_DOMAINS`** is an array of 108 known gambling domains: sports betting, casinos, poker, lotteries, daily fantasy, and crypto casinos.
- **`isKnownGamblingDomain(hostname)`** returns `true` if the hostname equals a listed domain or is a subdomain of one. `sportsbook.draftkings.com` matches, `notdraftkings.com` doesn't. It lowercases the input and returns `false` for empty input.

### `health.js`
Pure functions with no `chrome.*` calls, so any script can import them (including the popup later).

- **`computeHealth(minutes, budget)`** returns `100 - minutes / budget * 100`, clamped to 0–100. A budget of 0 or less gives 0 if there are any minutes, else 100.
- **`getPetStage(health)`** returns `"happy"` (80 and up), `"tired"` (50–79), `"sick"` (20–49), or `"asleep"` (below 20).

### `gemma.js`
Everything that talks to the local Gemma model through Ollama. Both functions share one internal `callOllama(body, timeoutMs)`, which POSTs to `OLLAMA_URL` with `MODEL_NAME` and `stream: false`, and returns the parsed response or `null` on any failure (HTTP error, timeout, network). It never throws.

- **`classifyWithGemma({ url, title, textSample })`** asks whether a page is a gambling site. Used only for pages the fast checks can't settle. It sends `format: "json"` and `temperature: 0` with an 8-second timeout, and returns `{ gambling, type, confidence }`, or `null` on any failure (including bad JSON). It logs the outcome.
- **`generateText(prompt, { timeoutMs, temperature, maxTokens })`** returns plain text, or `null` on failure. It sends `think: false`, because Gemma 4 is a thinking model and otherwise spends the token budget on hidden reasoning and returns an empty reply. Callers must always have a fallback.
- **`buildClassifyPrompt(...)`** (internal) tells the model that gambling means real-money wagering and that news or articles *about* gambling don't count, and asks for a JSON reply of `{ gambling, type, confidence }`.
- **`parseClassifyReply(text)`** (internal) strips any code fences, parses the JSON, and checks that `gambling` is a boolean and `confidence` is a number from 0 to 1. Otherwise it returns `null`. `type` is one of `sportsbook`, `casino`, `poker`, `lottery`, `other`, or `none`.

### `petLine.js`
Writes Testudo's one-sentence message with Gemma. **`refreshPetLine()`** is called from `background.js` on install, on startup, and when `health` or `reason` changes. It asks Gemma for a new line each time Testudo changes stage (or the reason changes), and does nothing otherwise. It is also triggered on every service-worker wake, every tick, and when the popup or settings page opens (`PET_LINE` message), so a missed storage event can't leave the line stale. Otherwise it builds a prompt from the stage, time of day, today's minutes, the streak, and the user's reason, calls `generateText`, cleans the reply to a single short sentence, and stores `{ stage, reason, text }` as `petLine`. After a failure it waits 60 seconds before trying again. The popup and settings page read `petLine` through `Pause.pet.messageFor()` and fall back to the built-in stage message.

### `pet.js`
Shared Testudo code for the popup and the floating Testudo. It's a classic script that sets `globalThis.Pause.pet`.

- **`STAGES`** holds the color, label, and message for each stage:

  | Health | Stage | Color | Label |
  |---|---|---|---|
  | 80–100 | `happy` | green | Happy |
  | 50–79 | `tired` | yellow | Tired |
  | 20–49 | `sick` | orange | Not so good |
  | 0–19 | `asleep` | red | Resting |

- **`getStage(health)`** returns the stage name. These thresholds mirror `getPetStage()` in `health.js`. They're duplicated because classic scripts can't import it, so change both together.
- **`stageInfo(health)`** clamps health to 0–100 (and treats a missing value as 100) and returns `{ stage, health, color, label, message }`.
- **`TestudoSVG(stage)`** returns an inline SVG Testudo. The face and body change by stage: happy eyes and blushing cheeks, half-closed eyes, a greenish body with a sweat drop, or closed eyes with "z"s.

### `petOverlay.js`
The floating Testudo on web pages. A classic script that depends on `pet.js`.

- It builds a fixed-position element at the bottom-right of the page, inside a closed Shadow DOM so the site's CSS can't affect it.
- **Clicking the Testudo** opens or closes a small card with the message, health bar, and number. **Clicking anywhere else** on the page closes the card. The Testudo stays.
- **"Hide my Testudo"** on the card sets `petHidden: true`. The popup checkbox turns it back on.
- **`render(state)`** (internal) removes the Testudo if `petHidden` is true. Otherwise it creates it if needed and updates the Testudo, message, bar, and label.
- **`refresh()`** (internal) reads `health` and `petHidden` from storage and calls `render`. It runs once on load and again whenever `chrome.storage.onChanged` reports a change to either field. It's wrapped in try/catch, so a reloaded extension never breaks the page.

### `content.js`
Runs inside every web page. Everything is wrapped in an immediately-invoked function so it doesn't leak variables into the page. It reads the page, scores it, and reports to the service worker.

- **`getVisibleText()`** returns the page's `document.body.innerText`, or `""` if there's no body yet.
- **`getMetaDescription()`** returns the content of `<meta name="description">`, or `""`.
- **`scoreKeywords()`** searches the title, meta description, and first 3000 characters of page text for 12 terms (`parlay`, `odds`, `sportsbook`, `place bet`, `bet slip`, `deposit bonus`, `free spins`, `jackpot`, `slots`, `roulette`, `blackjack`, `lottery tickets`). It matches whole words only, case-insensitive. Returns `{ score, matched, strong }`:
  - `score` is the number of distinct matched terms divided by 3, capped at 1.
  - `matched` is the list of terms found.
  - `strong` is `true` for 3 or more distinct terms.
  - It's also exposed as `globalThis.Pause.scoreKeywords`.
- **`sendPageSignal()`** runs once on page load. It scores the page, then sends `{ type: "PAGE_SIGNAL", hostname, url, title, keywordScore, textSample }` to the service worker (`textSample` is the first 1500 characters of visible text). It logs the reply. It's wrapped in try/catch, so a failure never breaks the page.

### `background.js`
The service worker. It decides whether a page is gambling, and tracks time spent on gambling pages.

**Setup and startup**
- **`ensureTickAlarm()`** creates the `tick` alarm (every 1 minute) if it doesn't already exist. It runs on install and every time the service worker wakes up.
- **`chrome.runtime.onInstalled` listener** runs on install or reload. It writes the state back to fill in any missing defaults, creates the alarm, sets the badge, and logs `PausePet installed`.
- **`chrome.runtime.onStartup` listener** refreshes the badge when the browser starts.

**Badge**
- **`badgeColor(health)`** returns green (80 and up), yellow (50–79), orange (20–49), or red (below 20).
- **`updateBadge(health)`** sets the badge text to the rounded health number and its background color.

**Time tracking**
- **`chrome.alarms.onAlarm` listener** runs `onTick()` for the `tick` alarm and logs any error.
- **`onTick()`** runs once a minute:
  1. Stop if `enabled` is false.
  2. Check `chrome.idle.queryState(60)`. If it isn't `"active"`, do nothing and log why.
  3. Run the daily reset check.
  4. Find the active tab's hostname. If there's no web page, try recovery.
  5. If `cache[hostname].gambling` is true, call `addGamblingMinute()`. Otherwise call `maybeRecover()`.
- **`getActiveHostname()`** returns the lowercase hostname of the active tab in the last-focused window, or `null` for non-http(s) pages (like `chrome://`).
- **`ensureDailyReset()`** does nothing if `lastResetDate` is today. On a new day, it resets `gamblingMinutesToday` to 0, adds 1 to `streak` if yesterday had 0 gambling minutes (otherwise sets it to 0), and sets `lastResetDate` to today.
- **`addGamblingMinute(minutes = 1)`** runs the daily reset, then adds the minutes (times `DEMO_MULTIPLIER` in demo mode), recomputes health with `computeHealth`, saves `lastGamblingAt`, and updates the badge.
- **`maybeRecover()`** does nothing if health is already 100. It also waits until 10 minutes after `lastGamblingAt`. After that it adds `RECOVERY_PER_HOUR / 60` health per tick (times `DEMO_MULTIPLIER` in demo mode), capped at 100, and updates the badge.

**Page detection**
- **`writeCache(hostname, gambling, source)`** stores `cache[hostname] = { gambling, source, at: Date.now() }` in storage.
- **`handlePageSignal(msg)`** decides, in this order:
  1. **Known domain:** cache as gambling with source `"domain"`, reply `{ gambling: true, source: "domain" }`.
  2. **Already cached:** reply with the cached answer and source `"cache"`.
  3. **`keywordScore` below 0.3:** cache as not gambling (stored source `"keyword"`), reply `{ gambling: false, source: "cache" }`.
  4. **Anything else (`keywordScore` is 0.3 or higher):** ask Gemma through `classifyWithGemma`. Two tabs on the same hostname share one in-flight request (the `inFlight` map).
     - If Gemma fails (`null`), reply `{ gambling: false, source: "unknown" }` and don't cache, so the page is asked again next time.
     - Otherwise the page counts as gambling only if Gemma says so with confidence of at least 0.6 (`GEMMA_MIN_CONFIDENCE`). The result is cached with source `"gemma"`, and the reply is `{ gambling, source: "gemma" }`.

  Each branch logs its decision to the service worker console.

**Messages**
- **`chrome.runtime.onMessage` listener** handles two message types. It returns `true` to keep the channel open for the async reply.
  - `PAGE_SIGNAL` calls `handlePageSignal` and sends back the result. On an error, it replies `{ gambling: false, source: "unknown" }`.
  - `DEBUG_ADD_MINUTES` with `{ minutes }` calls `addGamblingMinute` and replies with the new health and minutes. A service worker can't message itself, so this only works from other contexts, like a popup or page console.

**Debug helpers (run in the service worker console)**
- **`debugAddMinutes(n)`** adds `n` gambling minutes immediately.
- **`debugTick()`** runs `onTick()` immediately instead of waiting for the alarm.

### `popup.html`, `popup.js`, `popup.css`
The toolbar popup. It shows the Testudo, a message, a health bar, and a checkbox.
- `popup.html` is the markup: the Testudo, the message, a bar with marks at 20, 50, and 80, the health number and stage label, a "Today: X of Y minutes" line, and a "Show my Testudo on web pages" checkbox. It loads `pet.js` as a classic script and `popup.js` as a module.
- `popup.js` has one main function, **`render(state)`**. It draws the right Testudo, the message, the bar width and color, the labels, and the checkbox from `getState()`. It redraws the SVG only when the stage changes. It re-renders whenever `chrome.storage.onChanged` fires, so it stays live while open. The checkbox calls `setState({ petHidden })`.
- `popup.css` styles the layout: a gentle bobbing animation for the Testudo (off if the user prefers reduced motion), the bar, and the labels.

A normal Chrome popup always has a background and closes when you click away, so it can't "hover". That's what the floating Testudo in `petOverlay.js` is for.

### `icons/`
Placeholder orange-circle PNGs (`icon16.png`, `icon48.png`, `icon128.png`) used for the toolbar and extensions page.

## What gets stored (`chrome.storage.local`)

The shape is defined in `getDefaultState()`. These fields are written so far:

- `cache`: per-hostname gambling decisions (below).
- `health`, `gamblingMinutesToday`, `lastGamblingAt`: updated by the time tracker.
- `streak`, `lastResetDate`: updated by the daily reset.
- `petHidden`: set by the popup checkbox and the floating Testudo's "Hide my Testudo" button.
- `demoMode`, `enabled`: read by the time tracker, but nothing sets them yet. You can flip them from the console with `chrome.storage.local.set({ demoMode: true })`.

Cache example:

```js
cache: {
  "sportsbook.draftkings.com": { gambling: true,  source: "domain",  at: 1730000000000 },
  "esjbooked.umd.edu":         { gambling: false, source: "keyword", at: 1730000000000 },
  "www.espn.com":              { gambling: false, source: "gemma",   at: 1730000000000 }
}
```

`source` is `"domain"`, `"keyword"`, or `"gemma"`.

`budgetMinutes`, `reason`, `cooldowns`, and `pausesThisWeek` exist with defaults but nothing updates them yet.

## Not built yet

- Anything that reacts to gambling in the moment, such as a pause or check-in message on the gambling page itself.
- Settings in the popup for the budget, demo mode, and enabling or disabling the extension.
- Real art for the toolbar icons (they're still placeholders).

## Not part of the extension

`main.py` and `requirements.txt` are Python files from a teammate. The extension doesn't load them.
