import sqlite3
from datetime import date, timedelta

from server import db, queries
from server.scoring import day_score, stage_for

TODAY = date(2026, 10, 25)


def make_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.executescript(db.DDL)
    return conn


def add_day(conn, d, minutes, budget=120):
    for scope in ("real", "all"):
        conn.execute(
            "INSERT INTO daily (user_id, scope, date, gambling_minutes, budget, min_health, "
            "end_health, score, sessions) VALUES ('local', ?, ?, ?, ?, 0, 0, ?, 1)",
            (scope, d.isoformat(), minutes, budget, day_score(minutes, budget)),
        )


def add_backfill(conn, d, streak):
    conn.execute(
        "INSERT INTO backfill (user_id, date, ts, minutes, streak, budget, health) "
        "VALUES ('local', ?, 0, 0, ?, 120, 100)", (d.isoformat(), streak))


def test_day_score():
    assert day_score(60, 120) == 50
    assert day_score(5, 0) == 0
    assert day_score(0, 0) == 100
    assert day_score(500, 120) == 0


def test_stage_boundaries():
    assert [stage_for(s) for s in (100, 80, 79.9, 50, 49.9, 20, 19.9, 0)] == [
        "happy", "happy", "tired", "tired", "sick", "sick", "asleep", "asleep"]


def test_overall_all_clean_with_streak_is_100():
    scores = {TODAY - timedelta(days=i): 100.0 for i in range(14)}
    assert queries.overall_score(scores, TODAY, TODAY - timedelta(days=20), 14) == 100.0


def test_overall_no_data():
    assert queries.overall_score({}, TODAY, None, 0) == 100.0


def test_overall_weights_recent_days_and_bonus():
    # Only today is bad (score 0, weight 14 of 105); no streak.
    scores = {TODAY - timedelta(days=i): 100.0 for i in range(1, 14)}
    scores[TODAY] = 0.0
    assert queries.overall_score(scores, TODAY, TODAY - timedelta(days=30), 0) == round(91 / 105 * 100, 1)
    assert queries.overall_score(scores, TODAY, TODAY - timedelta(days=30), 3) == round(91 / 105 * 100 + 3, 1)


def test_overall_skips_days_before_install():
    install = TODAY - timedelta(days=1)
    scores = {TODAY: 0.0, install: 100.0}
    # weights: today 14, yesterday 13
    assert queries.overall_score(scores, TODAY, install, 0) == round(13 / 27 * 100, 1)


def test_streak_adds_backfill_when_all_clean():
    conn = make_conn()
    install = TODAY - timedelta(days=3)
    add_backfill(conn, install, 2)
    add_day(conn, install, 0)  # clean day recorded on install date
    s = queries.streaks(conn, "local", "real", install, TODAY, TODAY)
    assert s[install] == 2
    assert s[TODAY] == 2 + 3  # 3 clean days (install..today-1) since install


def test_streak_resets_after_gambling_day():
    conn = make_conn()
    install = TODAY - timedelta(days=5)
    add_backfill(conn, install, 4)
    add_day(conn, install, 0)
    add_day(conn, TODAY - timedelta(days=1), 30)
    s = queries.streaks(conn, "local", "real", install, TODAY, TODAY)
    assert s[TODAY] == 0
    assert s[TODAY - timedelta(days=1)] == 4 + 4  # backfill 4 + clean days 5..2 ago


def test_streak_after_break_counts_only_clean_days():
    conn = make_conn()
    install = TODAY - timedelta(days=10)
    add_day(conn, install, 0)
    add_day(conn, TODAY - timedelta(days=4), 10)
    s = queries.streaks(conn, "local", "real", install, TODAY, TODAY)
    assert s[TODAY] == 3  # 3, 2, 1 days ago are clean; today isn't counted
    assert s[TODAY - timedelta(days=4)] == 6  # 10..5 days ago are clean, no backfill streak


def test_score_without_data():
    conn = make_conn()
    assert queries.score(conn, "local", "real", TODAY) == {
        "score": 100.0, "stage": "happy", "streak": 0, "install_date": None, "has_data": False}
