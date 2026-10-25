# Pause

A Chrome extension that gently interrupts gambling sessions by tying gambling time to the health of a virtual pet.

## How it works

- Set a daily gambling-time budget (e.g. 2 hours).
- Every active minute on a gambling site drains the pet's health; time away heals it.
- At low health, a gentle pause overlay shows your own reason for quitting and a helpline link.
- "Continue anyway" is always available. The pet never dies permanently.

## Principles

- **Private:** all AI runs locally with Gemma 4 E2B on Ollama. Page text never leaves your machine.
- **Minimally invasive:** a small corner widget by default.
- **Non-punitive:** warm, non-judgmental language.
- **Fast:** known-domain list and keyword heuristics first, Gemma only for unknown sites, results cached.

## Setup

```sh
OLLAMA_ORIGINS="chrome-extension://*" ollama serve
ollama pull gemma4:e2b
```

Then open `chrome://extensions`, enable Developer mode, and click **Load unpacked**, and pick the `extension/` folder.

## Dashboard

An optional local dashboard shows your history over days, weeks, months, and a year. The extension works fine without it; it just keeps a small queue and sends it when the server is up.

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

## Stack

Chrome Manifest V3, plain JavaScript, no dependencies, no build step.

See `docs/guides/Pause Claude Code Build Guide.pdf` for the full build plan.
