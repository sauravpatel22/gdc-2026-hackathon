// Classic script (no import/export), shared by the popup and the on-page pet.
// Stage thresholds mirror getPetStage() in health.js (80 / 50 / 20).
globalThis.Pause = globalThis.Pause || {};

(() => {
  const STAGES = {
    happy: {
      color: "#4caf50",
      label: "Happy",
      message: "Feeling great! Thanks for looking after us today.",
    },
    tired: {
      color: "#fbc02d",
      label: "Tired",
      message: "A little sleepy today. A short break would feel lovely.",
    },
    sick: {
      color: "#fb8c00",
      label: "Not so good",
      message: "I'm not feeling my best. Could we take a breather together?",
    },
    asleep: {
      color: "#e53935",
      label: "Resting",
      message: "I'm worn out and need to rest. I'm here whenever you're ready.",
    },
  };

  function getStage(health) {
    if (health >= 80) return "happy";
    if (health >= 50) return "tired";
    if (health >= 20) return "sick";
    return "asleep";
  }

  function stageInfo(health) {
    const value = Number.isFinite(health) ? Math.min(100, Math.max(0, health)) : 100;
    const stage = getStage(value);
    return { stage, health: value, ...STAGES[stage] };
  }

  function eyes(stage) {
    if (stage === "happy") {
      return `<circle cx="76" cy="37" r="3.6" fill="#f08a24"/><circle cx="76.6" cy="37" r="1.8" fill="#222"/><circle cx="77.4" cy="36" r="0.7" fill="#fff"/>`;
    }
    if (stage === "tired") {
      return `<circle cx="76" cy="38" r="3.6" fill="#f08a24"/><circle cx="76.6" cy="38.4" r="1.8" fill="#222"/><path d="M71.6 36.6 Q76 34 80.4 36.6 L80.4 38 L71.6 38 Z" fill="#8e98a3"/><path d="M71.6 37.4 L80.4 37.4" stroke="#555" stroke-width="1" stroke-linecap="round"/>`;
    }
    if (stage === "sick") {
      return `<path d="M72.5 35.5 L79.5 40.5 M79.5 35.5 L72.5 40.5" stroke="#444" stroke-width="2" stroke-linecap="round"/>`;
    }
    return `<path d="M72 38 Q76 41.5 80 38" stroke="#444" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  }

  function extras(stage) {
    if (stage === "happy") {
      return `<circle cx="70" cy="44" r="3" fill="#f4a3b0" opacity="0.7"/>`;
    }
    if (stage === "sick") {
      return `<path d="M88 22 Q91 27 88 29 Q85 27 88 22 Z" fill="#7ec8e3"/><path d="M60 26 Q63 24 66 26" stroke="#7a8f6a" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
    }
    if (stage === "asleep") {
      return `<text x="84" y="26" font-size="12" font-weight="bold" fill="#6b7a99" font-family="sans-serif">z</text><text x="91" y="15" font-size="9" font-weight="bold" fill="#8c9ab8" font-family="sans-serif">z</text>`;
    }
    return "";
  }

  function pigeonSVG(stage) {
    const body = { happy: "#9aa3ad", tired: "#9aa3ad", sick: "#a7b79b", asleep: "#8f98a8" }[stage] || "#9aa3ad";
    const wing = { happy: "#7f8893", tired: "#7f8893", sick: "#8c9c80", asleep: "#767f90" }[stage] || "#7f8893";
    const droop = stage === "sick" || stage === "asleep" ? ' transform="rotate(6 72 40)"' : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Pigeon, ${stage}">
  <path d="M22 58 L4 50 L6 66 Z" fill="${wing}"/>
  <ellipse cx="48" cy="62" rx="30" ry="21" fill="${body}"/>
  <ellipse cx="50" cy="70" rx="20" ry="11" fill="#c3cad1" opacity="0.7"/>
  <path d="M26 60 Q42 46 64 62 Q46 78 26 60 Z" fill="${wing}"/>
  <path d="M30 60 L58 61" stroke="#59606b" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
  <g${droop}>
    <ellipse cx="66" cy="50" rx="9" ry="8" fill="#6fae9a"/>
    <ellipse cx="64" cy="52" rx="5" ry="4" fill="#9a7fb8" opacity="0.6"/>
    <circle cx="73" cy="39" r="14" fill="${body}"/>
    <path d="M85 36 L97 41 L85 45 Z" fill="#e9a96b"/>
    <circle cx="86" cy="38" r="1.6" fill="#f1ede6"/>
    ${eyes(stage)}
    ${extras(stage)}
  </g>
  <path d="M42 82 L40 92 M37 92 L43 92 M54 82 L55 92 M52 92 L58 92" stroke="#e07a8a" stroke-width="2.2" stroke-linecap="round" fill="none"/>
</svg>`;
  }

  globalThis.Pause.pet = { STAGES, getStage, stageInfo, pigeonSVG };
})();
