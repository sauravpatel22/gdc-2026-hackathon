const RANGE_NOUN = { day: "day", week: "week", month: "month", "6months": "6 months", year: "year" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

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
  const lines = [];

  if (hl.longest_break_days >= 1) {
    lines.push(`Your longest break: ${plural(hl.longest_break_days, "day")}.`);
  }
  if (hl.best_day) {
    lines.push(`Lightest day: ${bestDayLabel(hl.best_day.date, range)} (${Math.round(hl.best_day.minutes)} min).`);
  }
  if (hl.clean_days >= 1) {
    lines.push(`${plural(hl.clean_days, "gambling-free day")} this ${RANGE_NOUN[range] || "period"}.`);
  }
  if (hl.under_limit_days != null && summary.counted_days > 0) {
    lines.push(`You stayed under your limit on ${hl.under_limit_days} of ${summary.counted_days} days.`);
  }
  if (!lines.length) lines.push("Every day is a fresh start.");

  const title = document.createElement("h2");
  title.textContent = "Highlights";
  const list = document.createElement("ul");
  list.className = "highlights-list";
  for (const line of lines) {
    const li = document.createElement("li");
    li.textContent = line;
    list.append(li);
  }
  el.replaceChildren(title, list);
}
