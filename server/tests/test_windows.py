from datetime import date, timedelta

from server.windows import add_months, buckets, monday_of, prev_window, window


def test_week_of_sunday():
    assert window("week", date(2026, 10, 25)) == (date(2026, 10, 19), date(2026, 10, 25))


def test_month_leap_february():
    start, end = window("month", date(2028, 2, 10))
    assert (start, end) == (date(2028, 2, 1), date(2028, 2, 29))
    assert len(buckets("month", start, end)) == 29


def test_prev_month_clamps():
    assert prev_window("month", date(2026, 3, 31)) == (date(2026, 2, 1), date(2026, 2, 28))


def test_add_months_clamps_and_wraps():
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2026, 1, 15), -2) == date(2025, 11, 15)


def test_6months():
    anchor = date(2026, 10, 25)
    start, end = window("6months", anchor)
    bs = buckets("6months", start, end)
    assert len(bs) == 26
    assert bs[0][1].weekday() == 0
    assert bs[-1][1] <= anchor <= bs[-1][2]
    assert end == date(2026, 10, 25)
    ps, pe = prev_window("6months", anchor)
    assert pe == start - timedelta(days=1) and (pe - ps).days == 181 and monday_of(ps) == ps


def test_year():
    start, end = window("year", date(2026, 10, 25))
    assert (start, end) == (date(2025, 11, 1), date(2026, 10, 31))
    assert len(buckets("year", start, end)) == 12
    assert prev_window("year", date(2026, 10, 25)) == (date(2024, 11, 1), date(2025, 10, 31))


def test_day_and_prev():
    d = date(2026, 10, 25)
    assert window("day", d) == (d, d)
    assert prev_window("day", d) == (date(2026, 10, 24),) * 2
    assert len(buckets("day", d, d)) == 24
