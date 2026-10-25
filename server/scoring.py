def day_score(minutes, budget):
    """Mirrors health.js computeHealth."""
    if not budget or budget <= 0:
        return 0.0 if minutes > 0 else 100.0
    return min(100.0, max(0.0, 100.0 - minutes / budget * 100.0))


def stage_for(score):
    """Mirrors getPetStage / pet.js."""
    if score >= 80:
        return "happy"
    if score >= 50:
        return "tired"
    if score >= 20:
        return "sick"
    return "asleep"
