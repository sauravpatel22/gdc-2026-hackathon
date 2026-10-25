const RANGE_NOUN = { day: "day", week: "week", month: "month", "6months": "6 months", year: "year" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const svg = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const ICON = {
  break: svg('<path d="M20 14.500A8 8 0 1 1 9.500 4a6.500 6.500 0 0 0 10.500 10.500z"/>'),
  light: svg('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.600 5.600l1.400 1.400M17 17l1.400 1.400M5.600 18.400L7 17M17 7l1.400-1.400"/>'),
  free: svg('<path d="M5 12.500l4.500 4.500L19 7.500"/>'),
  limit: svg('<path d="M12 3l8 3v6c0 4.500-3.400 8-8 9-4.600-1-8-4.500-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
};

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function bestDayLabel(iso, range) {
  const [y, m, d] = iso.split("-").map(Number);
  if (range === "day" || range === "week" || range === "month") {
    return WEEKDAYS[new Date(y, m - 1, d).getDay()];
  }
  return `${MONTHS[m - 1]} ${d}`;
}

export function renderHighlights(el, summary) {
  const hl = (summary && summary.highlights) || {};
  const range = summary && summary.range;
  const lines = []; // [icon, bold figure, rest of the sentence, warm?]

  if (hl.longest_break_days >= 1) {
    lines.push(["break", plural(hl.longest_break_days, "day"), "longest break"]);
  }
  if (hl.best_day) {
    lines.push(["light", bestDayLabel(hl.best_day.date, range), `lightest day, just ${Math.round(hl.best_day.minutes)} min`, true]);
  }
  if (hl.clean_days >= 1) {
    lines.push(["free", plural(hl.clean_days, "gambling-free day"), `this ${RANGE_NOUN[range] || "period"}`]);
  }
  if (hl.under_limit_days != null && summary.counted_days > 0) {
    lines.push(["limit", `${hl.under_limit_days} of ${summary.counted_days} days`, "under your limit"]);
  }
  if (!lines.length) lines.push(["free", "Every day", "is a fresh start"]);

  const title = document.createElement("h2");
  title.textContent = "Highlights";
  const list = document.createElement("ul");
  list.className = "highlights-list";
  for (const [icon, figure, rest, warm] of lines) {
    const li = document.createElement("li");
    li.className = warm ? "hl warm" : "hl";
    const chip = document.createElement("span");
    chip.className = warm ? "hl-icon warm" : "hl-icon";
    chip.innerHTML = ICON[icon];
    const strong = document.createElement("strong");
    strong.textContent = figure;
    li.append(chip, strong, ` ${rest}`);
    list.append(li);
  }
  el.replaceChildren(title, list);
}
