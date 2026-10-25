from datetime import timedelta

from . import config


def purge_old_events(conn, today):
    """Delete raw events older than the retention window. Daily rollups are already complete."""
    cutoff = (today - timedelta(days=config.RETENTION_DAYS)).isoformat()
    cur = conn.execute("DELETE FROM events WHERE date < ?", (cutoff,))
    conn.commit()
    return cur.rowcount
