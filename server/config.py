import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

DB_PATH = os.environ.get("TESTUDO_DB", str(REPO_ROOT / "testudo.db"))
DEPLOYMENT = os.environ.get("TESTUDO_DEPLOYMENT", "local")  # "local" or "remote"

RETENTION_DAYS = 90
SESSION_GAP_MS = 5 * 60 * 1000
DEFAULT_BUDGET = 120  # same as config.js
MAX_BATCH = 1000
