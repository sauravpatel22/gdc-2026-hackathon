# Testudo Dashboard: Build Plan

The step-by-step plan for building `DASHBOARD-SPEC.md`. **This file is the source of truth.** Where it differs from the spec, it does so on purpose, and section 0 lists every difference and the reason for it.

Work through the phases in order. Each phase lists **what you're building**, **the tasks**, and **how you know it's done**. Tick the boxes as you go and commit at the end of each phase.

**Rules for the whole build**
- Backend: Python + FastAPI + plain `sqlite3`. No ORM. No other runtime dependencies.
- Frontend: vanilla JS ES modules, hand-drawn inline SVG. No chart library, no build step.
- Extension changes stay minimal: one new module (`sync.js`) and small edits to `background.js`, `storage.js`, `config.js`, `popup.*`, `options.*`.
- Copy is warm and non-punitive. Down is good. No alarm-red banners. Never say "addict".
- The extension must keep working when the backend is off.
- All dates are local `YYYY-MM-DD` strings. The server never works out "today" for itself when the client told it.

---

## 0. Changes to the spec (read first)

The spec has a few gaps and contradictions. Each one is settled here.

| # | Spec says | Plan does | Why |
|---|---|---|---|
| 1 | Schema has no `user_id`; Deployment says "every event carries `user_id` from day one" | Every table gets `user_id TEXT NOT NULL DEFAULT 'local'`. The extension sends `userId` from storage, default `"local"`. No UUID yet. | The dashboard page is served by the backend and can't read `chrome.storage`, so it couldn't know a random UUID. In single-user Docker the value is always `local`. The UUID comes with auth (deferred). |
| 2 | Hour-of-day heatmap and Day view (hourly bars) are computed from `ts` | Each event also carries `tz_offset` (`new Date().getTimezoneOffset()`, in minutes). Local hour = `((ts / 60000) - tz_offset) / 60 % 24`. | The Docker container runs in UTC. Without the offset every hour would be shifted. |
| 3 | `GET` endpoints default `anchor` to "today" | Every `GET /api/*` that depends on today takes an optional `today=YYYY-MM-DD`. The dashboard always sends the browser's local date. The server falls back to `date.today()` only if it's missing. | Same UTC problem: near midnight the container's "today" is wrong. |
| 4 | `daily` has a `streak` column | No `streak` column. Streak is computed when read (see 3.3). The backfill's streak is stored in a new `backfill` table. | A stored per-day streak goes stale as soon as a later day changes. |
| 5 | Backfill "ignored if `daily` already has that date"; daily is upserted from events | A separate `backfill` table. `daily` is always **recomputed** as backfill + events for that date. | Recomputing makes ingest idempotent and order-independent. A plain upsert would overwrite the backfill minutes as soon as the first tick arrived. |
| 6 | Backfill sent "on first successful sync" | Backfill is **captured** the first time `sync.js` runs (before any tick is recorded) and **sent** with the first flush, then retried until it's acknowledged. | If it were captured at flush time, ticks already in the outbox would be counted twice (once in the snapshot, once as events). |
| 7 | "Most visited" for any range; events deleted after 90 days | New `daily_sites` rollup table (per day, per host minutes and sessions). | Otherwise "Most visited" would be empty for Year and 6M once old events are purged. |
| 8 | Demo events stored, excluded by default, with an "include demo" toggle | Rollups are kept twice using a `scope` column: `real` (demo = 0 only) and `all` (everything). Reads choose a scope with `include_demo=0\|1`. | Min/end health and sessions can't be added together after the fact, so both versions are kept. It's cheap. |
| 9 | Ingest body is `[{event}, ...]` | Still a JSON array, but each item has `type: "tick" \| "backfill"`. | One endpoint handles both kinds. |
| 10 | Compose `ports: ["8000:8000"]` | `ports: ["127.0.0.1:8000:8000"]` | There's no auth. Publishing on every interface would let anyone on the LAN read or delete the data. |
| 11 | uvicorn command | In Docker: `--host 0.0.0.0` inside the container (bound to 127.0.0.1 by compose). Locally: `uvicorn server.app:app --port 8000` from the repo root. | Without `0.0.0.0` the container can't be reached at all. |
| 12 | Docker `HEALTHCHECK` on `/api/health` | Use Python's `urllib`, not `curl`. | `python:3.12-slim` doesn't include curl. |
| 13 | Metrics `minutes \| budget_pct \| score \| sessions \| streak` | The API supports all five. The picker shows the four v1 metrics (Time, Limit used, Score, Sessions). | Matches "Metrics v1". `streak` is cheap to serve and is already in the API conventions. |
| 14 | 6M / Year use "weekly or monthly bars" | 6 Months = **26 Monday-weeks** ending with the anchor's week, weekly bars. Year = **12 calendar months** ending with the anchor's month, monthly bars. In both, bar values are **per-day averages** for the bucket. | Per-day averages keep the daily-limit line meaningful on every range. |
| 15 | Day view hourly bars | Time = minutes in that hour. Limit used = **cumulative** % of budget by the end of that hour. Score = health at the end of that hour (carried forward, 100 before the first tick). Sessions = sessions that started in that hour. Needs raw events, so it's only available for the last 90 days (older days return `hourly_available: false`). | These are the only definitions where the 100% line and the score trend make sense hour by hour. |
| 16 | `DEBUG_ADD_MINUTES` / `debugAddMinutes()` | Not recorded (no hostname). | Recording it would invent a fake site. It's a dev-only helper. |
| 17 | "Start today fresh" on the options page | History is not changed. The dashboard keeps showing what was recorded. | The dashboard is a record of what happened. Popup and badge still reset as before. |

---

## 1. Final data model (`server/db.py`)

`db.py` creates this with `CREATE TABLE IF NOT EXISTS` on startup and sets `PRAGMA user_version = 1`.

```sql
PRAGMA journal_mode = WAL;

-- Raw gambling ticks. Kept 90 days.
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  user_id    TEXT    NOT NULL DEFAULT 'local',
  ts         INTEGER NOT NULL,              -- epoch ms
  date       TEXT    NOT NULL,              -- local YYYY-MM-DD from the extension
  hostname   TEXT    NOT NULL,              -- gambling hosts only
  minutes    REAL    NOT NULL,              -- minutes added this tick (demo multiplier already applied)
  health     REAL    NOT NULL,              -- health after this tick
  budget     INTEGER NOT NULL,
  source     TEXT,                          -- 'domain' | 'gemma'
  demo       INTEGER NOT NULL DEFAULT 0,
  tz_offset  INTEGER NOT NULL DEFAULT 0,    -- Date#getTimezoneOffset(), minutes
  UNIQUE (user_id, ts, hostname)
);
CREATE INDEX IF NOT EXISTS idx_events_user_date ON events(user_id, date);

-- One-time snapshot of the extension's state when sync started. Kept forever (tiny).
CREATE TABLE IF NOT EXISTS backfill (
  user_id  TEXT    NOT NULL DEFAULT 'local',
  date     TEXT    NOT NULL,
  ts       INTEGER NOT NULL,
  minutes  REAL    NOT NULL,
  streak   INTEGER NOT NULL,
  budget   INTEGER NOT NULL,
  health   REAL    NOT NULL,
  demo     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

-- One row per day per scope. Recomputed from backfill + events. Kept forever.
CREATE TABLE IF NOT EXISTS daily (
  user_id          TEXT    NOT NULL DEFAULT 'local',
  scope            TEXT    NOT NULL CHECK (scope IN ('real', 'all')),
  date             TEXT    NOT NULL,
  gambling_minutes REAL    NOT NULL DEFAULT 0,
  budget           INTEGER NOT NULL,
  min_health       REAL    NOT NULL,
  end_health       REAL    NOT NULL,
  score            REAL    NOT NULL,
  sessions         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, scope, date)
);

-- Per-day, per-host rollup so "Most visited" works past 90 days.
CREATE TABLE IF NOT EXISTS daily_sites (
  user_id  TEXT    NOT NULL DEFAULT 'local',
  scope    TEXT    NOT NULL CHECK (scope IN ('real', 'all')),
  date     TEXT    NOT NULL,
  hostname TEXT    NOT NULL,
  minutes  REAL    NOT NULL,
  sessions INTEGER NOT NULL,
  PRIMARY KEY (user_id, scope, date, hostname)
);

-- Known gambling hosts.
CREATE TABLE IF NOT EXISTS sites (
  user_id    TEXT NOT NULL DEFAULT 'local',
  hostname   TEXT NOT NULL,
  source     TEXT,
  first_seen INTEGER,
  last_seen  INTEGER,
  PRIMARY KEY (user_id, hostname)
);
```

Constants (in `server/config.py`):
- `DB_PATH = os.environ.get("TESTUDO_DB", <repo root>/testudo.db)`
- `DEPLOYMENT = os.environ.get("TESTUDO_DEPLOYMENT", "local")` (`local` or `remote`)
- `RETENTION_DAYS = 90`, `SESSION_GAP_MS = 5 * 60 * 1000`, `DEFAULT_BUDGET = 120` (same as `config.js`), `MAX_BATCH = 1000`

---

## 2. API contract (reference for every phase)

Common query parameters for every `GET` that takes a range:
- `range`: `day | week | month | 6months | year` (default `week`)
- `anchor`: `YYYY-MM-DD`, any date inside the window (default `today`; clamped to `today` if later)
- `today`: `YYYY-MM-DD`, the client's local date (default: server date)
- `include_demo`: `0 | 1` (default `0`). Picks scope `real` or `all`.
- An invalid value returns **422** (FastAPI validation).

Window rules (Monday is weekday 0):

| range | window | buckets | previous window |
|---|---|---|---|
| `day` | `anchor` | 24 hours | the day before |
| `week` | Monday to Sunday containing `anchor` | 7 days | the week before |
| `month` | calendar month of `anchor` | 28 to 31 days | the previous calendar month |
| `6months` | 26 Mon–Sun weeks ending with the week containing `anchor` | 26 weeks | the 26 weeks before |
| `year` | 12 calendar months ending with `anchor`'s month | 12 months | the 12 months before |

**Counted day:** `install_date <= d <= today`, where `install_date = MIN(daily.date)` for the user and scope. Days outside this range have `value: null` and are not drawn. A counted day with no `daily` row is a clean day: minutes 0, sessions 0, score 100, budget = the latest known budget on or before that day (else the earliest known budget, else 120).

### `POST /api/events`
Body: a JSON array of at most 1000 items.
```jsonc
{ "type": "tick", "user_id": "local", "ts": 1761400000000, "date": "2026-10-25",
  "hostname": "stake.com", "minutes": 1, "health": 92.5, "budget": 120,
  "source": "domain", "demo": false, "tz_offset": 240 }
{ "type": "backfill", "user_id": "local", "ts": 1761400000000, "date": "2026-10-25",
  "minutes": 34, "streak": 2, "budget": 120, "health": 71.7, "demo": false }
```
Validation: `date` matches `^\d{4}-\d{2}-\d{2}$` and parses; `0 < minutes <= 60` for ticks and `>= 0` for backfill; `0 <= health <= 100`; `budget >= 0`; `-840 <= tz_offset <= 840`; `hostname` is 1 to 253 chars and lowercase.
Response: `{"ok": true, "accepted": <new ticks inserted>, "ignored": <duplicates + too-old>, "backfill": "stored" | "ignored" | null}`.

### `GET /api/health`
`{"ok": true, "deployment": "local", "has_demo": <bool>, "schema": 1}`. `has_demo` is true if any `daily` row with scope `all` differs from its `real` row, or has no `real` row.

### `GET /api/score?today=&include_demo=`
`{"score": 64.2, "stage": "tired", "streak": 3, "install_date": "2026-10-01" | null, "has_data": true}`

### `GET /api/summary?range=&anchor=&today=&include_demo=`
```jsonc
{
  "range": "week", "start": "2026-10-19", "end": "2026-10-25",
  "prev_start": "2026-10-12", "prev_end": "2026-10-18",
  "counted_days": 7, "has_data": true,
  "can_go_prev": true, "can_go_next": false,
  "budget": 120,
  "metrics": {
    "minutes":    { "total": 504, "average": 72,  "prev_average": 88,  "change_pct": -18.2 },
    "budget_pct": {               "average": 60,  "prev_average": 73,  "change_pct": -17.8 },
    "score":      {               "average": 41,  "prev_average": 30,  "change_pct": 36.7 },
    "sessions":   { "total": 9,   "average": 1.3, "prev_average": 1.6, "change_pct": -18.8 }
  },
  "streak": 3,
  "overall": { "score": 64.2, "stage": "tired" },
  "highlights": {
    "longest_break_days": 3,
    "best_day": { "date": "2026-10-21", "minutes": 12 } ,
    "clean_days": 2,
    "under_limit_days": 6
  }
}
```
- `average` = mean over counted days in the window. `null` if there are no counted days.
- `change_pct = (average - prev_average) / prev_average * 100`, rounded to 1 decimal. `null` if `prev_average` is `null` or `0`.
- `best_day` = the counted day with the **fewest minutes greater than 0** (ties: the latest one). `null` if there are none. Clean days are reported separately as `clean_days`.
- `longest_break_days` = the longest run of consecutive clean counted days inside the window.
- `can_go_prev = start > install_date` (false when there's no install date). `can_go_next = end < today`.

### `GET /api/series?metric=&range=&anchor=&today=&include_demo=`
```jsonc
{
  "metric": "minutes", "range": "week", "bucket": "day",   // hour | day | week | month
  "per_day_average": false,                                 // true for 6months / year
  "hourly_available": true,                                 // only meaningful for range=day
  "budget": 120,
  "points": [
    { "start": "2026-10-19", "end": "2026-10-19", "hour": null,
      "value": 42, "over_limit": false,
      "values": { "minutes": 42, "budget_pct": 35, "score": 65, "sessions": 1, "streak": 0 } }
  ]
}
```
How each metric is aggregated:

| metric | hour bucket | day bucket | week / month bucket (per-day average over counted days) |
|---|---|---|---|
| `minutes` | minutes in that hour | day total | mean of day totals |
| `budget_pct` | cumulative minutes by end of hour / budget × 100 | minutes / budget × 100 | mean of day % |
| `score` | health at end of hour (carry forward; 100 before the first tick) | day score | mean of day scores |
| `sessions` | sessions starting in that hour | day sessions | mean of day sessions |
| `streak` | the day's streak (same for every hour) | streak as of that day | streak as of the last counted day |

- `over_limit`: day bucket → `minutes > budget`. Week/month → mean day minutes > `budget`. Hour → cumulative minutes by end of hour > that day's budget.
- A bucket with no counted days has `value: null`, every entry in `values` null, and `over_limit: false`.
- `budget_pct` with `budget == 0`: `100` if minutes > 0, else `0`.
- Round every value to 1 decimal.

### `GET /api/sites?range=&anchor=&today=&include_demo=[&start=&end=][&hour=]`
- `start` and `end` (both required together) override the window. Used when a day/week/month bar is selected.
- `hour=0..23` (only with `range=day`) narrows to one hour from raw events. Used when an hourly bar is selected.
- Response: `{"total_minutes": 210, "sites": [{"hostname": "stake.com", "minutes": 130, "share": 0.62, "sessions": 4, "source": "domain"}]}`. At most 10 rows, sorted by minutes descending, then hostname.

### `GET /api/heatmap?range=&anchor=&today=&include_demo=`
`{"cells": [[...24 minutes...] × 7], "max": 38.5, "partial": false}`. Row 0 = Monday. Built from raw `events` in the window only. `partial = true` when the window starts before `today - 90 days`.

### `GET /api/export?format=json` / `?format=csv&table=daily|events|sites`
- JSON: `{"exported_at": <iso>, "daily": [...], "daily_sites": [...], "events": [...], "sites": [...], "backfill": [...]}` for `user_id='local'`, as a download (`Content-Disposition: attachment; filename="testudo-export.json"`).
- CSV: one table per request (`table` defaults to `daily`), header row, filename `testudo-<table>.csv`. Built with the `csv` module.

### `DELETE /api/data?confirm=yes`
Deletes the user's rows from all five tables. Without `confirm=yes` → **400** `{"detail": "Add ?confirm=yes to delete everything."}`. Success → `{"ok": true}`.

---

## 3. Scoring (`server/scoring.py`)

### 3.1 Day score (mirrors `health.js` `computeHealth`)
```python
def day_score(minutes, budget):
    if not budget or budget <= 0:
        return 0.0 if minutes > 0 else 100.0
    return min(100.0, max(0.0, 100.0 - minutes / budget * 100.0))
```

### 3.2 Stage (mirrors `getPetStage` and `pet.js`)
`>= 80` happy, `>= 50` tired, `>= 20` sick, else asleep.

### 3.3 Streak as of day `D`
A day is **clean** if it is counted and its minutes are 0.
Walk back from `D - 1` while days are clean and `>= install_date`. `streak = number of clean days walked`. If the walk passes `install_date` without stopping (every day from `install_date` to `D - 1` is clean), add the backfill row's `streak` for `install_date` (0 if there's none). Like the extension, today is not counted. The dashboard's "streak" = `streak(today)`.

### 3.4 Overall score (the dashboard mascot)
```
days i = 0..13  (d_i = today - i), keep only d_i >= install_date
w_i   = 14 - i                       # today weighs 14, 13 days ago weighs 1
base  = sum(w_i * score(d_i)) / sum(w_i)
bonus = min(streak(today), 10)       # +1 per clean day in the streak, up to +10
overall = clamp(base + bonus, 0, 100), rounded to 1 decimal
```
If there's no `install_date` (no data): overall = 100, stage happy.

---

## Phase 0: Setup

- [ ] Add to `.gitignore`: `*.db`, `*.db-wal`, `*.db-shm`, `__pycache__/`, `.pytest_cache/`.
- [ ] Create `server/__init__.py` (empty) so `uvicorn server.app:app` works from the repo root. Use relative imports inside `server/` (`from . import db`).
- [ ] In the existing `.venv`: `.venv/bin/pip install fastapi uvicorn pytest`.
- [ ] Create `server/requirements.txt` with exact pins of the two runtime packages only, from `pip show fastapi uvicorn` (e.g. `fastapi==<version>`, `uvicorn==<version>`). Don't add them to the root `requirements.txt` (that one is for the Ollama script).
- [ ] Create `server/requirements-dev.txt`: `-r requirements.txt`, then `pytest==<version>` and `httpx` (already in the root requirements, needed by `TestClient`).

**Done when:** `.venv/bin/python -c "import fastapi, uvicorn"` runs with no error.

---

## Phase 1: Backend skeleton (ingest + health)

### Files
- [ ] `server/config.py`: the constants from section 1. `REPO_ROOT = Path(__file__).resolve().parent.parent`.
- [ ] `server/db.py`:
  - `connect()` → `sqlite3.connect(DB_PATH, check_same_thread=False)` with `row_factory = sqlite3.Row`. `check_same_thread=False` is required because FastAPI may run a sync dependency and its endpoint on different threadpool threads.
  - `init_schema()`: runs the DDL from section 1 via `executescript`, then sets `user_version`. Creates the parent directory of `DB_PATH` if it's missing.
  - `get_conn()`: a FastAPI dependency (`yield` a connection, then close it).
- [ ] `server/scoring.py`: `day_score`, `stage_for` (section 3). Streak and overall come in Phase 3.
- [ ] `server/models.py`: pydantic v2 models `TickEvent`, `BackfillEvent` with `type: Literal[...]`, and `IngestItem = Annotated[Union[TickEvent, BackfillEvent], Field(discriminator="type")]`. Validation rules as in section 2. Ingest takes `list[IngestItem]` with `max_length=1000`. Lowercase `hostname` in a validator.
- [ ] `server/ingest.py`: `ingest(conn, items, today, enforce_retention=True) -> dict`, run in **one transaction** in this order:
  1. `cutoff = today - RETENTION_DAYS`. If `enforce_retention`, drop ticks with `date < cutoff` and count them as `ignored`. (Their day is final and its raw events may already be purged, so recomputing it would shrink it.)
  2. **Backfills first.** For each: if a `backfill` row or a `daily` row (any scope) exists for `(user_id, date)` → ignore. Else insert.
  3. Ticks: `INSERT OR IGNORE INTO events`. `accepted += cursor.rowcount`.
  4. Upsert `sites` for each tick host: `first_seen = MIN(first_seen, ts)`, `last_seen = MAX(last_seen, ts)`, `source = COALESCE(excluded.source, sites.source)`.
  5. For each affected `(user_id, date)`, run `recompute_day` for scopes `real` and `all`.
- [ ] `recompute_day(conn, user_id, date, scope)`:
  - `E` = events for the user and date (`AND demo = 0` when scope is `real`), ordered by `ts`. `B` = the backfill row (skip it when scope is `real` and `B.demo = 1`).
  - If there's no `E` and no `B` → delete the `daily` and `daily_sites` rows for that key and return.
  - `gambling_minutes = sum(E.minutes) + (B.minutes or 0)`
  - `budget` = budget of the last `E`, else `B.budget`
  - `min_health = min(E.health ∪ {B.health})`, `end_health` = health of the last `E`, else `B.health`
  - `score = day_score(gambling_minutes, budget)`
  - `sessions` = count of `E` where the gap to the previous tick is `NULL` or `> SESSION_GAP_MS`, plus 1 if `B.minutes > 0`. Use the window function:
    ```sql
    SELECT COUNT(*) FROM (
      SELECT ts - LAG(ts) OVER (ORDER BY ts) AS gap
      FROM events WHERE user_id = ? AND date = ? AND demo IN (<0> or <0,1>)
    ) WHERE gap IS NULL OR gap > ?
    ```
  - `INSERT OR REPLACE INTO daily`.
  - `daily_sites`: delete the rows for the key, then insert per host: `SUM(minutes)` and the same session count with `PARTITION BY hostname`. Backfill minutes don't go to any host.
- [ ] `server/app.py`:
  - `app = FastAPI(lifespan=lifespan)`. `lifespan` calls `init_schema()`.
  - `CORSMiddleware(allow_origin_regex=r"^chrome-extension://[a-p]{32}$", allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type"])`.
  - `POST /api/events` → `ingest(...)` with server `date.today()` for the cutoff.
  - `GET /api/health` → section 2 (`has_demo` query included).
  - Define routes as plain `def` (sync). sqlite3 calls block, so they belong on the threadpool.

### Tests (`server/tests/test_ingest.py`, using a temp DB via `TESTUDO_DB` set before import, or a `conn` fixture on `:memory:`)
- [ ] The same batch posted twice → second response `accepted: 0`, and `daily.gambling_minutes` is unchanged.
- [ ] Backfill 30 min + two 1-minute ticks on the same date → `daily.gambling_minutes == 32` in both scopes. Posting the backfill again → `"backfill": "ignored"`.
- [ ] Demo ticks → present in scope `all`, absent from `real`.
- [ ] Ticks 3 minutes apart → 1 session. 6 minutes apart → 2 sessions.
- [ ] A tick older than 90 days → `ignored`, no row.
- [ ] Bad payload (`minutes: 0`, `date: "10/25/2026"`) → 422.

### Manual check
```sh
.venv/bin/uvicorn server.app:app --port 8000 --reload
curl -s localhost:8000/api/health
curl -s -X POST localhost:8000/api/events -H 'content-type: application/json' \
  -d '[{"type":"tick","ts":1761400000000,"date":"2026-10-25","hostname":"stake.com","minutes":1,"health":99.2,"budget":120,"source":"domain","demo":false,"tz_offset":240}]'
sqlite3 testudo.db 'select * from daily;'
```

**Done when:** `.venv/bin/pytest server/tests -q` passes, and a curl post shows up in `daily` and stays the same after a second post.

**Commit:** `feat(server): sqlite schema, idempotent ingest, health endpoint`

---

## Phase 2: Extension sync

### `config.js`
- [ ] Add `export const BACKEND_URL = "http://localhost:8000";`. This is the **only** place the URL lives.

### `storage.js` → `getDefaultState()`
- [ ] Add `outbox: []`, `pendingBackfill: null`, `syncBackfillDone: false`, `userId: "local"`.

### `sync.js` (new, ES module, imported only by `background.js`)
- [ ] Constants: `OUTBOX_CAP = 5000`, `BATCH_SIZE = 500`, `MAX_BATCHES_PER_FLUSH = 10`, `TIMEOUT_MS = 5000`.
- [ ] A module-level promise chain `locked(fn)` that serializes every read-modify-write of `outbox` and `pendingBackfill` (the demo loop ticks every second, so writes can race otherwise).
- [ ] `captureBackfill()` (locked): reads fresh state. If `syncBackfillDone` → return. Else `setState({ pendingBackfill: { type: "backfill", user_id: userId, ts: Date.now(), date: lastResetDate, minutes: gamblingMinutesToday, streak, budget: budgetMinutes, health, demo: demoMode }, syncBackfillDone: true })`. Use `lastResetDate`, not `todayISO()`: before the daily reset runs, the minutes belong to `lastResetDate`.
- [ ] `record(fields)` (locked): push `{ type: "tick", user_id: userId, tz_offset: new Date().getTimezoneOffset(), ...fields }` onto `outbox`. If it's longer than `OUTBOX_CAP`, drop from the front (oldest). `setState({ outbox })`.
- [ ] `flush()`: guarded by a module-level `flushing` flag so only one runs at a time. Loop up to `MAX_BATCHES_PER_FLUSH`:
  1. `await captureBackfill()`.
  2. Read state. `batch = [pendingBackfill?, ...outbox.slice(0, BATCH_SIZE)]`. Empty → stop.
  3. `fetch(\`${BACKEND_URL}/api/events\`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch), signal })` with an `AbortController` timeout of `TIMEOUT_MS`.
  4. Not `res.ok`, or throws → log `[PausePet] sync failed ...` once and stop. **Never throw out of `flush`.**
  5. On success (locked): remove sent ticks by key `ts|hostname` (not by index, because the cap may have trimmed the front during the request). Set `pendingBackfill: null` if it was sent.
  6. Stop when fewer than `BATCH_SIZE` ticks were sent.
- [ ] Export `record`, `flush`, `captureBackfill`.

### `background.js`
- [ ] `import { record, flush, captureBackfill } from "./sync.js";`
- [ ] Change `addGamblingMinute(minutes = 1)` to `addGamblingMinute(minutes = 1, site = null)`:
  ```js
  const state = await ensureDailyReset();
  await captureBackfill();                 // before any minute is added, so nothing is counted twice
  const added = ...;                       // unchanged
  ...
  await setState({ gamblingMinutesToday, health, lastGamblingAt: Date.now() });
  if (site) await record({
    ts: Date.now(), date: todayISO(), hostname: site.hostname, minutes: added,
    health, budget: state.budgetMinutes, source: site.source, demo: state.demoMode,
  });
  await updateBadge(health);
  ```
  `minutes` is `added` (demo multiplier applied), so `SUM(events.minutes)` matches `gamblingMinutesToday`.
- [ ] In `onTick`, change the gambling branch to `await addGamblingMinute(fraction, { hostname, source: entry.source });`. Non-gambling branches stay as they are. Nothing is recorded there.
- [ ] Leave `DEBUG_ADD_MINUTES` and `debugAddMinutes` as they are (no site, so not recorded; see section 0 #16).
- [ ] Alarm listener: add `.then(() => flush())` after the tick, inside the existing chain, so it runs every minute in both normal and demo mode (`.catch` already logs).
- [ ] At the top level, after `syncDemoLoop();`, add `flush();` so the outbox drains when the service worker wakes up.
- [ ] `manifest.json`: **no change**. `<all_urls>` already covers `http://localhost:8000/*`, and extension service-worker fetches with host permission aren't blocked by CORS.

### Verify
- [ ] Reload the extension at `chrome://extensions`. Start the server. Open `https://www.draftkings.com` and stay active for 2 to 3 minutes. Then `sqlite3 testudo.db "select date, hostname, minutes, source from events order by ts desc limit 5;"` shows rows with `source = 'domain'`, and `select * from backfill;` shows one row.
- [ ] Stop the server, stay on the site 2 more minutes. In the service worker console: `(await chrome.storage.local.get('outbox')).outbox.length` is greater than 0. Start the server and wait about 1 minute. The outbox is `0`, and `daily.gambling_minutes` for today equals the popup's "Today" minutes (± the minute in flight).
- [ ] Visit `espn.com`. No new event.
- [ ] Turn demo mode on for 30 s. Events arrive with `demo = 1`, and the `real` scope's minutes don't change.

**Done when:** every check above passes, and the popup, badge, and pet behave exactly as before with the server off.

**Commit:** `feat(extension): sync gambling ticks to local backend via outbox`

---

## Phase 3: Read endpoints, scoring, retention, seed

### `server/windows.py` (pure date math, no DB)
- [ ] `parse_day(s)`, `monday_of(d)`, `add_months(d, n)` (clamps the day of month), `window(range, anchor) -> (start, end)`, `prev_window(range, anchor) -> (start, end)`, `buckets(range, start, end) -> list[(kind, b_start, b_end, hour|None)]`. All follow the table in section 2.
- [ ] Tests (`test_windows.py`): week of Sun 2026-10-25 → 2026-10-19..2026-10-25. Month Feb 2028 → 29 days. `prev_window` month of 2026-03-31 → 2026-02-01..2026-02-28. 6months → 26 buckets, the first is a Monday, the last contains the anchor. Year of 2026-10-25 → 2025-11-01..2026-10-31, 12 buckets.

### `server/queries.py`
- [ ] `install_date(conn, user, scope)`, `current_budget(conn, user, scope)` (latest `daily.budget`, else 120).
- [ ] `day_rows(conn, user, scope, start, end, today)` → a dense list of one dict per date in `[start, end]` with `counted, minutes, budget, score, sessions`, following the counted/clean-day rules in section 2.
- [ ] `streaks(conn, user, scope, start, end, today)` → `{date: streak}` using section 3.3 (one forward pass from `install_date`, which is fine for a few thousand days).
- [ ] `hourly(conn, user, scope, day)` → 24 buckets from events using the local-hour formula (section 0 #2). Session starts use the same `LAG` query, grouped by the hour of the starting tick. `hourly_available = day >= today - 90`.
- [ ] `summary(...)`, `series(...)`, `sites(...)`, `score(...)` that build exactly the shapes in section 2. `sites` reads `daily_sites` (or `events` when `hour` is given) and joins `sites` for `source`.
- [ ] `scoring.py`: add `overall_score(day_scores_by_date, today, install_date, streak)` (section 3.4).

### `server/app.py`
- [ ] Routes: `GET /api/summary`, `/api/series`, `/api/sites`, `/api/score`. Query params are validated with `Literal[...]` types and a date regex. `today` and `anchor` are parsed with `date.fromisoformat` (422 on error).
- [ ] Retention: `purge_old_events(conn, today)` deletes `events` with `date < today - 90 days` (daily rows are already complete). It runs in `lifespan` at startup, and in an `asyncio` task started in `lifespan` that runs it every 24 h (`await asyncio.sleep(86400)`, cancelled on shutdown).

### `server/seed.py`
- [ ] `python -m server.seed --days 365 [--reset] [--seed 42] [--demo-days 0]`.
- [ ] Refuses to run if the DB already has data, unless `--reset` (which runs the same delete as `DELETE /api/data`).
- [ ] Writes a backfill on day 1 (`streak 0`). Then for each day it builds ticks with realistic patterns: about 30% clean days, more on Fri to Sun, evening hours (18–23) weighted, 1 to 4 sessions per gambling day, hosts drawn from `stake.com, draftkings.com, fanduel.com, polymarket.com, betmgm.com`, budget 120 with a change to 60 about 4 months ago, health computed with `day_score` as minutes grow, `tz_offset` = the local machine's offset.
- [ ] Sends everything through `ingest(..., enforce_retention=False)`, then calls `purge_old_events` so the DB looks exactly like a real 365-day history (raw events only for the last 90 days).

### Tests
- [ ] `test_scoring.py`: `day_score(60, 120) == 50`, `day_score(5, 0) == 0`, `day_score(0, 0) == 100`. Overall with 14 clean days and streak 14 → 100. Stage boundaries 80/50/20. Streak walk with backfill streak 2 and 3 clean days since install → 5. A gambling day yesterday → 0.
- [ ] `test_api.py` (TestClient on a seeded temp DB): `series` week has 7 points and month has the right number of days. Future days are `null`. Days before install are `null`. A clean counted day has `minutes 0, score 100`. `summary.can_go_next` is false for the current week. `sites` shares sum to about 1.

**Done when:** tests pass, and after `python -m server.seed --days 365 --reset`:
`curl 'localhost:8000/api/series?metric=minutes&range=year&today=2026-10-25'` returns 12 points, and `curl 'localhost:8000/api/summary?range=week&today=2026-10-25'` shows a sensible average, change, streak, and overall score.

**Commit:** `feat(server): summary, series, sites, score endpoints, retention, seed script`

---

## Phase 4: Dashboard shell (Week + Time)

### Static serving (`server/app.py`)
- [ ] `GET /pet.js` → `FileResponse(REPO_ROOT / "pet.js", media_type="text/javascript")`. One copy of the mascot.
- [ ] **After every API route and `/pet.js`**, `app.mount("/", StaticFiles(directory=REPO_ROOT / "dashboard", html=True), name="dashboard")`. It has to be last, or it catches `/api/*`.

### Files (`dashboard/`)
- [ ] `index.html`: `<!DOCTYPE html>`, `<meta name="viewport" ...>`, `<title>Testudo Dashboard</title>`, `<link rel="stylesheet" href="dashboard.css">`. Body follows the spec layout: header (`#pet.hero-pet`, headline, message, overall score + bar + streak), controls (metric `<select id="metric">`, range button group, prev / label / next), main chart card, a two-column row (Most visited | When you play), highlights card, help card (copy the markup from `options.html` lines 98–105), footer (privacy text, export links, delete). Scripts: `<script src="/pet.js"></script>` **then** `<script type="module" src="dashboard.js"></script>`.
- [ ] `dashboard.css`: copy the `:root` tokens and the dark `@media (prefers-color-scheme: dark)` block **exactly** from `options.css` lines 1–29, plus a new `--over` token (light `#d9644a`, dark `#f0876b`) for over-limit bars. Same body font, `section` card style (radius 14px, `var(--card)`, `var(--shadow)`, padding 18px), `.hero-pet` and the `@keyframes bob` from `options.css`. `main { max-width: 960px }`. Under 640px the two-column row becomes one column.
- [ ] `format.js`: `todayISO()` (same logic as `storage.js`), `fmtMinutes(m)` → `"0 min"`, `"45 min"`, `"1 h"`, `"1 h 12 min"`, and `fmtRangeLabel(range, start, end)` using `Intl.DateTimeFormat` (e.g. "Oct 19 – 25, 2026", "October 2026", "Sun, Oct 25").
- [ ] `api.js`: `get(path, params)` adds `today=todayISO()` and `include_demo`, uses a 4 s `AbortController` timeout, and throws `OfflineError` on network failure or a non-2xx response.
- [ ] `chart.js`: `renderBarChart(svgEl, { points, metric, budget, selectedIndex, bucket })`.
  - `viewBox="0 0 640 240"`, `preserveAspectRatio="none"` on the plot only. Labels go in their own row so text doesn't stretch.
  - y max = `max(values, metric === "minutes" && bucket !== "hour" ? budget : 0, metric === "budget_pct" ? 100 : 0, metric === "score" ? 100 : 0) * 1.1`, or 1 if everything is 0.
  - Bars use `var(--accent)`, and `var(--over)` when `over_limit`. `null` → no bar. Selected bar at full opacity, others at 0.45 while something is selected.
  - Dashed line (`stroke-dasharray="4 4"`, `var(--muted)`) at `budget` for `minutes` (not hourly), and at 100 for `budget_pct`, labeled "daily limit 2 h" / "100%".
  - x labels: hours `0, 6, 12, 18`. Days → weekday initial (week) or day number every 5th (month). Weeks → month name on the first week of each month. Months → month initial.
- [ ] `dashboard.js`: one `state = { range: "week", metric: "minutes", anchor: todayISO(), selected: null, includeDemo: false }`. `load()` fetches `summary`, `series`, `sites`, `score`, `heatmap` in parallel and then calls `render()`. In this phase render only the header (mascot via `Pause.pet.mascotSVG(stage)`, the stage class on `#pet` so `.asleep` slows the bob), the controls, the header number (`metrics.minutes.average` → "Daily average", `fmtMinutes`), and the chart.
- [ ] Dashboard mascot copy (in `dashboard.js`; `pet.js` is unchanged):
  - headline: happy "Testudo is feeling great", tired "Testudo is a little tired", sick "Testudo isn't feeling so good", asleep "Testudo is resting"
  - message: happy "Feeling great lately. Thanks for looking after us.", tired "A little sleepy lately. A gentle week ahead would help.", sick "Not my best lately. Could we take things slower together?", asleep "Worn out lately. I'm here whenever you're ready."
  - score bar fill colour = `stageInfo(score).color`.

**Done when:** with seeded data, `http://localhost:8000/` shows the mascot at the right stage, the overall score and streak, and 7 Time bars for the current week with a dashed 2 h line. The page looks like `options.html` (same colors and cards).

**Commit:** `feat(dashboard): shell with mascot, overall score, weekly time chart`

---

## Phase 5: All ranges and metrics, selection, Most visited, heatmap, highlights

- [ ] **Range buttons** (`Day | Week | Month | 6M | Year`, `aria-pressed`). Changing the range keeps `anchor` and clears `selected`.
- [ ] **Prev/next**: change `anchor` by one window (day ±1, week ±7, month ±1 month via `add_months` logic in JS, 6months ±182 days, year ±12 months). Disable from `summary.can_go_prev` / `can_go_next`. Clear `selected`.
- [ ] **Metric picker**: Time (`minutes`), Limit used (`budget_pct`), Score (`score`), Sessions (`sessions`). Switching doesn't refetch: the chart reads `points[i].values[metric]` and the header reads `summary.metrics[metric]`, both already loaded. Keep the selection.
- [ ] **Header number per metric**:
  - Time: "Daily average" + `fmtMinutes(avg)` (`"Average per day"` for 6M/Year)
  - Limit used: "Average limit used" + `"60%"`
  - Score: "Average day score" + `"41"`
  - Sessions: "Sessions per day" + `"1.3"`
  - Delta line: "18% less than last week" / "12% more than last month" / "Same as last week" (|Δ| < 1). "Better" = lower for `minutes`, `budget_pct`, `sessions`, higher for `score`. Better shows in `var(--good)` with ▼/▲ as appropriate. Worse shows in `var(--muted)`, never red. `change_pct` null → hide the delta.
- [ ] **Bar selection**: click, or Enter/Space on the focused chart, toggles `selected = index`. While selected:
  - The header shows that bucket's value with its label (e.g. "Tue, Oct 21" or "2 PM – 3 PM") and no delta.
  - Most visited refetches with `start`/`end` from the point (or `range=day&anchor=<day>&hour=<h>` for hour buckets).
  - Clicking the same bar again, or pressing Escape, deselects.
- [ ] **Most visited** card: rank, hostname, `fmtMinutes`, and a proportional bar (`share`). Empty → "No gambling sites in this period. That's worth celebrating."
- [ ] **Heatmap** (`heatmap.js`): a 7 × 24 SVG grid, rows Mon–Sun, columns at 0/6/12/18 labeled. Cell opacity = `minutes / max` on `var(--accent)` (0 → `var(--track)`). Each cell has `<title>` "Sat 9 PM: 25 min". If `partial`, add the note "Based on the last 90 days." Shown for every range.
- [ ] **Highlights** card (kind wording, only lines that apply):
  - `longest_break_days >= 1` → "Your longest break: N day(s)."
  - `best_day` → "Lightest day: Tuesday (12 min)." (weekday for week/month, "Oct 21" for longer ranges)
  - `clean_days >= 1` → "N gambling-free day(s) this <range>."
  - `under_limit_days` → "You stayed under your limit on N of M days."
  - Nothing applies → "Every day is a fresh start."
- [ ] Day range with `hourly_available: false` → the chart area shows "Hourly detail is kept for 90 days. Here's the day total:" plus the total.

**Done when:** with seeded data every range × metric combination draws correctly, prev/next walks back to the install date and stops, selecting a bar updates the header and Most visited, and the heatmap shows the evening/weekend pattern from the seed.

**Commit:** `feat(dashboard): all ranges and metrics, bar selection, sites, heatmap, highlights`

---

## Phase 6: Polish

### Backend
- [ ] `GET /api/export` and `DELETE /api/data` exactly as in section 2. Tests: export JSON has every key. CSV has a header row. Delete without `confirm` → 400. Delete with `confirm=yes` → every table is empty and `/api/score` → `has_data: false`.

### States
- [ ] **Offline**: any `OfflineError` shows a banner at the top (`var(--warn-bg)` / `var(--warn-text)`, not red): "Can't reach the Testudo server. Start it with `uvicorn server.app:app` (or `docker compose up -d`)." The last data stays on screen. Poll `/api/health` every 10 s while offline, then hide the banner and `load()` again.
- [ ] **Auto-refresh**: while online and the tab is visible (`document.visibilityState`), call `load()` every 60 s, keeping the current selection if its bucket still exists.
- [ ] **No data** (`summary.has_data === false`): show the mascot happy (overall 100) and one card: "Nothing here yet. That's okay. Testudo will fill this in as you browse." Hide the chart, sites, heatmap, and highlights.
- [ ] **Demo toggle**: only shown when `/api/health` reports `has_demo`. A checkbox "Include demo data", off by default, sets `includeDemo` and reloads.
- [ ] **Dark mode**: check every new element against the dark tokens. No hard-coded colors outside `:root` except the mascot SVG.
- [ ] **Accessibility**:
  - The chart wrapper is `tabindex="0"` with `role="group"` and `aria-label="<metric> by <bucket>, use left and right arrows to pick a bar"`. Left/Right moves the selection (starting from the last non-null bar), Home/End jump, Escape clears.
  - Each bar is `role="img"` with `aria-label="Tue, Oct 21: 42 min, under your limit"`.
  - A visually hidden `aria-live="polite"` region announces the selected bar.
  - Range buttons and prev/next are real `<button>`s. Visible focus ring copied from `options.css` (`:focus-visible` rule).
  - `@media (prefers-reduced-motion: reduce) { .hero-pet { animation: none; } }` (same as `options.css`).
- [ ] **Footer**:
  - Privacy line from `/api/health.deployment`: `local` → "🔒 Everything here stays on your device." `remote` → "🔒 Your history is stored on your Testudo server."
  - Export links: "Download all (JSON)", "Daily history (CSV)", "Raw events (CSV)" pointing at `/api/export...`.
  - **Delete my data**: two steps with no browser `confirm()`. The first click changes the label to "Tap again to delete everything" and shows a note ("This removes your dashboard history. Your current day in the extension isn't affected."). It resets after 5 s. The second click → `DELETE /api/data?confirm=yes` → `load()`.
- [ ] Nice to have: clicking the mascot toggles a line under the message: "Your score is a 14-day average where recent days count more, plus a small bonus for your streak."

### Extension entry points
- [ ] `options.html`: add a `<section>` above "Need to talk to someone?" with `<h2>📈 Your history</h2>`, a short line, and `<a id="openDashboard" target="_blank" rel="noopener">Open dashboard</a>`. In `options.js`, import `BACKEND_URL` from `config.js` and set `els.openDashboard.href = \`${BACKEND_URL}/\``.
- [ ] `popup.html`: add `<button id="openDashboard" class="link" type="button">Open dashboard</button>` next to Settings. In `popup.js`, import `BACKEND_URL` and on click call `chrome.tabs.create({ url: \`${BACKEND_URL}/\` })`.

**Done when:** stopping the server shows the warm banner and starting it clears the banner without a reload. A fresh DB shows the empty state. Keyboard-only navigation works across tabs, the chart, and delete. Dark mode looks right. Both extension links open the dashboard.

**Commit:** `feat(dashboard): offline/empty/demo states, a11y, export, delete, entry links`

---

## Phase 7: Docker

- [ ] `Dockerfile` (repo root):
  ```dockerfile
  FROM python:3.12-slim
  WORKDIR /app
  COPY server/requirements.txt server/requirements.txt
  RUN pip install --no-cache-dir -r server/requirements.txt
  COPY server/ server/
  COPY dashboard/ dashboard/
  COPY pet.js pet.js
  ENV TESTUDO_DB=/data/testudo.db
  EXPOSE 8000
  HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)" || exit 1
  CMD ["uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8000"]
  ```
- [ ] `.dockerignore`: `.git`, `.venv`, `__pycache__`, `*.db*`, `server/tests`, `*.pdf`, `icons`, `.claude`.
- [ ] `docker-compose.yml`:
  ```yaml
  services:
    testudo:
      build: .
      ports: ["127.0.0.1:8000:8000"]
      volumes: ["testudo-data:/data"]
      environment:
        TESTUDO_DB: /data/testudo.db
        TESTUDO_DEPLOYMENT: local
      restart: unless-stopped
  volumes:
    testudo-data:
  ```
- [ ] Ollama is **not** in compose. The backend never calls it.

**Done when:** `docker compose up -d --build` → `docker compose ps` shows `healthy`. The extension posts events and the dashboard loads at `http://localhost:8000/`. Run `docker compose down && docker compose up -d` and the history is still there (it lives on the volume). For seed data inside Docker: `docker compose exec testudo python -m server.seed --days 365 --reset`.

**Commit:** `feat: docker compose for the dashboard backend`

---

## Phase 8: Docs and final check

- [ ] `README.md`: add a "Dashboard" section (start with Docker or uvicorn, open `localhost:8000`, seed command, export/delete, "the extension works without it").
- [ ] `ARCH.md`: add `sync.js`, the new storage keys (`outbox`, `pendingBackfill`, `syncBackfillDone`, `userId`), `BACKEND_URL`, and a short `server/` + `dashboard/` section. Remove the dashboard from "Not built yet" if it's listed there.
- [ ] `DASHBOARD-SPEC.md`: add one line at the top: "Built per `DASHBOARD-PLAN.md`, which records every change to this spec."
- [ ] Check the DigitalOcean seams: `BACKEND_URL` is only in `config.js` (`grep -rn "localhost:8000" --include=*.js .` matches only `config.js`). Every table has `user_id`. The footer copy switches on `TESTUDO_DEPLOYMENT`. All SQL is plain (no SQLite-only syntax other than `INSERT OR IGNORE/REPLACE`, `PRAGMA`, which are the known Postgres port points; list them in ARCH.md).
- [ ] Full regression with the server **off**: badge, popup, on-page pet, pause screen, and options page all behave as before, and the service worker console shows only the quiet `sync failed` log.

**Done when:** a fresh clone can follow the README to a working dashboard, and `.venv/bin/pytest server/tests -q` passes.

**Commit:** `docs: dashboard setup and architecture`

---

## Deferred (not in this plan)
- Auth for DigitalOcean, and real per-install `user_id` UUIDs (both come with the remote deployment).
- Server-side timezone handling beyond the per-event `tz_offset` and the client-supplied `today`.
- Postgres.
