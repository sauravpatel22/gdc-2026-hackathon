const OFFLINE_POLL_MS = 10000;

export function setOfflineBanner(el, isOffline) {
  el.hidden = !isOffline;
  if (!isOffline) {
    el.replaceChildren();
    return;
  }
  if (el.childElementCount) return;
  const code = (s) => {
    const c = document.createElement("code");
    c.textContent = s;
    return c;
  };
  el.setAttribute("role", "status");
  el.classList.add("banner");
  el.replaceChildren(
    "Can't reach the Testudo server. Start it with ",
    code("uvicorn server.app:app"),
    " (or ",
    code("docker compose up -d"),
    ")."
  );
}

export function renderEmpty(el) {
  el.hidden = false;
  el.classList.add("empty-card");
  el.textContent = "Nothing here yet. That's okay. Testudo will fill this in as you browse.";
}

export function clearEmpty(el) {
  el.hidden = true;
  el.replaceChildren();
}

// checkFn: async () => true when /api/health answers. Returns a stop function.
let stopPoll = null;
export function startOfflinePoll(checkFn, onBack) {
  if (stopPoll) return stopPoll;
  let busy = false;
  const stop = () => {
    clearInterval(id);
    stopPoll = null;
  };
  const id = setInterval(async () => {
    if (busy) return;
    busy = true;
    let ok = false;
    try {
      ok = !!(await checkFn());
    } catch {
      ok = false;
    }
    busy = false;
    if (ok && stopPoll === stop) {
      stop();
      onBack();
    }
  }, OFFLINE_POLL_MS);
  stopPoll = stop;
  return stop;
}

export function startAutoRefresh(loadFn, ms = 5000) {
  let busy = false;
  let last = Date.now();
  const run = async () => {
    if (busy || document.visibilityState !== "visible") return;
    busy = true;
    last = Date.now();
    try {
      await loadFn();
    } catch {
      // load() reports its own errors; keep the timer alive
    }
    busy = false;
  };
  const id = setInterval(run, ms);
  const onVisible = () => {
    if (document.visibilityState === "visible" && Date.now() - last >= ms) run();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    clearInterval(id);
    document.removeEventListener("visibilitychange", onVisible);
  };
}

export function renderDemoToggle(el, hasDemo, onChange) {
  el.hidden = !hasDemo;
  if (!hasDemo) return;
  if (el.querySelector("input")) return;
  const label = document.createElement("label");
  label.className = "demo-toggle";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.addEventListener("change", () => onChange(box.checked));
  label.append(box, " Include demo data");
  el.replaceChildren(label);
}
