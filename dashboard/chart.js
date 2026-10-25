import { fmtMinutes, parseDay } from "./format.js";

const W = 640;
const H = 240;
const PAD_X = 8;
const PAD_TOP = 18;
const PAD_BOTTOM = 34;
const PLOT_W = W - PAD_X * 2;
const PLOT_H = H - PAD_TOP - PAD_BOTTOM;

export const METRIC_NAMES = { minutes: "Time", budget_pct: "Limit used", score: "Score", sessions: "Sessions" };

export function formatValue(metric, v) {
  if (v == null) return "no data";
  if (metric === "minutes") return fmtMinutes(v);
  if (metric === "budget_pct") return `${Math.round(v)}%`;
  if (metric === "score") return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}

export function barAriaLabel(label, metric, p) {
  const v = p.values ? p.values[metric] : null;
  let text = `${label}: ${formatValue(metric, v)}`;
  if (v != null && (metric === "minutes" || metric === "budget_pct")) {
    text += p.over_limit ? ", over your limit" : ", under your limit";
  }
  return text;
}

function xLabel(bucket, points, i) {
  const p = points[i];
  if (bucket === "hour") return p.hour % 6 === 0 ? ["12a", "6a", "12p", "6p"][p.hour / 6] : "";
  const d = parseDay(p.start);
  if (bucket === "day") {
    if (points.length <= 7) return "MTWTFSS"[(d.getDay() + 6) % 7];
    return [1, 5, 10, 15, 20, 25, 30].includes(d.getDate()) ? String(d.getDate()) : "";
  }
  if (bucket === "week") {
    return d.getDate() <= 7 ? d.toLocaleDateString("en-US", { month: "short" }) : "";
  }
  return d.toLocaleDateString("en-US", { month: "narrow" });
}

// opts: { points, metric, budget, selectedIndex, bucket, labelFor(point) -> string }
export function renderBarChart(svgEl, { points, metric, budget, selectedIndex, bucket, labelFor }) {
  const n = points.length;
  const vals = points.map((p) => (p.values ? p.values[metric] : null));
  const lineVal = metric === "budget_pct" ? 100 : metric === "minutes" && bucket !== "hour" && budget > 0 ? budget : null;
  const top = Math.max(
    0,
    ...vals.filter((v) => v != null),
    lineVal || 0,
    metric === "score" ? 100 : 0,
  );
  const max = top * 1.1 || 1;
  const slot = PLOT_W / n;
  const barW = Math.min(slot * 0.68, 56);
  const baseY = PAD_TOP + PLOT_H;
  const hasSel = selectedIndex != null;

  let out = `<line class="axis" x1="${PAD_X}" x2="${W - PAD_X}" y1="${baseY}" y2="${baseY}"/>`;
  let bars = "";
  let hits = "";
  let labels = "";

  points.forEach((p, i) => {
    const cx = PAD_X + slot * i + slot / 2;
    const lab = xLabel(bucket, points, i);
    if (lab) labels += `<text class="xlab" x="${cx.toFixed(1)}" y="${H - 12}" text-anchor="middle">${lab}</text>`;
    const v = vals[i];
    if (v == null) return;
    const h = v > 0 ? Math.max(2, (v / max) * PLOT_H) : 1.5;
    const cls = ["col", p.over_limit ? "over" : "", v === 0 ? "zero" : "", i === selectedIndex ? "sel" : ""].filter(Boolean).join(" ");
    const aria = barAriaLabel(labelFor ? labelFor(p) : p.start, metric, p).replace(/"/g, "&quot;");
    bars += `<rect class="${cls}" role="img" aria-label="${aria}" data-i="${i}" x="${(cx - barW / 2).toFixed(1)}" y="${(baseY - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="3"/>`;
    hits += `<rect class="hit" aria-hidden="true" data-i="${i}" x="${(PAD_X + slot * i).toFixed(1)}" y="${PAD_TOP}" width="${slot.toFixed(1)}" height="${PLOT_H}"/>`;
  });

  if (lineVal != null) {
    const y = baseY - (lineVal / max) * PLOT_H;
    const text = metric === "budget_pct" ? "100%" : `daily limit ${fmtMinutes(budget)}`;
    out += `<line class="limit" x1="${PAD_X}" x2="${W - PAD_X}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke-dasharray="4 4"/>`;
    out += `<text class="limit-label" x="${W - PAD_X}" y="${(y - 5).toFixed(1)}" text-anchor="end">${text}</text>`;
  }

  svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svgEl.innerHTML = `${out}<g class="bars${hasSel ? " has-sel" : ""}">${bars}</g>${labels}${hits}`;
}

// Click and keyboard handling. api: { getPoints(), getSelected(), setSelected(i|null) }
export function attachChartInteraction(wrapEl, svgEl, api) {
  const valid = () => api.getPoints().map((p, i) => (p.values && p.values[api.metric()] != null ? i : -1)).filter((i) => i >= 0);

  svgEl.addEventListener("click", (e) => {
    const t = e.target.closest("[data-i]");
    if (!t) return;
    const i = Number(t.dataset.i);
    api.setSelected(api.getSelected() === i ? null : i);
  });

  wrapEl.addEventListener("keydown", (e) => {
    const ids = valid();
    if (!ids.length) return;
    const cur = api.getSelected();
    let next;
    if (e.key === "Escape") next = null;
    else if (e.key === "Home") next = ids[0];
    else if (e.key === "End") next = ids[ids.length - 1];
    else if (e.key === "Enter" || e.key === " ") next = cur == null ? ids[ids.length - 1] : null;
    else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      if (cur == null) next = ids[ids.length - 1];
      else {
        const pos = ids.indexOf(cur);
        const step = e.key === "ArrowLeft" ? -1 : 1;
        next = ids[Math.min(ids.length - 1, Math.max(0, pos + step))];
      }
    } else return;
    e.preventDefault();
    api.setSelected(next);
  });
}
