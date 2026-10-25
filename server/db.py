import sqlite3
from pathlib import Path

from . import config

SCHEMA_VERSION = 1

DDL = """
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  user_id    TEXT    NOT NULL DEFAULT 'local',
  ts         INTEGER NOT NULL,
  date       TEXT    NOT NULL,
  hostname   TEXT    NOT NULL,
  minutes    REAL    NOT NULL,
  health     REAL    NOT NULL,
  budget     INTEGER NOT NULL,
  source     TEXT,
  demo       INTEGER NOT NULL DEFAULT 0,
  tz_offset  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (user_id, ts, hostname)
);
CREATE INDEX IF NOT EXISTS idx_events_user_date ON events(user_id, date);

CREATE TABLE IF NOT EXISTS backfill (
  user_id  TEXT    NOT NULL DEFAULT 'local',
  date     TEXT    NOT NULL,
  ts       INTEGER NOT NULL,
  minutes  REAL    NOT NULL,
  streak   INTEGER NOT NULL,
  budget   INTEGER NOT NULL,
  health   REAL    NOT NULL,
  demo     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS daily (
  user_id          TEXT    NOT NULL DEFAULT 'local',
  scope            TEXT    NOT NULL CHECK (scope IN ('real', 'all')),
  date             TEXT    NOT NULL,
  gambling_minutes REAL    NOT NULL DEFAULT 0,
  budget           INTEGER NOT NULL,
  min_health       REAL    NOT NULL,
  end_health       REAL    NOT NULL,
  score            REAL    NOT NULL,
  sessions         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, scope, date)
);

CREATE TABLE IF NOT EXISTS daily_sites (
  user_id  TEXT    NOT NULL DEFAULT 'local',
  scope    TEXT    NOT NULL CHECK (scope IN ('real', 'all')),
  date     TEXT    NOT NULL,
  hostname TEXT    NOT NULL,
  minutes  REAL    NOT NULL,
  sessions INTEGER NOT NULL,
  PRIMARY KEY (user_id, scope, date, hostname)
);

CREATE TABLE IF NOT EXISTS sites (
  user_id    TEXT NOT NULL DEFAULT 'local',
  hostname   TEXT NOT NULL,
  source     TEXT,
  first_seen INTEGER,
  last_seen  INTEGER,
  PRIMARY KEY (user_id, hostname)
);
"""


def connect():
    # check_same_thread=False: FastAPI may run a dependency and its endpoint on different threads.
    conn = sqlite3.connect(config.DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_schema():
    Path(config.DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = connect()
    try:
        conn.executescript(DDL)
        conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        conn.commit()
    finally:
        conn.close()


def get_conn():
    conn = connect()
    try:
        yield conn
    finally:
        conn.close()
