"""Fake history for demos: python -m server.seed --days 365 [--reset] [--seed 42] [--demo-days 0] [--as-real]

By default the history is flagged as sample data (demo = 1), so the dashboard keeps it apart from real usage."""
import argparse
import random
from datetime import date, datetime, timedelta

from . import db
from .ingest import ingest
from .models import BackfillEvent, TickEvent
from .routes_data import USER_ID, delete_user_data
from .scoring import day_score

HOSTS = ["stake.com", "draftkings.com", "fanduel.com", "polymarket.com", "betmgm.com"]
HOUR_WEIGHTS = {h: (6 if h >= 18 else 1) for h in range(24)}
BUDGET = 120
BUDGET_CHANGE_DAYS_AGO = 120
BUDGET_AFTER_CHANGE = 60


def _has_data(conn):
    return any(
        conn.execute(f"SELECT 1 FROM {t} LIMIT 1").fetchone()
        for t in ("events", "backfill", "daily")
    )


def _ts_and_offset(day, hour, minute, second=0):
    local = datetime(day.year, day.month, day.day, hour, minute, second).astimezone()
    return int(local.timestamp() * 1000), int(-local.utcoffset().total_seconds() // 60)


def _tick(day, hour, minute, host, minutes_so_far, budget, demo=False, second=0):
    ts, tz = _ts_and_offset(day, hour, minute, second)
    return TickEvent(
        type="tick", user_id=USER_ID, ts=ts, date=day.isoformat(), hostname=host,
        minutes=1, health=day_score(minutes_so_far, budget), budget=budget,
        source="domain", demo=demo, tz_offset=tz,
    )


def _day_ticks(rng, day, budget, scale, demo=False):
    """Sessions sit in separate hours, start in the first 10 min and last <= 40 min,
    so consecutive sessions are always more than the 5 min session gap apart."""
    weekend = day.weekday() >= 4  # Fri-Sun
    if rng.random() < (0.2 if weekend else 0.35):
        return []
    n = rng.randint(1, 4)
    hours = set()
    while len(hours) < n:
        hours.add(rng.choices(list(HOUR_WEIGHTS), weights=list(HOUR_WEIGHTS.values()))[0])
    ticks = []
    total = 0
    for hour in sorted(hours):
        start = rng.randint(0, 9)
        length = max(3, min(40, round(rng.randint(5, 40) * scale)))
        host = rng.choice(HOSTS)
        for i in range(length):
            total += 1
            ticks.append(_tick(day, hour, start + i, host, total, budget, demo=demo))
    return ticks


def build_items(days, rng, today, demo_days=0, demo=False):
    first = today - timedelta(days=days - 1)
    ts, _ = _ts_and_offset(first, 8, 0)
    items = [BackfillEvent(
        type="backfill", user_id=USER_ID, ts=ts, date=first.isoformat(),
        minutes=0, streak=0, budget=BUDGET, health=100, demo=demo,
    )]
    for i in range(days):
        day = first + timedelta(days=i)
        age = (today - day).days
        budget = BUDGET_AFTER_CHANGE if age <= BUDGET_CHANGE_DAYS_AGO else BUDGET
        scale = 1.0 - 0.3 * i / max(days - 1, 1)  # gently trending down
        items += _day_ticks(rng, day, budget, scale, demo)
        if age < demo_days:
            # Offset by 30 s so demo ticks never collide with real (user, ts, host) keys.
            items += [_tick(day, 14, m, HOSTS[0], m + 1, budget, demo=True, second=30)
                      for m in range(15)]
    return items


def seed(conn, days=365, rng_seed=42, demo_days=0, today=None, demo=False):
    today = today or date.today()
    items = build_items(days, random.Random(rng_seed), today, demo_days, demo)
    # Keep the full history, then purge so the DB looks like a real long-running install.
    result = ingest(conn, items, today, enforce_retention=False)
    try:
        from .retention import purge_old_events
        purge_old_events(conn, today)
    except ImportError:  # retention.py comes from another branch
        cutoff = (today - timedelta(days=90)).isoformat()
        conn.execute("DELETE FROM events WHERE date < ?", (cutoff,))
        conn.commit()
    return result


def main():
    p = argparse.ArgumentParser(description="Fill the Testudo database with fake history.")
    p.add_argument("--days", type=int, default=365)
    p.add_argument("--reset", action="store_true", help="delete existing data first")
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--demo-days", type=int, default=0, help="add demo-flagged ticks to the last N days")
    p.add_argument("--as-real", action="store_true",
                   help="store the history as real usage instead of flagging it as sample data")
    args = p.parse_args()

    db.init_schema()
    conn = db.connect()
    try:
        if args.reset:
            delete_user_data(conn)
        elif _has_data(conn):
            raise SystemExit("The database already has data. Use --reset to replace it.")
        result = seed(conn, args.days, args.seed, args.demo_days, demo=not args.as_real)
        print(f"Seeded {args.days} days: {result['accepted']} ticks.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
