import pytest
from fastapi.testclient import TestClient

from server import config, db


@pytest.fixture
def db_path(tmp_path, monkeypatch):
    path = str(tmp_path / "test.db")
    monkeypatch.setattr(config, "DB_PATH", path)
    db.init_schema()
    return path


@pytest.fixture
def conn(db_path):
    c = db.connect()
    yield c
    c.close()


@pytest.fixture
def client(db_path):
    from server.app import app

    with TestClient(app) as c:
        yield c
