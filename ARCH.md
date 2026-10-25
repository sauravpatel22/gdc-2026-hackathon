# PausePet: Architecture (so far)

A Manifest V3 Chrome extension in plain JavaScript. No bundler, no npm, no dependencies. Load it through `chrome://extensions` → Load unpacked.

Right now the extension does two things:

1. **Detects gambling pages without AI** (known-domain list plus a keyword score) and caches the result per hostname.
2. **Tracks time on gambling pages** once a minute and turns it into a pet "health" value, shown on the toolbar badge.

Gemma/Ollama is not wired in yet.

## How the pieces fit together

```
 Web page (any site)                      Service worker                  Storage
┌──────────────────────┐   PAGE_SIGNAL   ┌──────────────────────┐        ┌───────────────────┐
│ content.js           │ ──────────────▶ │ background.js        │ ─────▶ │ chrome.storage    │
│ scores keywords      │                 │ decides gambling or  │ ◀───── │ .local (storage.js)│
│ sends page info      │ ◀────────────── │ not, writes cache    │        └───────────────────┘
└──────────────────────┘   { gambling,   │ uses domains.js      │                 ▲
                              source }   │                      │                 │
                                         │ "tick" alarm, 1/min  │          ┌──────┴────────┐
 chrome.alarms ────────────────────────▶ │  idle? active tab?   │          │ popup.js      │
                                         │  gambling? health    │          │ reads state   │
                                         │  uses health.js      │          └───────────────┘
                                         └──────────┬───────────┘
                                                    ▼
                                           toolbar badge (health)
```

Two kinds of script, and the difference matters:

- **ES modules** (`import`/`export`): `background.js`, `storage.js`, `config.js`, `domains.js`, `health.js`, `popup.js`.
- **Classic script** (no `import`/`export`): `content.js`. It can't import the modules above, which is why the domain check happens in `background.js` and not on the page.

The service worker is killed after about 30 seconds idle, so nothing important lives in memory. Everything that must persist goes through `chrome.storage.local`.

## Files

### `manifest.json`
The extension's config. Declares:
- **Permissions:** `storage`, `alarms`, `idle`, `tabs`, `activeTab`.
- **Host permissions:** `<all_urls>` and `http://localhost:11434/*` (Ollama).
- **Service worker:** `background.js`, as a module.
- **Content script:** `content.js` on `<all_urls>`, at `document_idle`.
- **Popup:** `popup.html`, plus the three icons.

`alarms`, `idle`, and `tabs` are used by the time tracker in `background.js`.

### `config.js`
Constants only, no functions.

| Constant | Value | Meaning |
|---|---|---|
| `MODEL_NAME` | `"gemma4:e2b"` | The Ollama model (single place to change it) |
| `OLLAMA_URL` | `http://localhost:11434/api/generate` | Where Gemma calls will go |
| `DEFAULT_BUDGET_MINUTES` | `120` | Default daily gambling-time budget |
| `DEMO_MULTIPLIER` | `10` | Speeds up time in demo mode |
| `RECOVERY_PER_HOUR` | `5` | Health recovered per hour |

`DEFAULT_BUDGET_MINUTES` is used by `storage.js`. `DEMO_MULTIPLIER` and `RECOVERY_PER_HOUR` are used by the time tracker in `background.js`. `MODEL_NAME` and `OLLAMA_URL` are waiting for the Gemma step.

### `storage.js`
Thin async wrappers over `chrome.storage.local`.

- **`todayISO()`** returns today's date in your local time as `YYYY-MM-DD`. It's local so the daily reset happens at local midnight, not UTC midnight.
- **`getDefaultState()`** returns a fresh default state object: `health: 100`, `gamblingMinutesToday: 0`, `budgetMinutes: 120`, `lastResetDate` (from `todayISO()`), `streak: 0`, `reason: ""`, `demoMode: false`, `enabled: true`, `cache: {}`, `cooldowns: {}`, `pausesThisWeek: 0`, `lastGamblingAt: null`.
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
  4. **Anything else:** reply `{ gambling: false, source: "unknown" }`. This is the case Gemma will handle in Phase 2.

  Each branch logs its decision to the service worker console.
**Messages**
- **`chrome.runtime.onMessage` listener** handles two message types. It returns `true` to keep the channel open for the async reply.
  - `PAGE_SIGNAL` calls `handlePageSignal` and sends back the result. On an error, it replies `{ gambling: false, source: "unknown" }`.
  - `DEBUG_ADD_MINUTES` with `{ minutes }` calls `addGamblingMinute` and replies with the new health and minutes. A service worker can't message itself, so this only works from other contexts, like a popup or page console.

**Debug helpers (run in the service worker console)**
- **`debugAddMinutes(n)`** adds `n` gambling minutes immediately.
- **`debugTick()`** runs `onTick()` immediately instead of waiting for the alarm.

### `popup.html`, `popup.js`, `popup.css`
The toolbar popup. Still a placeholder.
- `popup.html` is the markup with a title and a status line.
- `popup.js` loads the state with `getState()` and shows "Hi there. Health: <number>".
- `popup.css` gives it a small warm-colored layout.

### `icons/`
Placeholder orange-circle PNGs (`icon16.png`, `icon48.png`, `icon128.png`) used for the toolbar and extensions page.

## What gets stored (`chrome.storage.local`)

The shape is defined in `getDefaultState()`. These fields are written so far:

- `cache`: per-hostname gambling decisions (below).
- `health`, `gamblingMinutesToday`, `lastGamblingAt`: updated by the time tracker.
- `streak`, `lastResetDate`: updated by the daily reset.
- `demoMode`, `enabled`: read by the time tracker, but nothing sets them yet. You can flip them from the console with `chrome.storage.local.set({ demoMode: true })`.

Cache example:

```js
cache: {
  "sportsbook.draftkings.com": { gambling: true,  source: "domain",  at: 1730000000000 },
  "esjbooked.umd.edu":         { gambling: false, source: "keyword", at: 1730000000000 }
}
```

`budgetMinutes`, `reason`, `cooldowns`, and `pausesThisWeek` exist with defaults but nothing updates them yet.

## Not built yet

- Gemma/Ollama calls (the `"unknown"` branch).
- Any UI injected into pages (it will use a Shadow DOM).
- A real popup.
