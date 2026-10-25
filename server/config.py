import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

DB_PATH = os.environ.get("TESTUDO_DB", str(REPO_ROOT / "testudo.db"))
DEPLOYMENT = os.environ.get("TESTUDO_DEPLOYMENT", "local")  # "local" or "remote"

RETENTION_DAYS = 90
SESSION_GAP_MS = 5 * 60 * 1000
DEFAULT_BUDGET = 120  # same as config.js
MAX_BATCH = 1000

OLLAMA_URL = os.environ.get("TESTUDO_OLLAMA_URL", "http://localhost:11434")
MODEL_NAME = os.environ.get("TESTUDO_MODEL", "gemma4:e2b")  # same as config.js
INSIGHTS_TIMEOUT_S = 90
