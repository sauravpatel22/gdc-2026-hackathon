import { get, setIncludeDemo, OfflineError } from "./api.js";
import { todayISO, addDays, addMonths, fmtMinutes, fmtRangeLabel, fmtBucketLabel } from "./format.js";
import { renderSites } from "./sites.js";
import { renderHeatmap } from "./heatmap.js";
import { renderHighlights } from "./highlights.js";
import { renderFooter } from "./footer.js";
import { setOfflineBanner, renderEmpty, clearEmpty, startOfflinePoll, startAutoRefresh } from "./states.js";
import { renderBarChart, attachChartInteraction, formatValue, METRIC_NAMES } from "./chart.js";

export const state = { range: "week", metric: "minutes", anchor: todayISO(), selected: null, includeDemo: false };
export const data = { summary: null, series: null, sites: null, score: null, heatmap: null, health: null, offline: false };

// Session G (and E's cards) hook in here: fn(data, state) runs at the end of every render().
const renderHooks = [];
export function onRender(fn) {
  renderHooks.push(fn);
}

const $ = (id) => document.getElementById(id);
const Pet = () => globalThis.Pause && globalThis.Pause.pet;

const HEADLINE = {
  happy: "Testudo is feeling great",
  tired: "Testudo is a little tired",
  sick: "Testudo isn't feeling so good",
  asleep: "Testudo is resting",
};
const MESSAGE = {
  happy: "Feeling great lately. Thanks for looking after us.",
  tired: "A little sleepy lately. A gentle week ahead would help.",
  sick: "Not my best lately. Could we take things slower together?",
  asleep: "Worn out lately. I'm here whenever you're ready.",
};

const BUCKET_OF = { day: "hour", week: "day", month: "day", "6months": "week", year: "month" };
const VS = { day: "yesterday", week: "last week", month: "last month", "6months": "the previous 6 months", year: "the year before" };
const LOWER_IS_BETTER = { minutes: true, budget_pct: true, sessions: true, score: false };

function bigLabel(metric, range) {
  if (metric === "minutes") {
    if (range === "day") return "Daily total";
    return range === "6months" || range === "year" ? "Average per day" : "Daily average";
  }
  return { budget_pct: "Average limit used", score: "Average day score", sessions: "Sessions per day" }[metric];
}

// ---- loading --------------------------------------------------------------

let loadSeq = 0;
let sitesSeq = 0;
let sitesTimer = null;

export async function load() {
  const seq = ++loadSeq;
  const q = { range: state.range, anchor: state.anchor };
  try {
    const [summary, series, sites, score, heatmap, health] = await Promise.all([
      get("/api/summary", q),
      get("/api/series", { ...q, metric: "minutes" }),
      get("/api/sites", q),
      get("/api/score"),
      get("/api/heatmap", q),
      get("/api/health"),
    ]);
    if (seq !== loadSeq) return;
    Object.assign(data, { summary, series, sites, score, heatmap, health, offline: false });
    const sel = state.selected;
    if (sel != null && !(series.points[sel] && series.points[sel].values[state.metric] != null)) state.selected = null;
    if (state.selected != null) refreshSites();
  } catch (err) {
    if (seq !== loadSeq) return;
    if (err instanceof OfflineError) data.offline = true;
    else console.error("[Testudo] load failed", err);
  }
  render();
}

function sitesParams() {
  const p = data.series && state.selected != null ? data.series.points[state.selected] : null;
  if (!p) return { range: state.range, anchor: state.anchor };
  if (p.hour != null) return { range: "day", anchor: p.start, hour: p.hour };
  return { range: state.range, anchor: state.anchor, start: p.start, end: p.end };
}

async function refreshSites() {
  const seq = ++sitesSeq;
  try {
    const sites = await get("/api/sites", sitesParams());
    if (seq !== sitesSeq) return;
    data.sites = sites;
    data.offline = false;
  } catch (err) {
    if (err instanceof OfflineError) data.offline = true;
    else console.error("[Testudo] sites failed", err);
  }
  render();
}

// ---- selection ------------------------------------------------------------

function selectedPoint() {
  return data.series && state.selected != null ? data.series.points[state.selected] : null;
}

function bucketLabel(p) {
  return fmtBucketLabel(BUCKET_OF[data.series ? data.series.range : state.range], p);
}

export function setSelected(i) {
  state.selected = i;
  render();
  const p = selectedPoint();
  $("live").textContent = p
    ? `${bucketLabel(p)}: ${formatValue(state.metric, p.values[state.metric])}${p.over_limit && (state.metric === "minutes" || state.metric === "budget_pct") ? ", over your limit" : ""}`
    : "Selection cleared";
  clearTimeout(sitesTimer);
  sitesTimer = setTimeout(refreshSites, 150);
}

// ---- rendering ------------------------------------------------------------

function renderHero() {
  const pet = Pet();
  const score = data.score ? data.score.score : 100;
  const info = pet ? pet.stageInfo(score) : { stage: "happy", color: "" };
  const el = $("pet");
  if (el.dataset.stage !== info.stage && pet) {
    el.innerHTML = pet.mascotSVG(info.stage);
    el.dataset.stage = info.stage;
  }
  el.classList.toggle("asleep", info.stage === "asleep");
  $("headline").textContent = HEADLINE[info.stage];
  $("message").textContent = MESSAGE[info.stage];
  $("score-num").textContent = Math.round(score);
  const fill = $("score-fill");
  fill.style.width = `${score}%`;
  fill.style.background = info.color;
  const streak = data.score ? data.score.streak : 0;
  $("streak").textContent = streak >= 1 ? `${streak} gambling-free day${streak === 1 ? "" : "s"} in a row` : "Every day is a fresh start.";
}

function renderControls() {
  const s = data.summary;
  document.querySelectorAll("#ranges button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === state.range)));
  $("metric").value = state.metric;
  $("range-label").textContent = s ? fmtRangeLabel(s.range, s.start, s.end) : "";
  $("prev").disabled = !(s && s.can_go_prev);
  $("next").disabled = !(s && s.can_go_next);
}

function renderBig() {
  const s = data.summary;
  const label = $("big-label");
  const value = $("big-value");
  const delta = $("big-delta");
  delta.hidden = true;
  if (!s) {
    label.textContent = "";
    value.textContent = "–";
    return;
  }
  const p = selectedPoint();
  if (p) {
    label.textContent = bucketLabel(p) + (data.series.per_day_average ? " · average per day" : "");
    value.textContent = formatValue(state.metric, p.values[state.metric]);
    return;
  }
  const m = s.metrics[state.metric];
  label.textContent = bigLabel(state.metric, s.range);
  const avg = state.metric === "minutes" && s.range === "day" ? m.total : m.average;
  value.textContent = avg == null ? "–" : formatValue(state.metric, avg);

  const pct = m.change_pct;
  if (pct == null) return;
  delta.hidden = false;
  delta.classList.remove("better");
  if (Math.abs(pct) < 1) {
    delta.textContent = `Same as ${VS[s.range]}`;
    return;
  }
  const better = LOWER_IS_BETTER[state.metric] ? pct < 0 : pct > 0;
  delta.classList.toggle("better", better);
  delta.textContent = `${pct < 0 ? "▼" : "▲"} ${Math.round(Math.abs(pct))}% ${pct < 0 ? "less" : "more"} than ${VS[s.range]}`;
}

function renderChart() {
  const s = data.series;
  const wrap = $("chart-wrap");
  const note = $("chart-note");
  if (!s) return;
  if (s.range === "day" && s.hourly_available === false) {
    wrap.hidden = true;
    note.hidden = false;
    note.textContent = `Hourly detail is kept for 90 days. Here's the day total: ${fmtMinutes(data.summary && data.summary.metrics.minutes.total)}`;
    return;
  }
  wrap.hidden = false;
  note.hidden = true;
  wrap.setAttribute("aria-label", `${METRIC_NAMES[state.metric]} by ${s.bucket}, use left and right arrows to pick a bar`);
  renderBarChart($("chart"), {
    points: s.points,
    metric: state.metric,
    budget: s.budget,
    selectedIndex: state.selected,
    bucket: s.bucket,
    labelFor: bucketLabel,
  });
}

function renderCards(d, st) {
  const empty = !!d.summary && d.summary.has_data === false;
  setOfflineBanner($("banner"), d.offline);
  if (d.offline) startOfflinePoll(async () => (await get("/api/health")).ok, () => load());
  for (const id of ["chart-card", "cards", "highlights"]) $(id).hidden = empty;
  if (empty) renderEmpty($("empty"));
  else clearEmpty($("empty"));
  renderModeSwitch(st.includeDemo);
  if (!d.summary) return;
  renderSites($("sites"), d.sites, { range: st.range });
  renderHeatmap($("heatmap"), d.heatmap);
  renderHighlights($("highlights"), d.summary);
  // the footer holds the armed-delete state, so draw it once per deployment
  const dep = d.health && d.health.deployment;
  if ($("footer").dataset.deployment !== String(dep)) {
    $("footer").dataset.deployment = String(dep);
    renderFooter($("footer"), d.health, { onDelete: deleteAll });
  }
}

// "My usage" (real tracking) vs "Sample history" (seeded demo data). Always visible.
const MODES = [["real", "My usage"], ["sample", "Sample history"]];
function renderModeSwitch(sample) {
  const el = $("demo-toggle");
  if (!el.firstChild) {
    el.setAttribute("role", "group");
    el.setAttribute("aria-label", "Data shown");
    el.classList.add("ranges");
    for (const [id, label] of MODES) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.mode = id;
      b.textContent = label;
      b.addEventListener("click", () => chooseMode(id === "sample"));
      el.append(b);
    }
  }
  for (const b of el.children) b.setAttribute("aria-pressed", String((b.dataset.mode === "sample") === sample));
}

async function chooseMode(sample) {
  if (sample === state.includeDemo) return;
  try {
    localStorage.setItem("testudo.mode", sample ? "sample" : "real");
  } catch {}
  if (sample && !(data.health && data.health.has_demo)) {
    // first time: ask the server to load the sample year
    try {
      const res = await fetch(`/api/demo/seed?today=${todayISO()}`, { method: "POST" });
      if (!res.ok) throw new Error(`seed returned ${res.status}`);
    } catch (err) {
      console.error("[Testudo] sample data failed", err);
      return;
    }
  }
  await setDemo(sample);
}

async function deleteAll() {
  const res = await fetch("/api/data?confirm=yes", { method: "DELETE" });
  if (!res.ok) throw new Error(`delete returned ${res.status}`);
  state.selected = null;
  await load();
}

export function render() {
  renderHero();
  renderControls();
  renderBig();
  renderChart();
  for (const fn of renderHooks) fn(data, state);
}

// ---- controls -------------------------------------------------------------

function shiftAnchor(dir) {
  const a = state.anchor;
  const next = {
    day: () => addDays(a, dir),
    week: () => addDays(a, 7 * dir),
    month: () => addMonths(a, dir),
    "6months": () => addDays(a, 182 * dir),
    year: () => addMonths(a, 12 * dir),
  }[state.range]();
  const today = todayISO();
  return next > today ? today : next;
}

export function setDemo(on) {
  state.includeDemo = !!on;
  setIncludeDemo(on);
  state.selected = null;
  return load();
}

function init() {
  $("ranges").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-range]");
    if (!b || b.dataset.range === state.range) return;
    state.range = b.dataset.range;
    state.selected = null;
    load();
  });
  for (const [id, dir] of [["prev", -1], ["next", 1]]) {
    $(id).addEventListener("click", () => {
      state.anchor = shiftAnchor(dir);
      state.selected = null;
      load();
    });
  }
  $("metric").addEventListener("change", (e) => {
    state.metric = e.target.value;
    render();
  });
  $("pet").addEventListener("click", () => {
    const open = $("explain").hidden;
    $("explain").hidden = !open;
    $("pet").setAttribute("aria-expanded", String(open));
  });
  attachChartInteraction($("chart-wrap"), $("chart"), {
    metric: () => state.metric,
    getPoints: () => (data.series ? data.series.points : []),
    getSelected: () => state.selected,
    setSelected,
  });
  onRender(renderCards);
  try {
    if (localStorage.getItem("testudo.mode") === "sample") {
      state.includeDemo = true;
      setIncludeDemo(true);
    }
  } catch {}
  render();
  load();
  startAutoRefresh(load);
}

init();
