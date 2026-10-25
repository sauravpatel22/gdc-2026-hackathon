"""Read-side queries for the dashboard. Plain SQL; callers pass the client's `today`."""
from datetime import date, timedelta

from . import config
from .scoring import day_score, stage_for
from .windows import buckets, prev_window, window

OVERALL_DAYS = 14
MAX_BONUS = 10


def _iso(d):
    return d.isoformat()


def _round(x):
    return None if x is None else round(x, 1)


def _mean(xs):
    return sum(xs) / len(xs) if xs else None


def budget_pct(minutes, budget):
    if budget <= 0:
        return 100.0 if minutes > 0 else 0.0
    return minutes / budget * 100.0


def _demo_filter(scope):
    return "(0)" if scope == "real" else "(0, 1)"


def local_hour(ts, tz_offset):
    """Local hour of day for an epoch-ms timestamp (plan section 0 #2)."""
    return int((ts // 60000 - tz_offset) // 60 % 24)


# ---------- daily rows ----------

def install_date(conn, user, scope):
    row = conn.execute(
        "SELECT MIN(date) AS d FROM daily WHERE user_id = ? AND scope = ?", (user, scope)
    ).fetchone()
    return date.fromisoformat(row["d"]) if row["d"] else None


def current_budget(conn, user, scope):
    row = conn.execute(
        "SELECT budget FROM daily WHERE user_id = ? AND scope = ? ORDER BY date DESC LIMIT 1",
        (user, scope),
    ).fetchone()
    return row["budget"] if row else config.DEFAULT_BUDGET


def day_rows(conn, user, scope, start, end, today):
    """One dict per date in [start, end]: date, counted, minutes, budget, score, sessions.

    A counted day has install_date <= d <= today. Counted days with no `daily` row are clean
    (0 min, score 100) and carry the latest known budget. Other days have None metrics.
    """
    install = install_date(conn, user, scope)
    rows = {
        r["date"]: r
        for r in conn.execute(
            "SELECT * FROM daily WHERE user_id = ? AND scope = ? AND date BETWEEN ? AND ?",
            (user, scope, _iso(start), _iso(end)),
        )
    }
    before = conn.execute(
        "SELECT budget FROM daily WHERE user_id = ? AND scope = ? AND date < ? "
        "ORDER BY date DESC LIMIT 1",
        (user, scope, _iso(start)),
    ).fetchone()
    first = conn.execute(
        "SELECT budget FROM daily WHERE user_id = ? AND scope = ? ORDER BY date LIMIT 1",
        (user, scope),
    ).fetchone()
    cur = before["budget"] if before else None
    fallback = first["budget"] if first else config.DEFAULT_BUDGET

    out = []
    d = start
    while d <= end:
        r = rows.get(_iso(d))
        if r:
            cur = r["budget"]
        budget = cur if cur is not None else fallback
        counted = install is not None and install <= d <= today
        if not counted:
            out.append({"date": d, "counted": False, "minutes": None, "budget": budget,
                        "score": None, "sessions": None})
        elif r:
            out.append({"date": d, "counted": True, "minutes": r["gambling_minutes"],
                        "budget": budget, "score": r["score"], "sessions": r["sessions"]})
        else:
            out.append({"date": d, "counted": True, "minutes": 0.0, "budget": budget,
                        "score": 100.0, "sessions": 0})
        d += timedelta(days=1)
    return out


def streaks(conn, user, scope, start, end, today):
    """{date: streak as of that date} for counted dates in [start, end] (plan 3.3)."""
    install = install_date(conn, user, scope)
    if install is None:
        return {}
    last = min(end, today)
    if last < install:
        return {}
    bf = conn.execute(
        "SELECT streak FROM backfill WHERE user_id = ? AND date = ?", (user, _iso(install))
    ).fetchone()
    run = bf["streak"] if bf else 0
    minutes = {
        r["date"]: r["gambling_minutes"]
        for r in conn.execute(
            "SELECT date, gambling_minutes FROM daily "
            "WHERE user_id = ? AND scope = ? AND date BETWEEN ? AND ?",
            (user, scope, _iso(install), _iso(last)),
        )
    }
    out = {}
    d = install
    while d <= last:
        if d >= start:
            out[d] = run
        # Moving past d: a clean day extends the run, anything else resets it.
        run = run + 1 if minutes.get(_iso(d), 0) == 0 else 0
        d += timedelta(days=1)
    return out


# ---------- scores ----------

def overall_score(day_scores_by_date, today, install, streak):
    """Mascot score (plan 3.4). day_scores_by_date maps date -> score for counted days."""
    if install is None:
        return 100.0
    num = den = 0.0
    for i in range(OVERALL_DAYS):
        d = today - timedelta(days=i)
        if d < install:
            continue
        w = OVERALL_DAYS - i
        num += w * day_scores_by_date.get(d, 100.0)
        den += w
    if den == 0:
        return 100.0
    return round(max(0.0, min(100.0, num / den + min(streak, MAX_BONUS))), 1)


def _overall(conn, user, scope, today):
    install = install_date(conn, user, scope)
    if install is None:
        return 100.0, 0, None
    rows = day_rows(conn, user, scope, today - timedelta(days=OVERALL_DAYS - 1), today, today)
    scores = {r["date"]: r["score"] for r in rows if r["counted"]}
    streak = streaks(conn, user, scope, today, today, today).get(today, 0)
    return overall_score(scores, today, install, streak), streak, install


def score(conn, user, scope, today):
    value, streak, install = _overall(conn, user, scope, today)
    return {
        "score": value,
        "stage": stage_for(value),
        "streak": streak,
        "install_date": _iso(install) if install else None,
        "has_data": install is not None,
    }


# ---------- hourly ----------

def _session_starts(events):
    """Yield (event, is_start) for time-ordered events; gap rule from SESSION_GAP_MS."""
    prev = None
    for e in events:
        yield e, prev is None or e["ts"] - prev > config.SESSION_GAP_MS
        prev = e["ts"]


def hourly_available(day, today):
    return day >= today - timedelta(days=config.RETENTION_DAYS)


def hourly(conn, user, scope, day):
    """24 dicts: minutes, cumulative (minutes by end of hour), health, sessions."""
    events = conn.execute(
        f"SELECT ts, minutes, health, tz_offset FROM events "
        f"WHERE user_id = ? AND date = ? AND demo IN {_demo_filter(scope)} ORDER BY ts",
        (user, _iso(day)),
    ).fetchall()
    minutes = [0.0] * 24
    sessions = [0] * 24
    health = [None] * 24
    for e, starts in _session_starts(events):
        h = local_hour(e["ts"], e["tz_offset"])
        minutes[h] += e["minutes"]
        health[h] = e["health"]
        if starts:
            sessions[h] += 1
    out, cum, last = [], 0.0, 100.0
    for h in range(24):
        cum += minutes[h]
        if health[h] is not None:
            last = health[h]
        out.append({"minutes": minutes[h], "cumulative": cum, "health": last,
                    "sessions": sessions[h]})
    return out


# ---------- series ----------

METRICS = ("minutes", "budget_pct", "score", "sessions", "streak")


def _null_values():
    return {m: None for m in METRICS}


def _bucket_values(days, streak_map):
    """Per-day-average values for a bucket's counted days (a single day gives its own values)."""
    if not days:
        return None, False
    mins = _mean([d["minutes"] for d in days])
    budget = _mean([d["budget"] for d in days])
    last = days[-1]["date"]
    values = {
        "minutes": mins,
        "budget_pct": _mean([budget_pct(d["minutes"], d["budget"]) for d in days]),
        "score": _mean([d["score"] for d in days]),
        "sessions": _mean([d["sessions"] for d in days]),
        "streak": streak_map.get(last),
    }
    return {k: _round(v) for k, v in values.items()}, mins > budget


def series(conn, user, scope, metric, range_, anchor, today):
    start, end = window(range_, anchor)
    rows = day_rows(conn, user, scope, start, end, today)
    streak_map = streaks(conn, user, scope, start, end, today)
    counted = [r for r in rows if r["counted"]]
    budget = counted[-1]["budget"] if counted else current_budget(conn, user, scope)
    points = []

    if range_ == "day":
        day_row = rows[0]
        avail = hourly_available(anchor, today)
        hrs = hourly(conn, user, scope, anchor) if day_row["counted"] and avail else None
        for h in range(24):
            if hrs is None:
                values, over = _null_values(), False
            else:
                x = hrs[h]
                values = {
                    "minutes": x["minutes"],
                    "budget_pct": budget_pct(x["cumulative"], day_row["budget"]),
                    "score": x["health"],
                    "sessions": x["sessions"],
                    "streak": streak_map.get(anchor),
                }
                values = {k: _round(v) for k, v in values.items()}
                over = x["cumulative"] > day_row["budget"]
            points.append({"start": _iso(anchor), "end": _iso(anchor), "hour": h,
                           "value": values[metric], "over_limit": over, "values": values})
        bucket, available = "hour", avail
    else:
        by_date = {r["date"]: r for r in rows}
        bucket = None
        for kind, b0, b1, _ in buckets(range_, start, end):
            bucket = kind
            days = [by_date[b0 + timedelta(days=i)] for i in range((b1 - b0).days + 1)
                    if b0 + timedelta(days=i) in by_date]
            days = [d for d in days if d["counted"]]
            values, over = _bucket_values(days, streak_map)
            values = values or _null_values()
            points.append({"start": _iso(b0), "end": _iso(b1), "hour": None,
                           "value": values[metric], "over_limit": bool(over), "values": values})
        available = True

    return {
        "metric": metric, "range": range_, "bucket": bucket,
        "per_day_average": range_ in ("6months", "year"),
        "hourly_available": available,
        "budget": budget, "points": points,
    }


# ---------- summary ----------

def _change_pct(avg, prev):
    if avg is None or prev is None or prev == 0:
        return None
    return round((avg - prev) / prev * 100, 1)


def _metric_block(rows, prev_rows, key, totals=False):
    def vals(rs):
        return [r[key] for r in rs if r["counted"]]

    avg, prev = _mean(vals(rows)), _mean(vals(prev_rows))
    out = {}
    if totals:
        out["total"] = _round(sum(vals(rows)))
    out.update(average=_round(avg), prev_average=_round(prev), change_pct=_change_pct(avg, prev))
    return out


def _with_pct(rows):
    return [dict(r, budget_pct=budget_pct(r["minutes"], r["budget"]) if r["counted"] else None)
            for r in rows]


def _highlights(rows):
    counted = [r for r in rows if r["counted"]]
    longest = run = 0
    for r in counted:
        run = run + 1 if r["minutes"] == 0 else 0
        longest = max(longest, run)
    played = [r for r in counted if r["minutes"] > 0]
    best = min(played, key=lambda r: (r["minutes"], -r["date"].toordinal()), default=None)
    return {
        "longest_break_days": longest,
        "best_day": {"date": _iso(best["date"]), "minutes": _round(best["minutes"])} if best else None,
        "clean_days": sum(1 for r in counted if r["minutes"] == 0),
        "under_limit_days": sum(1 for r in counted if r["minutes"] <= r["budget"]),
    }


def summary(conn, user, scope, range_, anchor, today):
    start, end = window(range_, anchor)
    ps, pe = prev_window(range_, anchor)
    install = install_date(conn, user, scope)
    rows = _with_pct(day_rows(conn, user, scope, start, end, today))
    prev_rows = _with_pct(day_rows(conn, user, scope, ps, pe, today))
    counted = [r for r in rows if r["counted"]]
    value, streak, _ = _overall(conn, user, scope, today)
    return {
        "range": range_, "start": _iso(start), "end": _iso(end),
        "prev_start": _iso(ps), "prev_end": _iso(pe),
        "counted_days": len(counted),
        "has_data": install is not None,
        "can_go_prev": install is not None and start > install,
        "can_go_next": end < today,
        "budget": counted[-1]["budget"] if counted else current_budget(conn, user, scope),
        "metrics": {
            "minutes": _metric_block(rows, prev_rows, "minutes", totals=True),
            "budget_pct": _metric_block(rows, prev_rows, "budget_pct"),
            "score": _metric_block(rows, prev_rows, "score"),
            "sessions": _metric_block(rows, prev_rows, "sessions", totals=True),
        },
        "streak": streak,
        "overall": {"score": value, "stage": stage_for(value)},
        "highlights": _highlights(rows),
    }


# ---------- sites ----------

SITE_LIMIT = 10


def _site_rows(conn, user, scope, start, end, day=None, hour=None):
    """[(hostname, minutes, sessions)] for the window, or one hour of one day from events."""
    if hour is None:
        rows = conn.execute(
            "SELECT hostname, SUM(minutes) AS minutes, SUM(sessions) AS sessions FROM daily_sites "
            "WHERE user_id = ? AND scope = ? AND date BETWEEN ? AND ? GROUP BY hostname",
            (user, scope, _iso(start), _iso(end)),
        ).fetchall()
        return [(r["hostname"], r["minutes"], r["sessions"]) for r in rows]
    events = conn.execute(
        f"SELECT ts, hostname, minutes, tz_offset FROM events "
        f"WHERE user_id = ? AND date = ? AND demo IN {_demo_filter(scope)} ORDER BY ts",
        (user, _iso(day)),
    ).fetchall()
    acc, last_ts = {}, {}
    for e in events:
        host = e["hostname"]
        starts = host not in last_ts or e["ts"] - last_ts[host] > config.SESSION_GAP_MS
        last_ts[host] = e["ts"]
        if local_hour(e["ts"], e["tz_offset"]) != hour:
            continue
        m, s = acc.get(host, (0.0, 0))
        acc[host] = (m + e["minutes"], s + (1 if starts else 0))
    return [(h, m, s) for h, (m, s) in acc.items()]


def sites(conn, user, scope, start, end, hour=None):
    rows = _site_rows(conn, user, scope, start, end, day=start, hour=hour)
    rows = [r for r in rows if r[1] > 0]
    rows.sort(key=lambda r: (-r[1], r[0]))
    total = sum(r[1] for r in rows)
    sources = {
        r["hostname"]: r["source"]
        for r in conn.execute("SELECT hostname, source FROM sites WHERE user_id = ?", (user,))
    }
    return {
        "total_minutes": _round(total) if rows else 0,
        "sites": [
            {"hostname": h, "minutes": _round(m), "share": round(m / total, 3), "sessions": s,
             "source": sources.get(h)}
            for h, m, s in rows[:SITE_LIMIT]
        ],
    }


# ---------- heatmap ----------

def heatmap(conn, user, scope, start, end, today):
    cells = [[0.0] * 24 for _ in range(7)]
    events = conn.execute(
        f"SELECT ts, date, minutes, tz_offset FROM events "
        f"WHERE user_id = ? AND date BETWEEN ? AND ? AND demo IN {_demo_filter(scope)}",
        (user, _iso(start), _iso(end)),
    )
    for e in events:
        weekday = date.fromisoformat(e["date"]).weekday()
        cells[weekday][local_hour(e["ts"], e["tz_offset"])] += e["minutes"]
    cells = [[round(v, 1) for v in row] for row in cells]
    return {
        "cells": cells,
        "max": max(max(row) for row in cells),
        "partial": start < today - timedelta(days=config.RETENTION_DAYS),
    }
