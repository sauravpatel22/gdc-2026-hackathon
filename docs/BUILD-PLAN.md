# Pause: Build Plan (7 hours)

A simple, high-level version of `guides/Pause Claude Code Build Guide.pdf`. Each step says **what you're building**, **the small tasks**, and **how you know it's done**. Tick the boxes as you go.

**The idea in one line:** a Chrome extension with a virtual pet. Time on gambling sites drains the pet's health, time away heals it, and at low health a gentle pause screen appears. Gemma (running locally) helps spot gambling sites we don't already know about.

**Rules to keep in mind the whole time**
- Plain JavaScript, no frameworks, no build step.
- Every AI call can fail, so always have a fallback.
- All on-page UI lives in a Shadow DOM so site styles can't break it.
- Warm, non-judgmental wording. Never say "addict".
- "Continue anyway" is always available.
- Commit after each step so you can roll back.

---

## Phase 0: Setup (0:00 to 0:30)

- [ ] Do `guides/run-gemma-locally.md` until the `curl` test returns an answer.
- [ ] Keep `OLLAMA_ORIGINS="chrome-extension://*" ollama serve` running in a terminal.
- [ ] Create a `CLAUDE.md` in the project root with the ground rules from the PDF (page 2) so Claude Code follows them.
- [ ] Optional: do `guides/digitalocean-optional.md` later, only if time allows.

**Done when:** Gemma answers a test question and your project folder has the PDF and `CLAUDE.md`.

---

## Phase 1: Detection and time tracking, no AI (0:30 to 2:30)

### Step 1: Empty extension that loads
- [ ] Create the manifest, background script, content script, popup files, config file, storage helper, and placeholder icons.
- [ ] Store settings in one place (`config.js`): model name, Ollama URL, default budget (120 min), demo multiplier (10).
- [ ] Load it at `chrome://extensions` with Developer mode and **Load unpacked**.

**Done when:** the extension loads with no errors and its icon shows in the toolbar.

### Step 2: Spot known gambling sites
- [ ] Make a list of 60+ gambling domains (`domains.js`) and a function that matches a domain or its subdomains.
- [ ] In the page script, score the page by keywords (odds, parlay, jackpot, slots, and so on). A strong match is 3 or more different terms.
- [ ] The page sends its info to the background script, which answers: **gambling**, **not gambling**, or **unknown**.
- [ ] Known domain = gambling right away. Very low keyword score = not gambling. Anything in between = unknown (Gemma handles it later).
- [ ] Cache each decision per domain.

**Done when:** the background console logs "gambling" on draftkings.com and "not gambling" on espn.com.

### Step 3: Drain health while active
- [ ] Add a timer that fires once a minute (use `chrome.alarms`, never `setInterval`).
- [ ] Each tick: if the user is idle, do nothing. If the active tab is a gambling site, add one gambling minute. Otherwise, heal slowly.
- [ ] Health = 100 minus (minutes today ÷ budget × 100), never below 0.
- [ ] Reset the day's minutes at midnight and keep a streak of gambling-free days.
- [ ] Show health as the toolbar badge number, with colors: green, yellow, orange, red.
- [ ] Add a debug message so you can add minutes by hand to test.

**Done when:** the badge number drops while you sit on draftkings.com, and stops dropping when you leave.

**Checkpoint at 2:30:** the badge changes on a betting site.

---

## Phase 2: Gemma and pet state (2:30 to 4:00)

### Step 4: Gemma classifies unknown sites
- [ ] Write a function that sends the page title, URL, and first 1500 characters of text to Gemma through Ollama.
- [ ] Ask for a short JSON answer: gambling yes/no, type, confidence. Use temperature 0.
- [ ] Add an 8 second timeout. If anything fails, treat it as not gambling and don't cache the failure.
- [ ] Count it as gambling only if Gemma says yes **and** confidence is 0.6 or higher.
- [ ] Add a check that Ollama is up and the model is installed.
- [ ] Plug it into the "unknown" case from Step 2, cache the result, and avoid sending the same site twice at once.
- [ ] Log how long E2B takes.

**Done when:** a made-up gambling-style page not in your list is caught by Gemma, and a second visit is instant from the cache.

### Step 5: One place for pet logic
- [ ] Create `pet.js` that returns a snapshot: health, stage, minutes today, budget, streak, reason, settings, "gambling right now".
- [ ] Four stages by health: happy (80+), tired (50+), sick (20+), asleep (under 20).
- [ ] Add message handlers: get pet, save settings (budget 15 to 600), reset day.
- [ ] When the stage changes, tell the active tab (worse or better). Also send a regular update every tick.
- [ ] Add a debug command to set health to any number.
- [ ] Write the message types as a comment at the top of the file. The UI steps depend on it.

**Done when:** from the console you can set health and see a stage-change message arrive in a test tab.

**Checkpoint at 4:00:** Gemma classifies an unknown page and it's cached.

---

## Phase 3: Everything judges see (4:00 to 6:00)

### Step 6: Pet art
- [ ] Draw a simple round blob pet in SVG with 4 expressions: happy (bouncing), tired (yawning), sick (pale and droopy), asleep (zzz).
- [ ] Use only inline SVG and CSS, no images or libraries.
- [ ] Make a small local page that shows all 4 side by side to review the art.

**Done when:** you open the page and like how all 4 look.

### Step 7: Floating widget
- [ ] A small card in the bottom-right corner, inside a Shadow DOM.
- [ ] Contents: the pet, a health bar, a line like "Today: 42 of 120 min", and a collapse button.
- [ ] Only show it on pages that count as gambling.
- [ ] Animate the bar smoothly. On a stage change, swap the pet's expression and show a speech bubble for 6 seconds (use hardcoded lines for now).
- [ ] Remember whether it's collapsed.
- [ ] Keep it small, about 200 by 120 pixels.

**Done when:** on draftkings.com the widget appears and its bar moves as health drops.

### Step 8: Popup
- [ ] Top: big pet, health bar, stage, streak, "Today: X of Y minutes".
- [ ] Settings: budget slider (15 to 600 min), a "why do you want to cut back?" box (140 characters max), an on/off switch, and demo mode tucked under "Advanced".
- [ ] First run: a short welcome card with the slider, reason box, and a Start button.
- [ ] Footer link: "Need to talk to someone? Call 1-800-GAMBLER".

**Done when:** changing settings in the popup changes behavior and survives a browser restart.

### Step 9: Pause overlay
- [ ] Full-screen dimmed card in a Shadow DOM.
- [ ] Shows when the pet reaches "asleep", or when the user clicks something like "place bet" or "deposit" on a gambling page.
- [ ] Card contents: sleepy pet, "Let's take a breath.", the user's own reason as a quote, a 10 second breathing animation, a "Close this tab" button, and the helpline.
- [ ] "Continue anyway" is disabled during the 10 second countdown, then works.
- [ ] "Continue anyway" or Escape sets a 30 minute cooldown for that site so the overlay doesn't nag.
- [ ] Never trap the user. Escape always works.

**Done when:** driving health to zero shows the overlay, and every exit button works.

**Checkpoint at 6:00:** widget, popup, and overlay all work.

---

## Phase 4: Gemma voice, demo mode, polish (6:00 to 6:40)

### Step 10: Gemma writes the pet's lines (skip if short on time)
- [ ] Ask Gemma for one gentle sentence (20 words max, no emojis) when the stage changes, using the stage, site type, and the user's reason.
- [ ] Reject output that's too long or has the words "addict" or "loser". On any failure, use a hardcoded line.
- [ ] Only generate on stage changes, and cache the last line per stage.
- [ ] Show it in the widget and overlay.

**Done when:** forcing a stage change shows a Gemma-written line.

### Step 11: Demo mode and rescue panel
- [ ] In demo mode, 1 tick counts as 10 minutes, and recovery also runs 10 times faster. Gemma still runs for real.
- [ ] Show a visible "DEMO" tag on the widget and popup.
- [ ] Add a hidden developer panel (click the pet 5 times in the popup): set health to 90/60/30/10, reset today, clear the cache, simulate a gambling minute. Hidden in normal mode.

**Done when:** you can run the full pet life cycle in under 2 minutes.

### Step 12: Harden
- [ ] Never run on `chrome://`, `file://`, the Chrome Web Store, or localhost.
- [ ] Skip pages with under 200 characters of text. Re-check single-page apps when the URL changes.
- [ ] Safe-site allowlist that never triggers (espn.com, nfl.com, bbc.com, wikipedia.org, youtube.com, and similar).
- [ ] If Ollama is offline, show "Local AI is offline. Known sites still work." in the popup.
- [ ] State, badge, and widget stay correct after a browser restart.
- [ ] Hide debug logs behind a DEBUG flag.
- [ ] Update `README.md` with install steps and honest known issues.

**Done when:** a normal sports page stays quiet and nothing breaks when Ollama is off.

---

## Phase 5: Demo (6:40 to 7:00)

### Step 13: Demo script
- [ ] Write `DEMO.md`: 20 sec problem, 30 sec privacy angle (everything runs locally with open-weight Gemma), then live walkthrough, then 30 sec future work.
- [ ] Live walkthrough order: onboarding with a personal reason, known betting site (widget appears, health drops in demo mode), unknown gambling site only Gemma catches, ESPN stays quiet, pet falls asleep and overlay shows your reason, you leave and the pet recovers.
- [ ] Add a backup plan for Ollama or Wi-Fi failing.
- [ ] Rehearse once and **record a backup video**.

---

## The 5 things judges need to see

1. A known betting site shows the pet and health drops.
2. An unknown gambling-like site is caught by Gemma and cached.
3. A sports news page stays quiet.
4. The pet goes through 4 stages and recovers when you leave.
5. All of this shows in under 2 minutes with demo mode.

## If you fall behind, cut from the bottom
1. Skip Step 10 (Gemma pet lines) and keep hardcoded lines.
2. Simplify the overlay (drop the click-to-bet trigger, keep the asleep trigger).
3. Skip the hidden dev panel.

Protect steps 2, 3, 4, 7, and 9, because they make up the demo.

## Quick fixes

| Problem | Fix |
|---|---|
| Gemma call returns 403 | Quit the Ollama app, then run `OLLAMA_ORIGINS="chrome-extension://*" ollama serve` |
| Gemma call fails | Run `curl http://localhost:11434/api/tags` and make sure `gemma4:e2b` is listed |
| Health stops updating | You used `setInterval`. Use `chrome.alarms` |
| Pet drains while you're away | The idle check is missing |
| Widget looks broken on a site | Make sure it's in a Shadow DOM |
| Normal sports pages trigger | Add the domain to the allowlist and require confidence of 0.6 or more |
| Gemma returns messy JSON | Strip code fences, retry once, then fall back to keywords |

**If Claude Code goes off track:** tell it to stop, re-read `CLAUDE.md`, and redo only the current step.
