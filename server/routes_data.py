import csv
import io
import json
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Response

from . import db

router = APIRouter()

USER_ID = "local"
TABLES = ("events", "backfill", "daily", "daily_sites", "sites")


def _rows(conn, table, user_id=USER_ID):
    cur = conn.execute(f"SELECT * FROM {table} WHERE user_id = ?", (user_id,))
    return [d[0] for d in cur.description], cur.fetchall()


def delete_user_data(conn, user_id=USER_ID):
    """Delete the user's rows from all five tables. Also used by seed --reset."""
    for table in TABLES:
        conn.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
    conn.commit()


@router.get("/api/export")
def export(
    format: Literal["json", "csv"] = "json",
    table: Literal["daily", "events", "sites"] = "daily",
    conn=Depends(db.get_conn),
):
    if format == "csv":
        cols, rows = _rows(conn, table)
        out = io.StringIO()
        writer = csv.writer(out)
        writer.writerow(cols)
        writer.writerows(tuple(r) for r in rows)
        return Response(
            out.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="testudo-{table}.csv"'},
        )

    body = {"exported_at": datetime.now(timezone.utc).isoformat()}
    for name in ("daily", "daily_sites", "events", "sites", "backfill"):
        cols, rows = _rows(conn, name)
        body[name] = [dict(zip(cols, r)) for r in rows]
    return Response(
        json.dumps(body),
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="testudo-export.json"'},
    )


@router.delete("/api/data")
def delete_data(confirm: Optional[str] = None, conn=Depends(db.get_conn)):
    if confirm != "yes":
        raise HTTPException(status_code=400, detail="Add ?confirm=yes to delete everything.")
    delete_user_data(conn)
    return {"ok": True}
