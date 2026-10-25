import calendar
import sqlite3
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server import db
from server.db import get_conn
from server.retention import purge_old_events
from server.routes_read import router
from server.scoring import day_score

TODAY = date(2026, 10, 25)  # a Sunday
INSTALL = date(2026, 9, 1)
BASE_TS = 1761350400000  # 2025-10-25 00:00 UTC; only used for relative offsets


def add_day(conn, d, minutes, budget=120, sessions=1):
    for scope in ("real", "all"):
        conn.execute(
            "INSERT INTO daily VALUES ('local', ?, ?, ?, ?, 0, 0, ?, ?)",
            (scope, d.isoformat(), minutes, budget, day_score(minutes, budget), sessions),
        )


def add_site(conn, d, host, minutes, sessions=1):
    for scope in ("real", "all"):
        conn.execute("INSERT INTO daily_sites VALUES ('local', ?, ?, ?, ?, ?)",
                     (scope, d.isoformat(), host, minutes, sessions))


def add_event(conn, d, hour, host, minutes, health=90.0, demo=0):
    ts = calendar.timegm(d.timetuple()) * 1000 + hour * 3600000 + demo * 1000
    conn.execute(
        "INSERT INTO events (user_id, ts, date, hostname, minutes, health, budget, demo, tz_offset) "
        "VALUES ('local', ?, ?, ?, ?, ?, 120, ?, 0)",
        (ts, d.isoformat(), host, minutes, health, demo))


@pytest.fixture
def conn(tmp_path):
    c = sqlite3.connect(tmp_path / "t.db", check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.executescript(db.DDL)
    # Install day plus: Mon-Wed this week gambling, Thu-Sat clean (no rows), today 60 min.
    add_day(c, INSTALL, 10)
    add_day(c, date(2026, 10, 19), 30)
    add_day(c, date(2026, 10, 20), 60)
    add_day(c, date(2026, 10, 21), 12)
    add_day(c, TODAY, 60)
    add_site(c, date(2026, 10, 19), "stake.com", 20)
    add_site(c, date(2026, 10, 19), "fanduel.com", 10)
    add_site(c, date(2026, 10, 20), "stake.com", 60)
    add_event(c, TODAY, 21, "stake.com", 1)
    add_event(c, TODAY, 21, "stake.com", 1, demo=1)
    add_event(c, TODAY, 22, "fanduel.com", 2)
    c.commit()
    yield c
    c.close()


@pytest.fixture
def client(conn):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_conn] = lambda: conn
    return TestClient(app)


def get(client, path, **params):
    params.setdefault("today", TODAY.isoformat())
    return client.get(path, params=params)


def test_series_week_has_seven_points(client):
    body = get(client, "/api/series", metric="minutes", range="week").json()
    assert body["bucket"] == "day" and len(body["points"]) == 7
    assert [p["value"] for p in body["points"]][:3] == [30, 60, 12]
    assert body["points"][0]["start"] == "2026-10-19"


def test_series_month_day_count_and_future_nulls(client):
    body = get(client, "/api/series", range="month", anchor="2026-10-10").json()
    assert len(body["points"]) == 31
    assert body["points"][-1]["value"] is None  # Oct 31 is after today
    clean = body["points"][21]  # Oct 22: counted, no row
    assert clean["value"] == 0 and clean["values"]["score"] == 100


def test_series_before_install_is_null(client):
    body = get(client, "/api/series", range="month", anchor="2026-08-15").json()
    assert all(p["value"] is None for p in body["points"])
    body = get(client, "/api/series", range="month", anchor="2026-09-10").json()
    assert body["points"][0]["value"] is not None  # Sep 1
    assert get(client, "/api/series", range="week", anchor="2026-08-30").json()["points"][0]["value"] is None


def test_series_counts_and_flags(client):
    year = get(client, "/api/series", range="year").json()
    assert len(year["points"]) == 12 and year["per_day_average"] is True
    half = get(client, "/api/series", range="6months").json()
    assert len(half["points"]) == 26 and half["bucket"] == "week"
    week = get(client, "/api/series", range="week").json()
    assert week["points"][6]["over_limit"] is False


def test_series_over_limit_and_budget_pct(client, conn):
    conn.execute("INSERT INTO daily VALUES ('local', 'real', '2026-10-22', 150, 120, 0, 0, 0, 2)")
    body = get(client, "/api/series", metric="budget_pct", range="week").json()
    p = body["points"][3]
    assert p["over_limit"] is True and p["value"] == 125


def test_series_day_hourly(client):
    body = get(client, "/api/series", range="day", anchor=TODAY.isoformat()).json()
    assert body["bucket"] == "hour" and len(body["points"]) == 24
    assert body["hourly_available"] is True
    assert body["points"][21]["values"]["minutes"] == 1  # demo tick excluded
    assert body["points"][22]["values"]["minutes"] == 2
    assert body["points"][23]["values"]["budget_pct"] == 2.5  # 3 of 120 min, cumulative
    assert body["points"][0]["values"]["score"] == 100
    assert body["points"][23]["values"]["score"] == 90
    all_scope = get(client, "/api/series", range="day", anchor=TODAY.isoformat(), include_demo=1).json()
    assert all_scope["points"][21]["values"]["minutes"] == 2


def test_series_old_day_has_no_hourly(client):
    body = get(client, "/api/series", range="day", anchor="2026-07-01").json()
    assert body["hourly_available"] is False
    assert all(p["value"] is None for p in body["points"])


def test_summary_current_week(client):
    s = get(client, "/api/summary", range="week").json()
    assert (s["start"], s["end"]) == ("2026-10-19", "2026-10-25")
    assert s["can_go_next"] is False and s["can_go_prev"] is True
    assert s["counted_days"] == 7
    m = s["metrics"]["minutes"]
    assert m["total"] == 162 and m["average"] == round(162 / 7, 1)
    assert m["change_pct"] is None  # previous week has only clean days -> avg 0
    assert s["highlights"]["best_day"] == {"date": "2026-10-21", "minutes": 12}
    assert s["highlights"]["clean_days"] == 3
    assert s["highlights"]["longest_break_days"] == 3
    assert s["streak"] == 3 and s["overall"]["stage"] in {"happy", "tired", "sick", "asleep"}


def test_summary_prev_week_navigation_stops_at_install(client):
    s = get(client, "/api/summary", range="week", anchor="2026-09-01").json()
    assert s["can_go_prev"] is False
    s = get(client, "/api/summary", range="week", anchor="2026-12-01").json()  # clamped to today
    assert s["end"] == "2026-10-25"


def test_summary_no_data(tmp_path):
    c = sqlite3.connect(tmp_path / "e.db", check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.executescript(db.DDL)
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_conn] = lambda: c
    cl = TestClient(app)
    s = get(cl, "/api/summary").json()
    assert s["has_data"] is False and s["metrics"]["minutes"]["average"] is None
    assert get(cl, "/api/score").json()["has_data"] is False


def test_score_endpoint(client):
    body = get(client, "/api/score").json()
    assert body["install_date"] == "2026-09-01" and body["has_data"] is True
    assert 0 <= body["score"] <= 100


def test_sites_shares_sum_to_one(client):
    body = get(client, "/api/sites", range="week").json()
    assert body["total_minutes"] == 90
    assert [s["hostname"] for s in body["sites"]] == ["stake.com", "fanduel.com"]
    assert sum(s["share"] for s in body["sites"]) == pytest.approx(1, abs=0.01)


def test_sites_start_end_and_hour(client):
    one = get(client, "/api/sites", start="2026-10-20", end="2026-10-20").json()
    assert one["sites"][0]["minutes"] == 60 and one["sites"][0]["share"] == 1
    hr = get(client, "/api/sites", range="day", anchor=TODAY.isoformat(), hour=22).json()
    assert [(s["hostname"], s["minutes"], s["sessions"]) for s in hr["sites"]] == [("fanduel.com", 2, 1)]


def test_heatmap(client):
    h = get(client, "/api/heatmap", range="week").json()
    assert len(h["cells"]) == 7 and all(len(r) == 24 for r in h["cells"])
    assert h["cells"][6][21] == 1 and h["cells"][6][22] == 2  # Sunday, demo excluded
    assert h["max"] == 2 and h["partial"] is False
    assert get(client, "/api/heatmap", range="year").json()["partial"] is True


@pytest.mark.parametrize("path,params", [
    ("/api/series", {"range": "decade"}),
    ("/api/series", {"metric": "mood"}),
    ("/api/summary", {"include_demo": "2"}),
    ("/api/summary", {"anchor": "10/25/2026"}),
    ("/api/summary", {"today": "2026-13-45"}),
    ("/api/sites", {"start": "2026-10-20"}),
    ("/api/sites", {"hour": "24", "range": "day"}),
    ("/api/sites", {"hour": "3"}),
])
def test_bad_params_are_422(client, path, params):
    assert get(client, path, **params).status_code == 422


def test_include_demo_accepts_0_and_1(client):
    assert get(client, "/api/summary", include_demo=0).status_code == 200
    assert get(client, "/api/summary", include_demo=1).status_code == 200


def test_purge_old_events(conn):
    add_event(conn, TODAY - timedelta(days=100), 12, "stake.com", 1)
    assert purge_old_events(conn, TODAY) == 1
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 3
