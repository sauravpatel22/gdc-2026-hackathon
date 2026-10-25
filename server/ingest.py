from datetime import date as _date, timedelta

from .config import RETENTION_DAYS, SESSION_GAP_MS
from .models import BackfillEvent, TickEvent
from .scoring import day_score

SCOPES = ("real", "all")


def _demo_values(scope):
    return (0,) if scope == "real" else (0, 1)


def recompute_day(conn, user_id, date, scope):
    demos = _demo_values(scope)
    marks = ",".join("?" * len(demos))
    events = conn.execute(
        f"SELECT minutes, health, budget FROM events "
        f"WHERE user_id = ? AND date = ? AND demo IN ({marks}) ORDER BY ts",
        (user_id, date, *demos),
    ).fetchall()
    b = conn.execute(
        "SELECT minutes, budget, health, demo FROM backfill WHERE user_id = ? AND date = ?",
        (user_id, date),
    ).fetchone()
    if b is not None and scope == "real" and b["demo"] == 1:
        b = None

    key = (user_id, scope, date)
    if not events and b is None:
        conn.execute("DELETE FROM daily WHERE user_id = ? AND scope = ? AND date = ?", key)
        conn.execute("DELETE FROM daily_sites WHERE user_id = ? AND scope = ? AND date = ?", key)
        return

    minutes = sum(e["minutes"] for e in events) + (b["minutes"] if b else 0)
    budget = events[-1]["budget"] if events else b["budget"]
    healths = [e["health"] for e in events] + ([b["health"]] if b else [])
    end_health = events[-1]["health"] if events else b["health"]

    session_row = conn.execute(
        f"SELECT COUNT(*) FROM ("
        f"  SELECT ts - LAG(ts) OVER (ORDER BY ts) AS gap "
        f"  FROM events WHERE user_id = ? AND date = ? AND demo IN ({marks})"
        f") WHERE gap IS NULL OR gap > ?",
        (user_id, date, *demos, SESSION_GAP_MS),
    ).fetchone()
    sessions = session_row[0] + (1 if b and b["minutes"] > 0 else 0)

    conn.execute(
        "INSERT OR REPLACE INTO daily "
        "(user_id, scope, date, gambling_minutes, budget, min_health, end_health, score, sessions) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, scope, date, minutes, budget, min(healths), end_health,
         day_score(minutes, budget), sessions),
    )

    conn.execute("DELETE FROM daily_sites WHERE user_id = ? AND scope = ? AND date = ?", key)
    conn.execute(
        f"INSERT INTO daily_sites (user_id, scope, date, hostname, minutes, sessions) "
        f"SELECT ?, ?, ?, hostname, SUM(minutes), SUM(starts) FROM ("
        f"  SELECT hostname, minutes, "
        f"    CASE WHEN ts - LAG(ts) OVER (PARTITION BY hostname ORDER BY ts) IS NULL "
        f"      OR ts - LAG(ts) OVER (PARTITION BY hostname ORDER BY ts) > ? THEN 1 ELSE 0 END AS starts "
        f"  FROM events WHERE user_id = ? AND date = ? AND demo IN ({marks})"
        f") GROUP BY hostname",
        (user_id, scope, date, SESSION_GAP_MS, user_id, date, *demos),
    )


def ingest(conn, items, today, enforce_retention=True):
    """Store a batch in one transaction. `today` is a date or YYYY-MM-DD string."""
    if isinstance(today, str):
        today = _date.fromisoformat(today)
    cutoff = (today - timedelta(days=RETENTION_DAYS)).isoformat()

    accepted = 0
    ignored = 0
    backfill_result = None
    affected = set()

    try:
        ticks = []
        for it in items:
            if isinstance(it, TickEvent):
                if enforce_retention and it.date < cutoff:
                    ignored += 1
                else:
                    ticks.append(it)

        # Backfills first, so a tick's recompute sees the snapshot.
        for it in items:
            if not isinstance(it, BackfillEvent):
                continue
            exists = conn.execute(
                "SELECT 1 FROM backfill WHERE user_id = ? AND date = ? "
                "UNION ALL SELECT 1 FROM daily WHERE user_id = ? AND date = ? LIMIT 1",
                (it.user_id, it.date, it.user_id, it.date),
            ).fetchone()
            if exists:
                backfill_result = backfill_result or "ignored"
                continue
            conn.execute(
                "INSERT INTO backfill (user_id, date, ts, minutes, streak, budget, health, demo) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (it.user_id, it.date, it.ts, it.minutes, it.streak, it.budget, it.health, int(it.demo)),
            )
            backfill_result = "stored"
            affected.add((it.user_id, it.date))

        for it in ticks:
            cur = conn.execute(
                "INSERT OR IGNORE INTO events "
                "(user_id, ts, date, hostname, minutes, health, budget, source, demo, tz_offset) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (it.user_id, it.ts, it.date, it.hostname, it.minutes, it.health, it.budget,
                 it.source, int(it.demo), it.tz_offset),
            )
            if cur.rowcount:
                accepted += 1
            else:
                ignored += 1
            conn.execute(
                "INSERT INTO sites (user_id, hostname, source, first_seen, last_seen) "
                "VALUES (?, ?, ?, ?, ?) "
                "ON CONFLICT (user_id, hostname) DO UPDATE SET "
                "first_seen = MIN(sites.first_seen, excluded.first_seen), "
                "last_seen = MAX(sites.last_seen, excluded.last_seen), "
                "source = COALESCE(excluded.source, sites.source)",
                (it.user_id, it.hostname, it.source, it.ts, it.ts),
            )
            affected.add((it.user_id, it.date))

        for user_id, date in sorted(affected):
            for scope in SCOPES:
                recompute_day(conn, user_id, date, scope)
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    return {"ok": True, "accepted": accepted, "ignored": ignored, "backfill": backfill_result}
