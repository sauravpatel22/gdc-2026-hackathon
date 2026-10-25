from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from . import queries
from .db import get_conn
from .windows import window

router = APIRouter(prefix="/api")

USER = "local"
DAY_PATTERN = r"^\d{4}-\d{2}-\d{2}$"

Range = Literal["day", "week", "month", "6months", "year"]
Metric = Literal["minutes", "budget_pct", "score", "sessions", "streak"]
Flag = Literal["0", "1"]


def day_param():
    # A fresh Query per parameter; FastAPI mutates the object it is given.
    return Query(None, pattern=DAY_PATTERN)


def _parse(s: Optional[str], name: str) -> Optional[date]:
    if s is None:
        return None
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{name} is not a valid date")


def _today(today: Optional[str]) -> date:
    return _parse(today, "today") or date.today()


def _anchor(anchor: Optional[str], today: date) -> date:
    return min(_parse(anchor, "anchor") or today, today)


def _scope(include_demo: str) -> str:
    return "all" if include_demo == "1" else "real"


@router.get("/score")
def get_score(today: Optional[str] = day_param(), include_demo: Flag = "0",
              conn=Depends(get_conn)):
    return queries.score(conn, USER, _scope(include_demo), _today(today))


@router.get("/summary")
def get_summary(range: Range = "week", anchor: Optional[str] = day_param(),
                today: Optional[str] = day_param(), include_demo: Flag = "0",
                conn=Depends(get_conn)):
    t = _today(today)
    return queries.summary(conn, USER, _scope(include_demo), range, _anchor(anchor, t), t)


@router.get("/series")
def get_series(metric: Metric = "minutes", range: Range = "week",
               anchor: Optional[str] = day_param(), today: Optional[str] = day_param(),
               include_demo: Flag = "0", conn=Depends(get_conn)):
    t = _today(today)
    return queries.series(conn, USER, _scope(include_demo), metric, range, _anchor(anchor, t), t)


@router.get("/sites")
def get_sites(range: Range = "week", anchor: Optional[str] = day_param(),
              today: Optional[str] = day_param(), include_demo: Flag = "0",
              start: Optional[str] = day_param(), end: Optional[str] = day_param(),
              hour: Optional[int] = Query(None, ge=0, le=23), conn=Depends(get_conn)):
    t = _today(today)
    if (start is None) != (end is None):
        raise HTTPException(status_code=422, detail="start and end must be given together")
    if hour is not None and range != "day":
        raise HTTPException(status_code=422, detail="hour needs range=day")
    if start is not None:
        s, e = _parse(start, "start"), _parse(end, "end")
        if s > e:
            raise HTTPException(status_code=422, detail="start is after end")
    else:
        s, e = window(range, _anchor(anchor, t))
    return queries.sites(conn, USER, _scope(include_demo), s, e, hour=hour)


@router.get("/heatmap")
def get_heatmap(range: Range = "week", anchor: Optional[str] = day_param(),
                today: Optional[str] = day_param(), include_demo: Flag = "0",
                conn=Depends(get_conn)):
    t = _today(today)
    s, e = window(range, _anchor(anchor, t))
    return queries.heatmap(conn, USER, _scope(include_demo), s, e, t)
