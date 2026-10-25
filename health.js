// Pure helpers, no chrome.* calls, so they can be imported anywhere.

export function computeHealth(minutes, budget) {
  if (!budget || budget <= 0) return minutes > 0 ? 0 : 100;
  const health = 100 - (minutes / budget) * 100;
  return Math.min(100, Math.max(0, health));
}

export function getPetStage(health) {
  if (health >= 80) return "happy";
  if (health >= 50) return "tired";
  if (health >= 20) return "sick";
  return "asleep";
}
