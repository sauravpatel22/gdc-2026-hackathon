import { fmtMinutes, parseDay } from "./format.js";

const W = 640;
const H = 240;
const PAD_L = 46;
const PAD_R = 8;
const PAD_TOP = 26;
const PAD_BOTTOM = 32;
const PLOT_W = W - PAD_L - PAD_R;
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

function niceStep(max, target) {
  const raw = max / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const f = raw / mag;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
}

function tickLabel(metric, v) {
  if (metric === "minutes") {
    if (v === 0) return "0";
    const h = Math.floor(v / 60);
    const m = Math.round(v % 60);
    return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
  }
  if (metric === "budget_pct") return `${v}%`;
  return String(v);
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
  // Minutes read best on 15 / 30 / 60 minute steps, everything else on a 1-2-5 scale.
  let step = niceStep(top || 1, 4);
  if (metric === "minutes") step = [5, 15, 30, 60, 120, 240, 480].find((x) => x >= (top || 1) / 4) || 480;
  if (metric === "sessions") step = Math.max(1, Math.ceil(step));
  const max = Math.max(step, Math.ceil((top * 1.05) / step) * step) || 1;
  const slot = PLOT_W / n;
  const barW = Math.min(slot * 0.62, 44);
  const baseY = PAD_TOP + PLOT_H;
  const hasSel = selectedIndex != null;
  const yOf = (v) => baseY - (v / max) * PLOT_H;

  let grid = "";
  for (let v = 0; v <= max + 1e-9; v += step) {
    const y = yOf(v).toFixed(1);
    grid += `<line class="${v === 0 ? "axis" : "grid"}" x1="${PAD_L}" x2="${W - PAD_R}" y1="${y}" y2="${y}"/>`;
    grid += `<text class="ylab" x="${PAD_L - 8}" y="${(+y + 4).toFixed(1)}" text-anchor="end">${tickLabel(metric, v)}</text>`;
  }

  let slots = "";
  let labels = "";
  let pin = "";

  points.forEach((p, i) => {
    const x0 = PAD_L + slot * i;
    const cx = x0 + slot / 2;
    const lab = xLabel(bucket, points, i);
    if (lab) labels += `<text class="xlab${i === selectedIndex ? " sel" : ""}" x="${cx.toFixed(1)}" y="${H - 10}" text-anchor="middle">${lab}</text>`;
    const v = vals[i];
    const band = `<rect class="band${i === selectedIndex ? " sel" : ""}" x="${x0.toFixed(1)}" y="${PAD_TOP - 6}" width="${slot.toFixed(1)}" height="${PLOT_H + 6}" rx="8"/>`;
    const hit = `<rect class="hit" aria-hidden="true" data-i="${i}" x="${x0.toFixed(1)}" y="${PAD_TOP - 6}" width="${slot.toFixed(1)}" height="${PLOT_H + 6}"/>`;
    let col = "";
    if (v != null) {
      const h = v > 0 ? Math.max(4, (v / max) * PLOT_H) : 2;
      const cls = ["col", p.over_limit ? "over" : "", v === 0 ? "zero" : "", i === selectedIndex ? "sel" : ""].filter(Boolean).join(" ");
      const aria = barAriaLabel(labelFor ? labelFor(p) : p.start, metric, p).replace(/"/g, "&quot;");
      const bx = cx - barW / 2;
      const by = baseY - h;
      const r = Math.min(barW / 2, 6, h);
      // Rounded top corners only, so bars sit flat on the axis.
      const d = `M${bx.toFixed(1)} ${baseY}V${(by + r).toFixed(1)}a${r} ${r} 0 0 1 ${r} ${-r}h${(barW - 2 * r).toFixed(1)}a${r} ${r} 0 0 1 ${r} ${r}V${baseY}z`;
      col = `<path class="${cls}" role="img" aria-label="${aria}" data-i="${i}" d="${d}"/>`;
      if (i === selectedIndex) {
        pin = `<text class="pin" x="${cx.toFixed(1)}" y="${(by - 8).toFixed(1)}" text-anchor="middle">${formatValue(metric, v)}</text>`;
      }
    }
    slots += `<g class="slot">${band}${col}${hit}</g>`;
  });

  let limit = "";
  if (lineVal != null) {
    const y = yOf(lineVal);
    const text = metric === "budget_pct" ? "limit" : `limit ${fmtMinutes(budget)}`;
    const tw = text.length * 6.2 + 14;
    limit += `<line class="limit" x1="${PAD_L}" x2="${W - PAD_R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke-dasharray="5 5"/>`;
    limit += `<rect class="limit-pill" x="${(PAD_L + 6).toFixed(1)}" y="${(y - 20).toFixed(1)}" width="${tw.toFixed(1)}" height="16" rx="8"/>`;
    limit += `<text class="limit-label" x="${(PAD_L + 6 + tw / 2).toFixed(1)}" y="${(y - 8.5).toFixed(1)}" text-anchor="middle">${text}</text>`;
  }

  svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svgEl.innerHTML =
    `${grid}<g class="bars${hasSel ? " has-sel" : ""}">${slots}</g>${limit}${pin}${labels}`;
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
