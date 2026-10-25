Built per `DASHBOARD-PLAN.md`, which records every change to this spec.

# Testudo Dashboard: Specification (draft 3, ready to build)

A long-range reflection page for the user. The popup and the floating pet answer "how am I doing right now?". The dashboard answers "how have I been doing, and what's changing?".

Status: **all open questions resolved**; ready to build. Deferred items are listed at the bottom.

## Decisions so far

- **Only gambling sites are stored.** A host is stored only if the extension's own pipeline marked it gambling: a match in `domains.js`, or a Gemma `true` (confidence at or above `GEMMA_MIN_CONFIDENCE`) from `classifier.js`. Hosts the keyword check or Gemma rejected are never sent or stored.
- **Overall score:** recency-weighted 14-day average plus streak bonus (see Scoring).
- **Metrics v1:** Time, Limit used, Score, Sessions.
- **Weeks start on Monday**, so the weekend (when most gambling happens) sits at the end of a week and the next week is a fresh start for reflection.
- **Empty days are clean days.** The app only tracks online gambling, so a day with no events (no browsing, or no gambling) is a pass. No heartbeat is sent. Every day from the install date to today with no events scores 100 and extends the streak. Days before the first-ever sync are skipped.
- **Backfill on first sync:** the extension sends its current `gamblingMinutesToday`, `streak`, and `budgetMinutes` once, so day one is not empty.
- **Retention:** raw `events` are kept 90 days, then rolled into `daily` (which is kept forever). The user can export all data as CSV or JSON.
- **Entry points:** an "Open dashboard" link in both `options.html` and `popup.html`. The dashboard is read-only; the daily limit stays on `options.html`.
- **Offline backend:** the dashboard shows an offline banner. The popup keeps working from `chrome.storage`.
- **Runs in Docker now; DigitalOcean later.** See *Deployment*.

## Goals and non-goals

Goals
- Show the user their own gambling-site activity over days, weeks, months, and up to a year.
- Let the user switch **what** is shown (metric) and **when** (range), like Apple's Screen Time.
- Show Testudo with the same four mood stages, driven by an overall score.
- Match the look of `options.html` (warm cream/orange palette, light and dark).
- Keep the stack small: SQLite, FastAPI, vanilla JS. No build step. Few changes to the existing extension JS.

Non-goals (v1)
- No accounts, no cloud, no sharing. Everything stays on the user's machine.
- No editing history from the dashboard, except "delete all my data".
- No tracking of non-gambling sites. Their hostnames are never sent to the backend.

## Architecture

```
 Extension (existing)                        Backend (new, localhost:8000)
┌──────────────────────────┐   POST /api/events   ┌─────────────────────────┐
│ background.js            │ ───────────────────▶ │ FastAPI  (server/)      │
│  onTick -> record(...)   │   batched, 1/min     │  routes, rollups, score │
│ sync.js (NEW)            │ ◀─────────────────── │          │              │
│  outbox in storage.local │   { ok }             │       SQLite file       │
│  flushes when server up  │                      │       testudo.db        │
└──────────────────────────┘                      │                         │
                                                  │ serves dashboard/ as    │
 Browser tab  ───────── GET http://localhost:8000/ ──▶ static HTML/CSS/JS     │
                                                  └─────────────────────────┘
```

Key decisions
- **The extension stays the source of truth for live state** (`health`, today's minutes). The backend is the source of truth for **history**.
- **The extension pushes, the backend never polls the browser.** Events go into a small `outbox` array in `chrome.storage.local` and are flushed with `fetch`. If the server is down, the outbox grows (capped, say 5,000 events) and drains later. The extension never breaks because the backend is off.
- **FastAPI serves the dashboard as static files** from `localhost:8000`. One process, no CORS for the page itself. CORS is needed only for the extension's `chrome-extension://<id>` origin posting events.
- **The backend never calls Gemma or Ollama.** Classification stays in the extension. The backend only receives the verdict (a gambling host and its `source`), so the container needs no GPU or model.
- **The dashboard reuses `pet.js` and the `options.css` color tokens.** FastAPI mounts the repo's `pet.js` so there is a single copy of the mascot. Stage thresholds stay in sync automatically.
- The options page gets one new "Open dashboard" link. The popup may get the same.

## 1. Data

### What the extension already has (`storage.js`)

| Field | Useful for the dashboard? |
|---|---|
| `gamblingMinutesToday`, `lastResetDate` | Only today. The reset wipes it, so history is lost. |
| `health` | Live value only, includes recovery. No history. |
| `budgetMinutes` | Needed per day (it can change). Not stored historically. |
| `streak` | Yes. Computed at midnight rollover. |
| `cache[hostname] = { gambling, source, at }` | Which hosts are gambling, and how they were classified (`domain`, `keyword`, `gemma`). |
| `demoMode` | Must tag events so demo data never pollutes real history. |

### What we must add (minimal JS)

One event per tick, emitted from `onTick` in `background.js`, which already knows the hostname, the gambling flag, the idle state, and the minutes added:

```js
// sync.js (new module). Called from background.js.
record({
  ts,            // epoch ms
  date,          // todayISO(), local date
  hostname,      // always a host the extension classified as gambling
  gambling: true,
  minutes,       // fraction of a minute this tick is worth (1, or 1/60 in demo)
  health,        // health after this tick
  budget,        // budgetMinutes at this moment
  source,        // 'domain' | 'gemma' (cache hits keep the original source)
  demo,          // demoMode flag
})
```

Touch points in existing files (all small):
1. `background.js` `addGamblingMinute()`: one `record(...)` call after `setState`.
2. Nothing for non-gambling ticks. They are not recorded and no heartbeat is sent.
3. A one-time `backfill` event on first successful sync (today's minutes, streak, budget). The backend ignores it if `daily` already has that date.
3. `manifest.json`: nothing new (host permission `<all_urls>` already covers `localhost:8000`).
4. `options.html`/`popup.html`: a link to the dashboard.

Everything else (`health.js`, `config.js`, `pet.js`, detection) is untouched.

### SQLite schema (`testudo.db`)

```sql
-- One row per gambling tick (about 1/min while on a gambling site). The raw log.
CREATE TABLE events (
  id        INTEGER PRIMARY KEY,
  ts        INTEGER NOT NULL,           -- epoch ms
  date      TEXT    NOT NULL,           -- YYYY-MM-DD (local, from the extension)
  hostname  TEXT    NOT NULL,           -- gambling hosts only
  minutes   REAL    NOT NULL,
  health    REAL    NOT NULL,
  budget    INTEGER NOT NULL,
  source    TEXT,
  demo      INTEGER NOT NULL DEFAULT 0,
  UNIQUE (ts, hostname)                 -- makes retried flushes idempotent
);
CREATE INDEX idx_events_date ON events(date);

-- One row per day. Written/updated by the backend when events arrive (upsert).
CREATE TABLE daily (
  date             TEXT PRIMARY KEY,
  gambling_minutes REAL    NOT NULL DEFAULT 0,
  budget           INTEGER NOT NULL,
  min_health       REAL    NOT NULL,     -- worst point of the day
  end_health       REAL    NOT NULL,
  score            REAL    NOT NULL,     -- 0-100, see Scoring
  sessions         INTEGER NOT NULL DEFAULT 0,
  streak           INTEGER NOT NULL DEFAULT 0
);

-- Known gambling hosts (a small mirror of the extension's cache).
CREATE TABLE sites (
  hostname   TEXT PRIMARY KEY,
  source     TEXT,
  first_seen INTEGER,
  last_seen  INTEGER
);
```

Notes
- Gambling-only events are small: even 2 hours a day is about 45k rows/year. SQLite handles that with no tuning. Raw events older than 90 days are rolled into `daily` and deleted by a startup/nightly job.
- A **session** = consecutive gambling ticks with a gap of 5 minutes or less. Computed in SQL on demand (window function), cached into `daily.sessions`.
- Demo events (`demo = 1`) are stored but excluded from all dashboard queries by default.
- `UNIQUE (ts, hostname)` plus `INSERT OR IGNORE` means a double-flush can't double count.

## 2. Backend (FastAPI)

Layout (new top-level `server/`, kept separate from the extension files):

```
server/
  app.py        # FastAPI app, static mounts, CORS
  db.py         # sqlite3 connection + schema init (plain sqlite3, no ORM)
  models.py     # pydantic request/response models
  queries.py    # SQL for each endpoint
  scoring.py    # score + stage (mirrors health.js)
dashboard/      # static frontend
requirements.txt  # + fastapi, uvicorn
```

Run: `uvicorn server.app:app --port 8000`. One command. DB file is created on first start.

### Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/events` | Ingest a batch `[{event}, ...]`. Idempotent. Updates `daily` and `sites`. |
| GET | `/api/summary?range=week&anchor=2026-10-25` | Header numbers for the selected window (total, daily average, change vs. previous window, streak, overall score and stage). |
| GET | `/api/series?metric=minutes&range=week&anchor=...` | Chart data: one point per bucket (hour for `day`, day for `week`/`month`, week or month for `year`). |
| GET | `/api/sites?range=week&anchor=...` | Ranked hosts with minutes, share, and session count. |
| GET | `/api/heatmap?range=month&anchor=...` | Hour-of-day x weekday minutes for the "when do I gamble" view. |
| GET | `/api/score` | Current overall score + stage (for the mascot, independent of range). |
| GET | `/api/export?format=csv\|json` | Download all history (`daily`, plus `events` still within retention). |
| DELETE | `/api/data` | Wipe all history (requires `?confirm=yes`). |
| GET | `/api/health` | Liveness check, used by the extension and the dashboard's "backend offline" banner. |

Conventions
- `range`: `day | week | month | 6months | year`. `anchor`: any date inside the window (default today). That gives prev/next navigation for free.
- Weeks run **Monday to Sunday**.
- `metric`: `minutes | budget_pct | score | sessions | streak`.
- All dates are local `YYYY-MM-DD` strings from the extension, not UTC, so a late-night session lands on the right day.
- Responses are small JSON. No pagination in v1.

### Scoring (shared definition)

Per-day score (matches how the pet already works):

```
day_score = computeHealth(gambling_minutes, budget)    # 100 - used/budget*100, clamped 0-100
```

**Overall score** (what the mascot shows on the dashboard): a recency-weighted average of the last 14 days of `day_score`, with a small streak bonus, clamped 0-100. A day with no events is a clean day and scores 100, but only from the install date (earliest `daily` row, or first sync) onward. Stage uses the same thresholds as `getPetStage` (80 / 50 / 20).

## 3. Frontend (dashboard)

Static HTML/CSS/vanilla JS, ES modules, no build. Charts are hand-drawn inline SVG (no chart library), which keeps it dependency-free and lets us match the theme exactly. Theme tokens are copied from `options.css` (`--bg #fffaf3`, `--accent #f2a365`, `--good`, `--warn-*`, plus the dark-mode block). Font stack is the same system font. Cards use the same rounded white card with the soft shadow.

### Layout (desktop, about 960px max; single column under 640px)

```
┌────────────────────────────────────────────────────────────────┐
│ [pet]  Testudo is feeling TIRED          Overall score  64     │
│        "A little sleepy this month."     ▓▓▓▓▓▓░░░░  streak 3d │
├────────────────────────────────────────────────────────────────┤
│ Show: [Time ▾]        [ Day | Week | Month | 6M | Year ]       │
│                        ‹   Oct 19 – 25, 2026   ›               │
├────────────────────────────────────────────────────────────────┤
│  Daily average            vs. last week                        │
│  1 h 12 min               ▼ 18%  (good: lower is better)       │
│                                                                │
│   ┃  ▂   ▅   ▇   ▃   ▁   ▆   ▂        ╌╌╌ daily limit 2h      │
│   M   T   W   T   F   S   S                                    │
├────────────────────────────────────────────────────────────────┤
│ Most visited                         │ When you play           │
│ 1  stake.com          2 h 10 min ███ │  hour x weekday heatmap │
│ 2  draftkings.com     1 h 05 min ██  │                         │
│ 3  polymarket.com        20 min ▌    │                         │
├────────────────────────────────────────────────────────────────┤
│ Highlights (plain-language, kind):                             │
│  • Your longest break: 3 days.   • Best day: Tuesday (12 min). │
├────────────────────────────────────────────────────────────────┤
│ Need to talk to someone? (same helpline card as options.html)  │
│ 🔒 Everything here stays on your device.     [Delete my data]  │
└────────────────────────────────────────────────────────────────┘
```

### Controls (what the user can change)

- **Range tabs:** Day, Week, Month, 6 Months, Year. Default Week.
- **Prev/next arrows** shift the window (blocked past today).
- **Metric picker** (the "Show" dropdown):
  - **Time**: gambling minutes (default)
  - **Limit used**: percent of daily budget, with the 100% line
  - **Score**: day score / health trend
  - **Sessions**: number of sessions per bucket
- **Tap a bar** to select it. The header and "Most visited" list then show that bucket, like Screen Time. Tap again to deselect.
- **Day view** shows 24 hourly bars. Week and Month show daily bars. 6 Months and Year show weekly or monthly bars (the Year view is the "long range" the user asked for, but it is a secondary view).

### Apple Screen Time ideas we adopt vs. adapt

| Screen Time | Testudo dashboard |
|---|---|
| Big "Daily Average" number above bars | Same. Plus a gentle delta: "18% less than last week". |
| Tap a bar to inspect | Same. |
| Dashed limit line | The user's daily limit, drawn as a dashed line on the Time chart. |
| Most Used apps list | "Most visited" gambling sites. |
| Pickups / Notifications | Sessions. |
| Colored by category | Single accent color. Bars over the limit turn warm red, under stay accent. Not a rainbow. |

Tone rules (from the project's principles): non-punitive and warm. Down is good and is framed that way. No red alarm banners, no shaming copy. Empty states are encouraging ("Nothing here yet. That's okay.").

### Mascot behavior

- Rendered with the existing `Pause.pet.mascotSVG(stage)` and `stageInfo(score)`. Same four stages, same colors and messages (the messages get a dashboard-flavored variant, e.g. "A little sleepy this month").
- Driven by the **overall score**, not the live health, so it reflects the trend. Live health stays in the popup and badge.
- Same `bob` animation as `.hero-pet` in `options.css`.
- Clicking the mascot could show a one-line explanation of how the score is computed. Nice-to-have.

### States to handle
- Backend offline: banner "Can't reach the Testudo server. Start it with `uvicorn server.app:app`", last-loaded data stays visible.
- No data yet: friendly empty state with the mascot happy.
- Demo data present: a small "includes demo data" toggle, off by default.
- Dark mode via `prefers-color-scheme`, same as the options page.
- Keyboard accessible bars (role="img" with aria-labels per bar, arrow keys to move selection).

## 4. Build order

1. **Backend skeleton:** `db.py` schema init, `POST /api/events`, `GET /api/health`. Test with curl.
2. **Extension sync:** `sync.js` (`record`, outbox, flush), two call sites in `background.js`. Verify events land while browsing a known gambling site, and drain after the server was off.
3. **Read endpoints:** `summary`, `series`, `sites`, `score`. Seed script that generates fake history so the UI can be built before real data exists.
4. **Dashboard shell:** theme, header with mascot and score, range tabs, bar chart (Time metric, Week range).
5. **All ranges and metrics,** selection, Most visited, heatmap, highlights.
6. **Polish:** empty/offline states, dark mode, a11y, "Open dashboard" links, delete-my-data.

A seed script (`server/seed.py`) is worth doing early. It lets us design all ranges, including a full year, without waiting months for data.

## Deployment

### Now: Docker on the user's machine

```
docker-compose.yml
  services:
    testudo:
      build: .                       # python:3.12-slim, pip install -r server/requirements.txt
      ports: ["8000:8000"]
      volumes: ["testudo-data:/data"]   # SQLite file lives on a named volume
      environment: TESTUDO_DB=/data/testudo.db
      restart: unless-stopped
```

- `docker compose up -d` is the one command the user runs. The extension keeps posting to `http://localhost:8000`, and the dashboard opens at the same address.
- The SQLite file must be on a **volume**, not inside the container, or history disappears when the container is rebuilt.
- Ollama stays on the host (not in this compose file). The backend does not talk to it.
- `requirements.txt` today pins the Ollama client stack. The server gets its own `server/requirements.txt` (fastapi, uvicorn) so the container stays small.
- Add a `/api/health` Docker `HEALTHCHECK`.

### Later: DigitalOcean

Moving to a Droplet changes the trust model, so the spec keeps these seams open now:
- The extension's backend URL is a single constant in `config.js` (`BACKEND_URL`), not hard-coded in `sync.js`.
- Every event and query carries a `user_id` column from day one (a random UUID created by the extension on install, default `local`). In Docker it is always one user. It costs nothing now and avoids a schema migration later.
- Auth is **not** in v1 (deferred). For a remote server it becomes required, and who uses it (one person or many) is decided then.
- HTTPS (Caddy or the DO load balancer) in front of uvicorn. SQLite is fine for a single small user base. Past that, switch to Postgres (the SQL is kept plain for that reason).
- The privacy copy changes. "Stays on your device" is only true for local Docker. The dashboard footer text must switch with the deployment.

## Deferred (decide later)

- Auth model for DigitalOcean (single API key vs. real accounts). `user_id` is a placeholder until then.
- Timezone handling for a remote server. For now the extension's local `date` is trusted.
- Postgres, if SQLite stops being enough.

## Resolved decisions log

| Topic | Decision |
|---|---|
| Sites tracked | Gambling only (`domains.js` match or Gemma `true`) |
| Score | Recency-weighted 14-day average + streak bonus |
| Metrics | Time, Limit used, Score, Sessions |
| Week start | Monday |
| Empty days | Clean (score 100) from install date; no heartbeat |
| First sync | Backfill today's minutes, streak, budget |
| Retention | Raw 90 days, daily forever; CSV/JSON export |
| Entry points | Options page and popup; dashboard read-only |
| Backend offline | Banner in dashboard; popup unaffected |
| Hosting | Docker now, DigitalOcean later |
