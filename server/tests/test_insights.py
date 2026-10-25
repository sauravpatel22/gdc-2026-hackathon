from datetime import date

from server import insights

from .test_api import INSTALL, TODAY, add_day, add_event, add_site, get


def seed(conn):
    add_day(conn, TODAY, 90)
    add_site(conn, TODAY, "stake.com", 90)
    add_event(conn, TODAY, 22, "stake.com", 90)
    conn.commit()


def test_no_data(client):
    r = get(client, "/api/insights", range="week").json()
    assert r["status"] == "no_data" and r["insights"] == []


def test_digest_is_aggregates_only(conn):
    seed(conn)
    d = insights.build_digest(conn, "local", "real", "week", TODAY, TODAY)
    assert d["total_minutes"] == 90
    assert d["top_sites"][0]["site"] == "stake.com"
    assert d["share_of_time_by_part_of_day_pct"]["evening (6 PM to 11 PM)"] == 100


def test_parse_and_cache(conn, monkeypatch):
    seed(conn)
    calls = []

    def fake(digest):
        calls.append(1)
        return [{"title": "t", "body": "b"}]

    monkeypatch.setattr(insights, "ask_gemma", fake)
    insights._cache.clear()
    args = (conn, "local", "real", "week", TODAY, TODAY)
    assert insights.insights(*args)["status"] == "ok"
    insights.insights(*args)
    assert len(calls) == 1
    insights.insights(*args, refresh=True)
    assert len(calls) == 2


def test_unavailable_when_model_down(conn, monkeypatch):
    seed(conn)
    monkeypatch.setattr(insights, "ask_gemma", lambda d: None)
    insights._cache.clear()
    assert insights.insights(conn, "local", "real", "week", TODAY, TODAY)["status"] == "unavailable"


def test_parse_strips_fences():
    out = insights._parse('```json\n{"insights": [{"title": "a", "body": "b"}, {"title": "", "body": "x"}]}\n```')
    assert out == [{"title": "a", "body": "b"}]
