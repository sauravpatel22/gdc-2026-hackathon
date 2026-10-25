// Date and number helpers. All dates are local YYYY-MM-DD strings.

const pad = (n) => String(n).padStart(2, "0");

// Same logic as todayISO() in storage.js.
export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDay(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function isoDay(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(s, n) {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return isoDay(d);
}

// Clamps the day of month (Jan 31 + 1 month = Feb 28/29), like windows.add_months.
export function addMonths(s, n) {
  const d = parseDay(s);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return isoDay(d);
}

// Weeks start Monday.
export function mondayOf(s) {
  const d = parseDay(s);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return isoDay(d);
}

export function fmtMinutes(m) {
  if (m == null || !Number.isFinite(m)) return "–";
  const t = Math.round(m);
  if (t <= 0) return "0 min";
  const h = Math.floor(t / 60);
  const r = t % 60;
  if (!h) return `${r} min`;
  if (!r) return `${h} h`;
  return `${h} h ${r} min`;
}

const fmt = (opts) => new Intl.DateTimeFormat("en-US", opts);
const F = {
  monthDay: fmt({ month: "short", day: "numeric" }),
  monthDayYear: fmt({ month: "short", day: "numeric", year: "numeric" }),
  weekdayMonthDay: fmt({ weekday: "short", month: "short", day: "numeric" }),
  monthYearLong: fmt({ month: "long", year: "numeric" }),
  monthYear: fmt({ month: "short", year: "numeric" }),
};

export function hourLabel(h) {
  const x = ((h % 24) + 24) % 24;
  return `${x % 12 || 12} ${x < 12 ? "AM" : "PM"}`;
}

// "Sun, Oct 25", "Oct 19 – 25, 2026", "October 2026", ...
export function fmtRangeLabel(range, start, end) {
  const a = parseDay(start);
  const b = parseDay(end);
  if (range === "day") return F.weekdayMonthDay.format(a);
  if (range === "month") return F.monthYearLong.format(a);
  if (range === "year") return `${F.monthYear.format(a)} – ${F.monthYear.format(b)}`;
  if (range === "6months") return `${F.monthDayYear.format(a)} – ${F.monthDayYear.format(b)}`;
  if (a.getFullYear() !== b.getFullYear()) return `${F.monthDayYear.format(a)} – ${F.monthDayYear.format(b)}`;
  if (a.getMonth() !== b.getMonth()) return `${F.monthDay.format(a)} – ${F.monthDay.format(b)}, ${b.getFullYear()}`;
  return `${F.monthDay.format(a)} – ${b.getDate()}, ${b.getFullYear()}`;
}

// Label for one chart bucket: "2 PM – 3 PM", "Tue, Oct 21", "Oct 19 – 25", "October 2026".
export function fmtBucketLabel(bucket, p) {
  if (bucket === "hour") return `${hourLabel(p.hour)} – ${hourLabel(p.hour + 1)}`;
  const a = parseDay(p.start);
  if (bucket === "day") return F.weekdayMonthDay.format(a);
  if (bucket === "month") return F.monthYearLong.format(a);
  const b = parseDay(p.end);
  if (a.getMonth() === b.getMonth()) return `${F.monthDay.format(a)} – ${b.getDate()}`;
  return `${F.monthDay.format(a)} – ${F.monthDay.format(b)}`;
}
