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

Then open `chrome://extensions`, enable Developer mode, and click **Load unpacked**.

## Stack

Chrome Manifest V3, plain JavaScript, no dependencies, no build step.

See `Pause Claude Code Build Guide.pdf` for the full build plan.
