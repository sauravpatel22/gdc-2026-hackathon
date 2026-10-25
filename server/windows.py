"""Pure date math for dashboard windows. No DB access."""
import calendar
from datetime import date, timedelta

RANGES = ("day", "week", "month", "6months", "year")


def parse_day(s):
    return date.fromisoformat(s)


def monday_of(d):
    return d - timedelta(days=d.weekday())


def add_months(d, n):
    """Shift by n months, clamping the day of month (Mar 31 - 1 -> Feb 28/29)."""
    idx = d.year * 12 + (d.month - 1) + n
    year, month = divmod(idx, 12)
    month += 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def _month_start(d):
    return d.replace(day=1)


def _month_end(d):
    return d.replace(day=calendar.monthrange(d.year, d.month)[1])


def window(range_, anchor):
    """(start, end) inclusive for the window containing `anchor`."""
    if range_ == "day":
        return anchor, anchor
    if range_ == "week":
        start = monday_of(anchor)
        return start, start + timedelta(days=6)
    if range_ == "month":
        return _month_start(anchor), _month_end(anchor)
    if range_ == "6months":
        start = monday_of(anchor) - timedelta(weeks=25)
        return start, monday_of(anchor) + timedelta(days=6)
    if range_ == "year":
        return _month_start(add_months(_month_start(anchor), -11)), _month_end(anchor)
    raise ValueError(f"unknown range: {range_}")


def prev_window(range_, anchor):
    """(start, end) of the window right before the one containing `anchor`."""
    start, _ = window(range_, anchor)
    if range_ == "day":
        d = start - timedelta(days=1)
        return d, d
    if range_ == "week":
        return start - timedelta(days=7), start - timedelta(days=1)
    if range_ == "month":
        prev = add_months(start, -1)
        return prev, _month_end(prev)
    if range_ == "6months":
        return start - timedelta(weeks=26), start - timedelta(days=1)
    if range_ == "year":
        return add_months(start, -12), start - timedelta(days=1)
    raise ValueError(f"unknown range: {range_}")


def buckets(range_, start, end):
    """List of (kind, b_start, b_end, hour|None) covering [start, end]."""
    if range_ == "day":
        return [("hour", start, start, h) for h in range(24)]
    if range_ in ("week", "month"):
        n = (end - start).days + 1
        return [("day", d, d, None) for d in (start + timedelta(days=i) for i in range(n))]
    if range_ == "6months":
        out, s = [], start
        while s <= end:
            out.append(("week", s, s + timedelta(days=6), None))
            s += timedelta(days=7)
        return out
    if range_ == "year":
        out, s = [], start
        while s <= end:
            out.append(("month", s, _month_end(s), None))
            s = add_months(s, 1)
        return out
    raise ValueError(f"unknown range: {range_}")
