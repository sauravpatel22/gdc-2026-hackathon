import csv
import io
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from server import db, seed
from server.routes_data import router


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr("server.config.DB_PATH", str(tmp_path / "t.db"))
    db.init_schema()
    conn = db.connect()
    seed.seed(conn, days=10, today=date(2026, 10, 25))
    conn.close()
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _count(table):
    conn = db.connect()
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    finally:
        conn.close()


def test_export_json_has_every_key(client):
    r = client.get("/api/export?format=json")
    assert r.status_code == 200
    assert 'filename="testudo-export.json"' in r.headers["content-disposition"]
    body = r.json()
    for key in ("exported_at", "daily", "daily_sites", "events", "sites", "backfill"):
        assert key in body
    assert body["daily"] and body["events"] and len(body["backfill"]) == 1


def test_export_csv_has_header_row(client):
    r = client.get("/api/export?format=csv&table=events")
    assert 'filename="testudo-events.csv"' in r.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(r.text)))
    assert "hostname" in rows[0] and len(rows) > 1
    assert client.get("/api/export?format=csv").headers["content-disposition"].endswith('testudo-daily.csv"')


def test_export_rejects_bad_params(client):
    assert client.get("/api/export?format=xml").status_code == 422
    assert client.get("/api/export?format=csv&table=backfill").status_code == 422


def test_delete_requires_confirm(client):
    r = client.delete("/api/data")
    assert r.status_code == 400
    assert r.json() == {"detail": "Add ?confirm=yes to delete everything."}
    assert _count("daily") > 0


def test_delete_clears_every_table(client):
    assert client.delete("/api/data?confirm=yes").json() == {"ok": True}
    for t in ("events", "backfill", "daily", "daily_sites", "sites"):
        assert _count(t) == 0
