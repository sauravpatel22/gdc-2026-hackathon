import asyncio
from contextlib import asynccontextmanager
from datetime import date

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import config, db, retention, routes_data, routes_read
from .ingest import ingest
from .models import IngestBatch

PURGE_INTERVAL_S = 24 * 60 * 60


def _purge():
    conn = db.connect()
    try:
        retention.purge_old_events(conn, date.today())
    finally:
        conn.close()


async def _purge_loop():
    while True:
        await asyncio.sleep(PURGE_INTERVAL_S)
        try:
            await asyncio.to_thread(_purge)
        except Exception as err:
            print(f"[Testudo] purge failed: {err}")


@asynccontextmanager
async def lifespan(app):
    db.init_schema()
    _purge()
    task = asyncio.create_task(_purge_loop())
    try:
        yield
    finally:
        task.cancel()


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


app.include_router(routes_read.router)
app.include_router(routes_data.router)


@app.get("/pet.js", include_in_schema=False)
def pet_js():
    # one copy of the mascot: the extension's own pet.js
    return FileResponse(config.REPO_ROOT / "pet.js", media_type="text/javascript")


# last, so it never shadows /api or /pet.js
app.mount("/", StaticFiles(directory=config.REPO_ROOT / "dashboard", html=True), name="dashboard")
