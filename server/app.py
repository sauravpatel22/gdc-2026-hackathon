from contextlib import asynccontextmanager
from datetime import date

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config, db
from .ingest import ingest
from .models import IngestBatch


@asynccontextmanager
async def lifespan(app):
    db.init_schema()
    yield


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://[a-p]{32}$",
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)


@app.post("/api/events")
def post_events(items: IngestBatch, conn=Depends(db.get_conn)):
    return ingest(conn, items, date.today())


@app.get("/api/health")
def health(conn=Depends(db.get_conn)):
    row = conn.execute(
        "SELECT 1 FROM daily a LEFT JOIN daily r "
        "ON r.user_id = a.user_id AND r.scope = 'real' AND r.date = a.date "
        "WHERE a.scope = 'all' AND (r.date IS NULL OR r.gambling_minutes != a.gambling_minutes "
        "OR r.sessions != a.sessions OR r.min_health != a.min_health "
        "OR r.end_health != a.end_health OR r.budget != a.budget) LIMIT 1"
    ).fetchone()
    return {
        "ok": True,
        "deployment": config.DEPLOYMENT,
        "has_demo": row is not None,
        "schema": db.SCHEMA_VERSION,
    }
