import { fmtMinutes } from "./format.js";

const EMPTY = "No gambling sites in this period. That's worth celebrating.";

function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") node.className = v;
    else node.setAttribute(k, v);
  }
  for (const kid of kids) node.append(kid);
  return node;
}

export function renderSites(el, sitesResponse, { range } = {}) {
  const sites = (sitesResponse && sitesResponse.sites) || [];
  el.replaceChildren(h("h2", {}, "Most visited"));
  if (range) el.dataset.range = range;

  if (!sites.length) {
    el.append(h("p", { class: "card-empty" }, EMPTY));
    return;
  }

  const list = h("ol", { class: "sites-list" });
  sites.forEach((s, i) => {
    const pct = Math.max(0, Math.min(1, s.share || 0));
    const bar = h("span", { class: "site-bar" });
    bar.style.width = `${(pct * 100).toFixed(1)}%`;
    list.append(
      h(
        "li",
        { class: "site-row" },
        h("span", { class: "site-rank", "aria-hidden": "true" }, String(i + 1)),
        h(
          "span",
          { class: "site-main" },
          h(
            "span",
            { class: "site-line" },
            h("span", { class: "site-host" }, s.hostname),
            h("span", { class: "site-min" }, fmtMinutes(s.minutes))
          ),
          h("span", { class: "site-track", role: "presentation" }, bar)
        )
      )
    );
  });
  el.append(list);
}
