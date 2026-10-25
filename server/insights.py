import hashlib
import json
import urllib.request
from datetime import date

from . import config, queries

DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
# (label, first hour, last hour)
PARTS = [("late night (midnight to 5 AM)", 0, 5), ("morning (6 AM to 11 AM)", 6, 11),
         ("afternoon (noon to 5 PM)", 12, 17), ("evening (6 PM to 11 PM)", 18, 23)]
MAX_INSIGHTS = 3

# digest hash -> insights; the same numbers never need a second model call
_cache = {}


def build_digest(conn, user, scope, range_, anchor, today):
    """A small, plain-language fact sheet for the window. Only aggregates, never raw events."""
    s = queries.summary(conn, user, scope, range_, anchor, today)
    if not s["has_data"] or s["counted_days"] == 0:
        return None
    start, end = s["start"], s["end"]
    hm = queries.heatmap(conn, user, scope, date.fromisoformat(start), date.fromisoformat(end), today)
    top = queries.sites(conn, user, scope, date.fromisoformat(start), date.fromisoformat(end))

    m = s["metrics"]
    total = m["minutes"]["total"] or 0
    by_day = [sum(row) for row in hm["cells"]]
    by_part = {label: sum(sum(row[a:b + 1]) for row in hm["cells"]) for label, a, b in PARTS}
    digest = {
        "period": f"{start} to {end} ({range_})",
        "days_counted": s["counted_days"],
        "daily_limit_minutes": s["budget"],
        "total_minutes": total,
        "avg_minutes_per_day": m["minutes"]["average"],
        "avg_minutes_per_day_previous_period": m["minutes"]["prev_average"],
        "change_vs_previous_pct": m["minutes"]["change_pct"],
        "sessions_total": m["sessions"]["total"],
        "days_under_limit": s["highlights"]["under_limit_days"],
        "gambling_free_days": s["highlights"]["clean_days"],
        "longest_break_days": s["highlights"]["longest_break_days"],
        "current_streak_days": s["streak"],
        "wellbeing_score": s["overall"]["score"],
        "top_sites": [{"site": x["hostname"], "minutes": x["minutes"], "share_pct": round(x["share"] * 100)}
                      for x in top["sites"][:3]],
    }
    if total > 0:
        digest["busiest_weekday"] = DAYS[by_day.index(max(by_day))]
        digest["share_of_time_by_part_of_day_pct"] = {k: round(v / total * 100) for k, v in by_part.items()}
    return digest


def _prompt(digest):
    return "\n".join([
        "You write short, kind insights for someone who is tracking and cutting down their time on",
        "gambling sites. Less gambling time is good. Be warm, calm and encouraging. Never shame or scare,",
        "never use the word 'addict', and do not give medical advice. Talk to the person as 'you'.",
        "Use ONLY the numbers in the facts below; do not invent any. Round minutes to whole numbers.",
        "Write exactly 3 insights: one about what is going well, one about a pattern worth noticing",
        "(time of day, weekday, or a site), and one small, concrete, gentle suggestion.",
        "Each insight has a title of at most 6 words and a body of at most 2 short sentences.",
        'Reply with JSON only, in exactly this shape: {"insights": [{"title": "...", "body": "..."}]}',
        "",
        "Facts:",
        json.dumps(digest, indent=1),
    ])


def _parse(text):
    cleaned = str(text).replace("```json", "").replace("```", "").strip()
    items = json.loads(cleaned)["insights"]
    out = [{"title": str(i["title"]).strip(), "body": str(i["body"]).strip()}
           for i in items if i.get("title") and i.get("body")]
    return out[:MAX_INSIGHTS] or None


def ask_gemma(digest):
    """Insights from the local model, or None if Ollama is down or answers badly. Never raises."""
    body = json.dumps({"model": config.MODEL_NAME, "prompt": _prompt(digest), "stream": False,
                       "format": "json", "options": {"temperature": 0.4}}).encode()
    req = urllib.request.Request(f"{config.OLLAMA_URL}/api/generate", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=config.INSIGHTS_TIMEOUT_S) as res:
            return _parse(json.load(res)["response"])
    except Exception as err:
        print(f"[Testudo] Gemma insights failed: {err}")
        return None


def insights(conn, user, scope, range_, anchor, today, refresh=False):
    digest = build_digest(conn, user, scope, range_, anchor, today)
    if digest is None:
        return {"status": "no_data", "insights": [], "model": config.MODEL_NAME}
    key = hashlib.sha1(json.dumps(digest, sort_keys=True).encode()).hexdigest()
    result = None if refresh else _cache.get(key)
    if result is None:
        result = ask_gemma(digest)
        if result is None:
            return {"status": "unavailable", "insights": [], "model": config.MODEL_NAME}
        _cache[key] = result
    return {"status": "ok", "insights": result, "model": config.MODEL_NAME}
