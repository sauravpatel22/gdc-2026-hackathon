from datetime import date as _date
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator

from .config import MAX_BATCH


def _check_date(v: str) -> str:
    try:
        _date.fromisoformat(v)
    except ValueError as e:
        raise ValueError("date must be a real YYYY-MM-DD day") from e
    return v


DateStr = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]


class TickEvent(BaseModel):
    type: Literal["tick"]
    user_id: str = "local"
    ts: int
    date: DateStr
    hostname: str = Field(min_length=1, max_length=253)
    minutes: float = Field(gt=0, le=60)
    health: float = Field(ge=0, le=100)
    budget: int = Field(ge=0)
    source: Optional[str] = None
    demo: bool = False
    tz_offset: int = Field(default=0, ge=-840, le=840)

    @field_validator("date")
    @classmethod
    def _date_ok(cls, v):
        return _check_date(v)

    @field_validator("hostname")
    @classmethod
    def _lower(cls, v):
        return v.strip().lower()


class BackfillEvent(BaseModel):
    type: Literal["backfill"]
    user_id: str = "local"
    ts: int
    date: DateStr
    minutes: float = Field(ge=0)
    streak: int = Field(ge=0)
    budget: int = Field(ge=0)
    health: float = Field(ge=0, le=100)
    demo: bool = False

    @field_validator("date")
    @classmethod
    def _date_ok(cls, v):
        return _check_date(v)


IngestItem = Annotated[Union[TickEvent, BackfillEvent], Field(discriminator="type")]
IngestBatch = Annotated[list[IngestItem], Field(max_length=MAX_BATCH)]
