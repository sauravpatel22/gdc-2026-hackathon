from datetime import date, timedelta

TODAY = date.today().isoformat()
BASE_TS = 1761400000000
MIN = 60_000


def tick(ts=BASE_TS, d=TODAY, host="stake.com", minutes=1, demo=False, **kw):
    return {"type": "tick", "user_id": "local", "ts": ts, "date": d, "hostname": host,
            "minutes": minutes, "health": 99.0, "budget": 120, "source": "domain",
            "demo": demo, "tz_offset": 240, **kw}


def backfill(minutes=30, d=TODAY, demo=False):
    return {"type": "backfill", "user_id": "local", "ts": BASE_TS - MIN, "date": d,
            "minutes": minutes, "streak": 2, "budget": 120, "health": 75.0, "demo": demo}


def daily(conn, scope, d=TODAY):
    return conn.execute(
        "SELECT * FROM daily WHERE user_id='local' AND scope=? AND date=?", (scope, d)
    ).fetchone()


def test_same_batch_twice_is_idempotent(client, conn):
    batch = [tick(BASE_TS), tick(BASE_TS + MIN)]
    r1 = client.post("/api/events", json=batch).json()
    assert r1["accepted"] == 2
    before = daily(conn, "real")["gambling_minutes"]
    r2 = client.post("/api/events", json=batch).json()
    assert r2["accepted"] == 0 and r2["ignored"] == 2
    assert daily(conn, "real")["gambling_minutes"] == before == 2


def test_backfill_plus_ticks(client, conn):
    batch = [tick(BASE_TS), tick(BASE_TS + MIN), backfill(30)]
    r = client.post("/api/events", json=batch).json()
    assert r["backfill"] == "stored" and r["accepted"] == 2
    assert daily(conn, "real")["gambling_minutes"] == 32
    assert daily(conn, "all")["gambling_minutes"] == 32
    r = client.post("/api/events", json=[backfill(30)]).json()
    assert r["backfill"] == "ignored"
    assert daily(conn, "real")["gambling_minutes"] == 32


def test_demo_ticks_only_in_all_scope(client, conn):
    client.post("/api/events", json=[tick(BASE_TS), tick(BASE_TS + MIN, demo=True, host="demo.com")])
    assert daily(conn, "real")["gambling_minutes"] == 1
    assert daily(conn, "all")["gambling_minutes"] == 2
    hosts = {r[0] for r in conn.execute(
        "SELECT hostname FROM daily_sites WHERE scope='real'")}
    assert hosts == {"stake.com"}
    assert client.get("/api/health").json()["has_demo"] is True


def test_demo_only_day_absent_from_real(client, conn):
    client.post("/api/events", json=[tick(demo=True)])
    assert daily(conn, "real") is None
    assert daily(conn, "all") is not None


def test_sessions_by_gap(client, conn):
    client.post("/api/events", json=[tick(BASE_TS), tick(BASE_TS + 3 * MIN)])
    assert daily(conn, "real")["sessions"] == 1
    other = (date.today() - timedelta(days=1)).isoformat()
    client.post("/api/events", json=[tick(BASE_TS + 100 * MIN, d=other), tick(BASE_TS + 106 * MIN, d=other)])
    assert daily(conn, "real", other)["sessions"] == 2


def test_tick_older_than_90_days_ignored(client, conn):
    old = (date.today() - timedelta(days=91)).isoformat()
    r = client.post("/api/events", json=[tick(d=old)]).json()
    assert r["accepted"] == 0 and r["ignored"] == 1
    assert conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0
    assert daily(conn, "real", old) is None


def test_bad_payloads_422(client):
    assert client.post("/api/events", json=[tick(minutes=0)]).status_code == 422
    assert client.post("/api/events", json=[tick(d="10/25/2026")]).status_code == 422
    assert client.post("/api/events", json=[tick(d="2026-13-45")]).status_code == 422


def test_hostname_lowercased_and_health_endpoint(client, conn):
    client.post("/api/events", json=[tick(host="Stake.COM")])
    assert conn.execute("SELECT hostname FROM events").fetchone()[0] == "stake.com"
    h = client.get("/api/health").json()
    assert h == {"ok": True, "deployment": "local", "has_demo": False, "schema": 1}
