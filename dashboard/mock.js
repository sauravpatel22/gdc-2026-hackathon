// Fixtures shaped like DASHBOARD-PLAN.md section 2. Used only when the URL has ?mock=1.
import { parseDay, addDays, addMonths, mondayOf } from "./format.js";

const HOSTS = ["stake.com", "draftkings.com", "fanduel.com", "polymarket.com", "betmgm.com"];
const round1 = (n) => Math.round(n * 10) / 10;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

function rnd(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

const weekday = (date) => (parseDay(date).getDay() + 6) % 7; // Monday = 0
const installOf = (today) => addDays(today, -200);

function budgetOn(date, today) {
  return date >= addDays(today, -120) ? 120 : 90;
}

function minutesOn(date) {
  const cleanP = weekday(date) >= 4 ? 0.15 : 0.4;
  if (rnd("c" + date) < cleanP) return 0;
  return Math.round(8 + rnd("m" + date) * 170);
}

function dayInfo(date, today) {
  const counted = date >= installOf(today) && date <= today;
  if (!counted) return { date, counted: false };
  const minutes = minutesOn(date);
  const budget = budgetOn(date, today);
  return {
    date,
    counted: true,
    minutes,
    budget,
    score: clamp(100 - (minutes / budget) * 100, 0, 100),
    sessions: minutes === 0 ? 0 : 1 + Math.floor(rnd("s" + date) * 4),
  };
}

function streakAsOf(date, today) {
  const install = installOf(today);
  let n = 0;
  for (let d = addDays(date, -1); d >= install; d = addDays(d, -1)) {
    if (dayInfo(d, today).minutes !== 0) return n;
    n++;
  }
  return n;
}

function eachDay(start, end) {
  const out = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

// ---- windows --------------------------------------------------------------

function monthStart(s) {
  return s.slice(0, 8) + "01";
}
function monthEnd(s) {
  return addDays(addMonths(monthStart(s), 1), -1);
}

function windowOf(range, a) {
  if (range === "day") return [a, a];
  if (range === "week") return [mondayOf(a), addDays(mondayOf(a), 6)];
  if (range === "month") return [monthStart(a), monthEnd(a)];
  if (range === "6months") return [addDays(mondayOf(a), -25 * 7), addDays(mondayOf(a), 6)];
  return [addMonths(monthStart(a), -11), monthEnd(a)];
}

function prevWindowOf(range, a) {
  const [s] = windowOf(range, a);
  if (range === "day") return [addDays(a, -1), addDays(a, -1)];
  if (range === "week") return [addDays(s, -7), addDays(s, -1)];
  if (range === "month") return windowOf("month", addDays(s, -1));
  if (range === "6months") return [addDays(s, -182), addDays(s, -1)];
  return [addMonths(s, -12), addDays(s, -1)];
}

function bucketsOf(range, start, end) {
  if (range === "day") return Array.from({ length: 24 }, (_, h) => ({ start, end, hour: h }));
  if (range === "week" || range === "month") return eachDay(start, end).map((d) => ({ start: d, end: d, hour: null }));
  if (range === "6months") {
    return Array.from({ length: 26 }, (_, i) => ({ start: addDays(start, i * 7), end: addDays(start, i * 7 + 6), hour: null }));
  }
  return Array.from({ length: 12 }, (_, i) => {
    const s = addMonths(start, i);
    return { start: s, end: monthEnd(s), hour: null };
  });
}

// ---- metrics --------------------------------------------------------------

function hourlyMinutes(date, total) {
  const w = Array.from({ length: 24 }, (_, h) => (h >= 18 ? 5 : h >= 12 ? 2 : 0.4) * (0.4 + rnd(date + "h" + h)));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => (total * x) / sum);
}

function valuesFor(days, today, lastDate) {
  const c = days.filter((d) => d.counted);
  if (!c.length) return null;
  const minutes = mean(c.map((d) => d.minutes));
  const budget = c[c.length - 1].budget;
  return {
    minutes: round1(minutes),
    budget_pct: round1(mean(c.map((d) => (d.budget ? (d.minutes / d.budget) * 100 : d.minutes > 0 ? 100 : 0)))),
    score: round1(mean(c.map((d) => d.score))),
    sessions: round1(mean(c.map((d) => d.sessions))),
    streak: streakAsOf(lastDate || c[c.length - 1].date, today),
    over: minutes > budget,
  };
}

function nullValues() {
  return { minutes: null, budget_pct: null, score: null, sessions: null, streak: null };
}

function series(p, today) {
  const range = p.range || "week";
  const anchor = p.anchor > today ? today : p.anchor || today;
  const [start, end] = windowOf(range, anchor);
  const bucket = { day: "hour", week: "day", month: "day", "6months": "week", year: "month" }[range];
  const perDay = range === "6months" || range === "year";
  const hourlyAvailable = range !== "day" || anchor >= addDays(today, -90);
  let points;

  if (range === "day") {
    const info = dayInfo(anchor, today);
    const per = info.counted ? hourlyMinutes(anchor, info.minutes) : null;
    let cum = 0;
    let cumScore = 100;
    points = bucketsOf(range, start, end).map((b) => {
      if (!per) return { ...b, value: null, over_limit: false, values: nullValues() };
      cum += per[b.hour];
      cumScore = clamp(100 - (cum / info.budget) * 100, 0, 100);
      const sessions = per[b.hour] > 3 && rnd(anchor + "x" + b.hour) > 0.5 ? 1 : 0;
      const values = {
        minutes: round1(per[b.hour]),
        budget_pct: round1((cum / info.budget) * 100),
        score: round1(cumScore),
        sessions,
        streak: streakAsOf(anchor, today),
      };
      return { ...b, values, value: values[p.metric || "minutes"], over_limit: cum > info.budget };
    });
  } else {
    points = bucketsOf(range, start, end).map((b) => {
      const days = eachDay(b.start, b.end).map((d) => dayInfo(d, today));
      const v = valuesFor(days, today);
      if (!v) return { ...b, value: null, over_limit: false, values: nullValues() };
      const { over, ...values } = v;
      return { ...b, values, value: values[p.metric || "minutes"], over_limit: over };
    });
  }

  const budget = dayInfo(anchor, today).budget || budgetOn(anchor, today);
  return { metric: p.metric || "minutes", range, bucket, per_day_average: perDay, hourly_available: hourlyAvailable, budget, points };
}

function stats(days) {
  const c = days.filter((d) => d.counted);
  if (!c.length) return null;
  return {
    minutes_total: c.reduce((a, d) => a + d.minutes, 0),
    minutes: mean(c.map((d) => d.minutes)),
    budget_pct: mean(c.map((d) => (d.budget ? (d.minutes / d.budget) * 100 : d.minutes > 0 ? 100 : 0))),
    score: mean(c.map((d) => d.score)),
    sessions_total: c.reduce((a, d) => a + d.sessions, 0),
    sessions: mean(c.map((d) => d.sessions)),
  };
}

function change(avg, prev) {
  if (avg == null || prev == null || prev === 0) return null;
  return round1(((avg - prev) / prev) * 100);
}

function summary(p, today) {
  const range = p.range || "week";
  const anchor = p.anchor > today ? today : p.anchor || today;
  const [start, end] = windowOf(range, anchor);
  const [ps, pe] = prevWindowOf(range, anchor);
  const days = eachDay(start, end).map((d) => dayInfo(d, today));
  const prev = stats(eachDay(ps, pe).map((d) => dayInfo(d, today)));
  const cur = stats(days);
  const counted = days.filter((d) => d.counted);
  const install = installOf(today);

  const metric = (key, extra = {}) => ({
    ...extra,
    average: cur ? round1(cur[key]) : null,
    prev_average: prev ? round1(prev[key]) : null,
    change_pct: cur && prev ? change(cur[key], prev[key]) : null,
  });

  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.counted && d.minutes === 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const lit = counted.filter((d) => d.minutes > 0);
  const best = lit.reduce((b, d) => (!b || d.minutes <= b.minutes ? d : b), null);
  const overall = score(p, today);

  return {
    range, start, end, prev_start: ps, prev_end: pe,
    counted_days: counted.length,
    has_data: counted.length > 0,
    can_go_prev: start > install,
    can_go_next: end < today,
    budget: budgetOn(anchor, today),
    metrics: {
      minutes: metric("minutes", { total: cur ? cur.minutes_total : null }),
      budget_pct: metric("budget_pct"),
      score: metric("score"),
      sessions: metric("sessions", { total: cur ? cur.sessions_total : null }),
    },
    streak: overall.streak,
    overall: { score: overall.score, stage: overall.stage },
    highlights: {
      longest_break_days: longest,
      best_day: best ? { date: best.date, minutes: best.minutes } : null,
      clean_days: counted.filter((d) => d.minutes === 0).length,
      under_limit_days: counted.filter((d) => d.minutes <= d.budget).length,
    },
  };
}

function stageFor(s) {
  return s >= 80 ? "happy" : s >= 50 ? "tired" : s >= 20 ? "sick" : "asleep";
}

function score(p, today) {
  const install = installOf(today);
  let num = 0;
  let den = 0;
  for (let i = 0; i < 14; i++) {
    const d = addDays(today, -i);
    if (d < install) continue;
    num += (14 - i) * dayInfo(d, today).score;
    den += 14 - i;
  }
  const streak = streakAsOf(today, today);
  const overall = round1(clamp(num / den + Math.min(streak, 10), 0, 100));
  return { score: overall, stage: stageFor(overall), streak, install_date: install, has_data: true };
}

function sites(p, today) {
  const range = p.range || "week";
  const anchor = p.anchor > today ? today : p.anchor || today;
  const [start, end] = p.start && p.end ? [p.start, p.end] : windowOf(range, anchor);
  const hourFrac = p.hour != null ? (d) => {
    const per = hourlyMinutes(d.date, d.minutes);
    return per[Number(p.hour)] / (d.minutes || 1);
  } : () => 1;
  const totals = new Map();
  for (const date of eachDay(start, end)) {
    const d = dayInfo(date, today);
    if (!d.counted || !d.minutes) continue;
    const weights = HOSTS.map((h) => rnd(date + h) ** 2);
    const sum = weights.reduce((a, b) => a + b, 0);
    HOSTS.forEach((h, i) => {
      const m = ((d.minutes * weights[i]) / sum) * hourFrac(d);
      const t = totals.get(h) || { minutes: 0, sessions: 0 };
      t.minutes += m;
      t.sessions += m > 1 ? 1 : 0;
      totals.set(h, t);
    });
  }
  const total = [...totals.values()].reduce((a, t) => a + t.minutes, 0);
  const rows = [...totals.entries()]
    .filter(([, t]) => t.minutes >= 0.5)
    .sort((a, b) => b[1].minutes - a[1].minutes || (a[0] < b[0] ? -1 : 1))
    .slice(0, 10)
    .map(([hostname, t]) => ({
      hostname,
      minutes: Math.round(t.minutes),
      share: total ? round1(t.minutes / total) : 0,
      sessions: t.sessions,
      source: "domain",
    }));
  return { total_minutes: Math.round(total), sites: rows };
}

function heatmap(p, today) {
  const range = p.range || "week";
  const anchor = p.anchor > today ? today : p.anchor || today;
  const [start, end] = windowOf(range, anchor);
  const cutoff = addDays(today, -90);
  const cells = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const date of eachDay(start < cutoff ? cutoff : start, end > today ? today : end)) {
    const d = dayInfo(date, today);
    if (!d.counted || !d.minutes) continue;
    hourlyMinutes(date, d.minutes).forEach((m, h) => { cells[weekday(date)][h] += m; });
  }
  const rounded = cells.map((row) => row.map(round1));
  return { cells: rounded, max: Math.max(0, ...rounded.flat()), partial: start < cutoff };
}

export function handle(path, p) {
  const today = p.today;
  const routes = {
    "/api/summary": () => summary(p, today),
    "/api/series": () => series(p, today),
    "/api/sites": () => sites(p, today),
    "/api/score": () => score(p, today),
    "/api/insights": () => ({ status: "ok", model: "gemma4:e2b", insights: [
      { title: "Steady progress", body: "You stayed under your limit on most days. That adds up." },
      { title: "Evenings stand out", body: "Most of your time lands after 6 PM. A short walk then could help." },
      { title: "One small idea", body: "Try a 10-minute pause before opening your top site." },
    ] }),
    "/api/health": () => ({ ok: true, deployment: "local", has_demo: true, schema: 1 }),
  };
  const fn = routes[path];
  if (!fn) return Promise.reject(new Error(`mock: no route ${path}`));
  return new Promise((resolve) => setTimeout(() => resolve(fn()), 60));
}
