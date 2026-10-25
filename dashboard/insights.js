import { get } from "./api.js";

const SLOW_MS = 120000; // a local model can take a while on first run

// What we last drew, so auto-refresh and re-renders don't re-ask Gemma.
let shownKey = null;
let seq = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const ICONS = ["🌱", "🔎", "💡"];

function header(onRefresh) {
  const row = el("div", "insights-head");
  const title = el("div", "insights-title");
  title.append(el("span", "insights-spark", "✨"), el("h2", null, "Insights for you"));
  row.append(title, el("span", "insights-badge", "Written by Gemma · private, on your device"));
  if (onRefresh) {
    const btn = el("button", "insights-refresh", "Refresh");
    btn.type = "button";
    btn.addEventListener("click", onRefresh);
    row.append(btn);
  }
  return row;
}

function busy() {
  const wrap = el("div", "insights-busy");
  wrap.append(el("p", null, "Gemma is reading your numbers…"));
  const row = el("div", "insights-skeletons");
  for (let i = 0; i < 3; i++) row.append(el("span", "skeleton"));
  wrap.append(row);
  return wrap;
}

function note(text, extra) {
  const p = el("p", "card-empty", text);
  if (extra) p.append(" ", extra);
  return p;
}

function drawList(root, list, onRefresh) {
  const ul = el("ul", "insights-list");
  list.forEach((item, i) => {
    const li = el("li", "insight");
    li.append(el("span", "insight-icon", ICONS[i % ICONS.length]), el("strong", null, item.title), el("p", null, item.body));
    ul.append(li);
  });
  root.replaceChildren(header(onRefresh), ul);
}

export function renderInsights(root, { range, anchor, includeDemo }) {
  const key = `${range}|${anchor}|${includeDemo}`;
  if (key === shownKey) return;
  shownKey = key;
  load(root, { range, anchor, include_demo: includeDemo ? 1 : 0 }, key, false);
}

async function load(root, params, key, refresh) {
  const mine = ++seq;
  const again = () => load(root, params, key, true);
  root.replaceChildren(header(), busy());
  root.setAttribute("aria-busy", "true");
  try {
    const res = await get("/api/insights", { ...params, refresh: refresh ? 1 : 0 }, { timeoutMs: SLOW_MS });
    if (mine !== seq) return;
    if (res.status === "ok") return drawList(root, res.insights, again);
    if (res.status === "no_data") {
      root.replaceChildren(header(), note("Insights will show up once there's some history to look at."));
    } else {
      const code = el("code", null, `ollama run ${res.model}`);
      const retry = el("button", "insights-refresh", "Try again");
      retry.type = "button";
      retry.addEventListener("click", again);
      root.replaceChildren(header(), note("Gemma isn't available right now. Start it with", code), retry);
    }
  } catch {
    if (mine !== seq) return;
    shownKey = null; // let the next render try again
    root.replaceChildren(header(), note("Couldn't load insights right now."));
  } finally {
    if (mine === seq) root.removeAttribute("aria-busy");
  }
}
