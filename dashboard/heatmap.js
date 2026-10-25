const NS = "http://www.w3.org/2000/svg";
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const LABEL_W = 34;
const CELL_W = 24;
const CELL_H = 18;
const GAP = 2;
const TOP = 16;
const W = LABEL_W + 24 * CELL_W;
const H = TOP + 7 * CELL_H;

function hourLabel(h) {
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12} ${suffix}`;
}

function svg(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

function text(str, attrs) {
  const node = svg("text", attrs);
  node.textContent = str;
  return node;
}

export function renderHeatmap(el, heatmapResponse) {
  const cells = (heatmapResponse && heatmapResponse.cells) || [];
  const max = (heatmapResponse && heatmapResponse.max) || 0;

  const title = document.createElement("h2");
  title.textContent = "When you play";
  el.replaceChildren(title);

  if (!max) {
    const p = document.createElement("p");
    p.className = "card-empty";
    p.textContent = "No gambling time in this period. Nothing to show here.";
    el.append(p);
    return;
  }

  const root = svg("svg", {
    viewBox: `0 0 ${W} ${H}`,
    class: "heatmap-svg",
    role: "img",
    "aria-label": "Minutes by weekday and hour of day. Darker squares mean more time.",
  });

  for (const h of [0, 6, 12, 18]) {
    root.append(
      text(hourLabel(h), { x: LABEL_W + h * CELL_W, y: 10, class: "hm-label" })
    );
  }

  DAYS.forEach((day, r) => {
    const y = TOP + r * CELL_H;
    root.append(text(day, { x: 0, y: y + CELL_H / 2 + 4, class: "hm-label" }));
    for (let hr = 0; hr < 24; hr++) {
      const minutes = (cells[r] && cells[r][hr]) || 0;
      const rect = svg("rect", {
        x: LABEL_W + hr * CELL_W + GAP / 2,
        y: y + GAP / 2,
        width: CELL_W - GAP,
        height: CELL_H - GAP,
        rx: 3,
        class: minutes > 0 ? "hm-cell on" : "hm-cell",
      });
      if (minutes > 0) rect.setAttribute("fill-opacity", Math.max(0.15, minutes / max).toFixed(2));
      const tip = svg("title");
      tip.textContent = `${day} ${hourLabel(hr)}: ${Math.round(minutes)} min`;
      rect.append(tip);
      root.append(rect);
    }
  });

  el.append(root);

  if (heatmapResponse.partial) {
    const note = document.createElement("p");
    note.className = "card-note";
    note.textContent = "Based on the last 90 days.";
    el.append(note);
  }
}
