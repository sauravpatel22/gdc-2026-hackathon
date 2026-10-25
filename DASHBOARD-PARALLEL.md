# Dashboard: Parallel Run Sheet (45 min)

Splits `DASHBOARD-PLAN.md` into 6 parallel sessions plus 1 wiring session. **The plan stays the source of truth.** Every session reads it; this file only says who builds what, who owns which files, and what the seams look like.

## Before you launch (2 min)

Worktrees only contain committed files, and `DASHBOARD-*.md`, `gemma.js`, `petLine.js` and your edits to `background.js`, `storage.js`, etc. are uncommitted right now.

```sh
git add -A && git commit -m "wip: pre-dashboard snapshot"
git checkout -b dashboard
for s in a b c d e f; do git worktree add ../testudo-$s -b dash/$s dashboard; done
```

Open one terminal per worktree (`../testudo-a` ... `../testudo-f`), run `claude` in each, paste that session's prompt. Each session works **only in its own worktree** and commits to its own branch.

## Timeline

| Time | What |
|---|---|
| 0:00 | Launch A–F |
| 0:25 | Hard stop for A–F: commit whatever works, even if partial. Note what's missing in the final commit message. |
| 0:25–0:40 | Merge A → C → F → B → D → E, then run Session G |
| 0:40–0:45 | Demo run-through, fix-ups |

If a session is behind at 0:20, cut its "nice to have" items first (listed per session).

## Sessions at a glance

| | Scope | Plan phases | Depends on |
|---|---|---|---|
| **A** | Backend foundation: schema, ingest, health | 0, 1 | nothing |
| **B** | Extension sync + "Open dashboard" links | 2, 6 (entry points) | contract only |
| **C** | Backend read path: windows, queries, scoring, endpoints, retention | 3 (no seed) | schema (section 1), contract |
| **D** | Dashboard core: shell, header, controls, chart, selection | 4, 5 (range/metric/selection/header) | contract only (mock data) |
| **E** | Dashboard cards: sites, heatmap, highlights, footer, states | 5 (cards), 6 (states, a11y of cards) | contract only (fixtures) |
| **F** | Seed script, export/delete, Docker, docs | 3 (seed), 6 (export/delete), 7, 8 | schema; seed needs A's `ingest` at merge time |
| **G** | Wiring, integration, end-to-end check | glue | A–F merged |

## File ownership (no two sessions touch the same file)

| Session | Owns |
|---|---|
| A | `.gitignore`, `server/__init__.py`, `config.py`, `db.py`, `models.py`, `ingest.py`, `scoring.py` (only `day_score`, `stage_for`), `app.py`, `requirements*.txt`, `tests/test_ingest.py`, `tests/conftest.py` |
| B | `sync.js`, `background.js`, `storage.js`, `config.js`, `popup.html/js`, `options.html/js` |
| C | `windows.py`, `queries.py`, `routes_read.py`, `retention.py`, `tests/test_windows.py`, `test_scoring.py`, `test_api.py` |
| D | `dashboard/index.html`, `dashboard.css`, `dashboard.js`, `api.js`, `format.js`, `chart.js`, `dashboard/mock.js` |
| E | `dashboard/sites.js`, `heatmap.js`, `highlights.js`, `footer.js`, `states.js`, `cards.css`, `dev-cards.html` |
| F | `server/seed.py`, `routes_data.py`, `tests/test_export.py`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`, `README.md`, `ARCH.md`, `DASHBOARD-SPEC.md` (one line) |
| G | Edits `server/app.py` and `dashboard/dashboard.js` to connect everything |

Deviation from the plan to avoid merge conflicts: **routes live in separate `APIRouter` modules** (`routes_read.py` from C, `routes_data.py` from F). A owns `app.py` with only `POST /api/events` and `GET /api/health`. G adds the `include_router` lines, the `/pet.js` route, the static mount (last), and the purge task.

## Seams (the interfaces between sessions)

1. **HTTP API**: section 2 of the plan, exactly. D and E build against it with fixtures; C implements it.
2. **DB schema**: section 1 of the plan, exactly. A creates it via `db.init_schema()`; C and F read/write the same tables.
3. **Python imports**
   - A exposes `db.connect()`, `db.init_schema()`, `db.get_conn()`, `scoring.day_score`, `scoring.stage_for`, `ingest.ingest(conn, items, today, enforce_retention=True)`, `config.*`.
   - C exposes `routes_read.router` (an `APIRouter`) and `retention.purge_old_events(conn, today)`. C also owns streak and overall score; they go in `queries.py`, **not** `scoring.py`.
   - F exposes `routes_data.router`.
   - Until A merges, C and F start from a local copy of the section 1 DDL in a test helper; after merge they use `db.init_schema()`.
4. **JS modules in the dashboard** (E exports, D/G imports)
   - `sites.js`: `renderSites(el, sitesResponse, { range })`
   - `heatmap.js`: `renderHeatmap(el, heatmapResponse)`
   - `highlights.js`: `renderHighlights(el, summary)`
   - `footer.js`: `renderFooter(el, healthResponse, { onDelete })`
   - `states.js`: `setOfflineBanner(el, isOffline)`, `renderEmpty(el)`, `startOfflinePoll(checkFn, onBack)`, `startAutoRefresh(loadFn, ms = 60000)`, `renderDemoToggle(el, hasDemo, onChange)`
   - D's `index.html` must contain these containers: `#banner`, `#sites`, `#heatmap`, `#highlights`, `#footer`, `#empty`, `#demo-toggle`. E styles them in `cards.css`; G adds the `<link>`.
5. **`format.js`** (`todayISO`, `fmtMinutes`, `fmtRangeLabel`): signatures are in plan Phase 4. D owns it. E may create a throwaway copy with the same signatures so it can work; on merge, keep D's.
6. **Sync payloads**: B emits exactly the `tick` and `backfill` items in section 2; A validates exactly the same.

---

## Prompts (paste one per session)

Every prompt starts with the same preamble:

> Read `DASHBOARD-PLAN.md` fully (it is the source of truth; `DASHBOARD-SPEC.md` is background). You are one of 6 parallel sessions; read `DASHBOARD-PARALLEL.md` for file ownership and seams. Only edit files you own. Work in this worktree on your own branch. Commit small and often. Hard stop at 25 minutes: commit what works. Don't wait on other sessions; build against the contract.

### Session A: Backend foundation

> Do plan Phase 0 and Phase 1. Order: `.gitignore`, `server/__init__.py`, requirements files, `config.py`, `db.py`, `scoring.py` (`day_score`, `stage_for` only), `models.py`, `ingest.py` with `recompute_day`, `app.py` (CORS, lifespan with `init_schema`, `POST /api/events`, `GET /api/health`). **Commit `config.py`, `db.py` and `scoring.py` within the first 5 minutes**, since other sessions copy from them. Then write `tests/conftest.py` (temp DB fixture) and `tests/test_ingest.py` with every case listed in Phase 1. Done when `pytest server/tests -q` passes and the curl check works. Nice to have, cut first: none, this is the critical path.

### Session B: Extension sync

> Do plan Phase 2 (`config.js` `BACKEND_URL`, `storage.js` defaults, `sync.js`, `background.js` changes) plus the "Extension entry points" part of Phase 6 (`options.html/js` and `popup.html/js` "Open dashboard"). Follow the locking, outbox cap, key-based removal, and backfill capture rules exactly. The backend may not exist yet in your branch: verify with a throwaway stub server (`python -m http.server` won't do; write a 10-line FastAPI or Node stub in the scratchpad that accepts `POST /api/events` and prints the body) and check payload shape against section 2. Also confirm with the stub off that popup, badge and pet behave as before. Do not edit anything under `server/` or `dashboard/`.

### Session C: Backend read path

> Do plan Phase 3 except `seed.py`: `windows.py` + `test_windows.py` first (pure date math, no dependencies), then `queries.py` (install date, day rows, streaks, hourly, summary, series, sites, score, overall score, heatmap), then `routes_read.py` exposing an `APIRouter` with `GET /api/summary`, `/series`, `/sites`, `/score`, `/heatmap`, and `retention.py` with `purge_old_events`. Do **not** edit `app.py`. Until Session A's `db.py` is merged, create the tables in tests from the section 1 DDL and insert rows with plain SQL; write `test_scoring.py` and `test_api.py` against that. Use a `FastAPI()` built in the test that includes your router. Query params validated with `Literal` types, 422 on bad input. Nice to have, cut first: heatmap `partial` flag, `hour` filter on `/api/sites`.

### Session D: Dashboard core

> Do plan Phase 4 and the Phase 5 items for range buttons, prev/next, metric picker, header number and delta, and bar selection. Files: `dashboard/index.html` (must include the containers `#banner #sites #heatmap #highlights #footer #empty #demo-toggle` as empty placeholders, plus the help card markup), `dashboard.css`, `api.js`, `format.js`, `chart.js`, `dashboard.js`, and `dashboard/mock.js`. Because the backend isn't ready, `api.js` returns fixtures from `mock.js` when the URL has `?mock=1` (generate them to match section 2 shapes for all 5 ranges). Serve with `python -m http.server` from the repo root and open `/dashboard/index.html?mock=1`; `/pet.js` is loaded from `../pet.js` in mock mode only if `/pet.js` 404s (simplest: temporarily symlink `dashboard/pet.js`, don't commit it). `dashboard.js` should call `load()` that fetches summary/series/sites/score/heatmap and exposes a `render()` that G can extend to call E's render functions. Include chart keyboard a11y (arrows/Home/End/Escape, aria-live) from Phase 6. Nice to have, cut first: mascot click explanation, reduced-motion CSS.

### Session E: Dashboard cards and states

> Build the self-contained card modules from plan Phases 5 and 6: `sites.js` (Most visited), `heatmap.js`, `highlights.js`, `footer.js` (privacy line by deployment, export links, two-step delete with no `confirm()`), `states.js` (offline banner, empty state, 10 s health poll, 60 s auto-refresh honoring `visibilityState`, demo toggle), and `cards.css`. Use the exact function signatures in the Seams section of `DASHBOARD-PARALLEL.md`. Use only the CSS tokens from `options.css` (`var(--card)`, `var(--accent)`, `var(--track)`, `var(--good)`, `var(--warn-bg)`, `var(--warn-text)`, `var(--muted)`), with no hard-coded colors, and check dark mode. Test with `dashboard/dev-cards.html`, which imports your modules and renders fixture data shaped exactly like section 2, including empty cases. Copy wording from the plan verbatim. Nice to have, cut first: heatmap `<title>` tooltips, delete note timeout polish.

### Session F: Seed, export/delete, Docker, docs

> Do plan Phase 3's `seed.py`, Phase 6's backend `GET /api/export` and `DELETE /api/data` (in `routes_data.py` as an `APIRouter`, with `tests/test_export.py`), Phase 7 (Dockerfile, `.dockerignore`, compose), and Phase 8 docs (README Dashboard section, ARCH.md, one line in the spec). Don't edit `app.py`. Session A's `ingest` isn't in your branch yet: write `seed.py` against the signature `ingest(conn, items, today, enforce_retention=True)` and the schema in section 1, and test it for real after merging A's branch in (`git merge dash/a` when it lands, around minute 10–15). Skip the `grep localhost:8000` and regression checks in Phase 8 (Session G does them). Nice to have, cut first: `--demo-days`, README polish.

### Session G: Wiring and integration (run after merging A–F)

> Merge order: `dash/a`, `dash/c`, `dash/f`, `dash/b`, `dash/d`, `dash/e` into `dashboard`. Then:
> 1. `server/app.py`: `include_router` for `routes_read` and `routes_data`; add `GET /pet.js`; mount `dashboard/` as static **last**; add the `purge_old_events` call at startup plus the 24 h `asyncio` task in `lifespan`; make `/api/health` `has_demo` and `deployment` real if A stubbed them.
> 2. `dashboard/index.html`: link `cards.css`; remove any mock-only code paths that break real mode.
> 3. `dashboard/dashboard.js`: import E's modules and call them from `render()`; wire selection to the sites card (`start`/`end`/`hour` refetch); wire offline banner + poll, auto-refresh, empty state, demo toggle, footer delete → `load()`.
> 4. Run `python -m server.seed --days 365 --reset`, start uvicorn, open `http://localhost:8000/`. Check every range × metric, prev/next to install date, selection, heatmap, dark mode, offline banner (kill the server), empty state (`DELETE /api/data?confirm=yes`).
> 5. Load the extension, visit a gambling site for 2 minutes, confirm the event reaches the dashboard. Confirm popup/options links open the dashboard and the extension still works with the server off.
> 6. `pytest server/tests -q`, then `grep -rn "localhost:8000" --include=*.js .` matches only `config.js`.
> 7. `docker compose up -d --build` if time allows.

## If things go wrong

- **A is late**: C and F keep working on their own DDL copies; G fixes up imports. A is the only critical-path session, so give it your attention first.
- **A session hits a merge conflict**: take the owner's version of the file (see ownership table). G reconciles `app.py` and `dashboard.js` by hand.
- **Short on time at 0:40**: ship order of importance is A, C, D, B, then E, then F's Docker/docs. The dashboard is demoable with just A + C + D + F's seed.
