# PausePet

A Chrome extension that gently helps you take breaks from gambling sites. Your time on those sites is tied to the health of a virtual pet, Testudo the terrapin, so you can see how the day is going at a glance.

## How it works

- Set a daily gambling-time limit (for example, 2 hours) in the settings page.
- The extension recognizes gambling pages in three steps: a list of known gambling sites, a quick keyword check, and a local Gemma model for pages it can't settle.
- Once a minute, while you're active on a gambling page, it counts one minute against your limit. Testudo's health drops as you get closer to it.
- Time away heals Testudo slowly, after about 10 minutes without gambling.
- The toolbar badge shows the health number. The popup shows Testudo with a health bar and a message. Testudo can also float on web pages, and you can hide it any time.
- Each day starts fresh, and a streak counts days with no gambling time.

| Health | Testudo | Badge color |
|---|---|---|
| 80–100 | Happy | Green |
| 50–79 | Tired | Yellow |
| 20–49 | Not feeling well | Orange |
| 0–19 | Resting | Red |

Testudo never dies permanently, and the language is always warm and non-judgmental.

## Principles

- **Private:** all AI runs locally with Gemma 4 E2B on Ollama. Page text never leaves your machine.
- **Gentle:** a small corner widget by default. No shaming.
- **Fast:** the known-domain list and keyword check come first. Gemma is only asked about unclear sites, and results are cached.
- **Resilient:** if Ollama isn't running, the extension keeps working and unclear pages are simply treated as unknown.

## Setup

### 1. Start Ollama (for Gemma)

Quit the Ollama menu-bar app first, because it won't accept requests from the extension. Then start it from a terminal:

```sh
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
ollama pull gemma4:e2b
```

Check it with `curl http://localhost:11434/api/tags`. If the extension still gets a `403`, the origin setting didn't apply, so make sure no other Ollama process is running. See `docs/guides/run-gemma-locally.md` for more detail.

### 2. Load the extension

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `extension/` folder. After you change any file, click the reload icon on the PausePet card.

### 3. Try it

- Click the toolbar icon to see Testudo, then **Settings** to set your limit.
- Visit a known gambling site such as `sportsbook.draftkings.com`, and keep the tab active. Open the service worker console (the **service worker** link on the extension card) to see what it decides.
- In Settings, turn on **Testing → Demo mode** to make time move 10× faster.

## Dashboard (optional)

A local dashboard shows your history over days, weeks, months, and a year. The extension works fine without it. It keeps a small queue and sends it when the server is up.

```sh
# with Docker
docker compose up -d --build

# or locally, from the repo root
python3 -m venv .venv && .venv/bin/pip install -r server/requirements-dev.txt
.venv/bin/uvicorn server.app:app --port 8000
```

Open http://localhost:8000/. The extension's popup and settings page have an "Open dashboard" link.

- **Fake history for a demo:** `.venv/bin/python -m server.seed --days 365 --reset` (in Docker: `docker compose exec testudo python -m server.seed --days 365 --reset`).
- **Export:** the links at the bottom of the dashboard, or `/api/export?format=json` and `/api/export?format=csv&table=daily|events|sites`.
- **Delete:** "Delete my data" at the bottom of the dashboard, or `curl -X DELETE 'localhost:8000/api/data?confirm=yes'`.
- Everything stays on your machine. Compose binds to `127.0.0.1` only.
- Tests: `.venv/bin/pytest server/tests -q`.

## Project layout

| Path | What's in it |
|---|---|
| `extension/` | The Chrome extension (Manifest V3, plain JavaScript, no dependencies, no build step) |
| `server/` | The dashboard backend (Python, FastAPI, SQLite) |
| `dashboard/` | The dashboard web page (plain JavaScript) |
| `scripts/` | Helper scripts, such as a Gemma connection check |
| `docs/` | Architecture notes, the build plan, and the dashboard spec |

For how the extension fits together, see `docs/ARCH.md`. For the original build plan, see `docs/BUILD-PLAN.md` and `docs/guides/Pause Claude Code Build Guide.pdf`.

## Status

Working: gambling-page detection, time tracking and health, the toolbar badge, the popup, the floating Testudo, the settings page, and the dashboard.

Planned: a full-screen pause check-in that appears at low health, showing your own reason for cutting back and a helpline link, with "Continue anyway" always available.

## If you're struggling

Support is free and confidential. In the US, you can call or text the National Problem Gambling Helpline at **1-800-522-4700** (24/7), or chat at [ncpgambling.org](https://www.ncpgambling.org/help-treatment/chat/).

## License

[MIT](LICENSE)
