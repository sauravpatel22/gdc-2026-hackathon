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

  // Eye center is (91, 53) on the terrapin's head.
  function eyes(stage) {
    if (stage === "happy") {
      return `<circle cx="91" cy="53" r="3.2" fill="#fff"/><circle cx="91.8" cy="53" r="1.9" fill="#222"/><circle cx="92.4" cy="52.2" r="0.7" fill="#fff"/>`;
    }
    if (stage === "tired") {
      return `<circle cx="91" cy="53.6" r="3.2" fill="#fff"/><circle cx="91.8" cy="54" r="1.9" fill="#222"/><path d="M87.6 52.2 Q91 50 94.6 52.2 L94.6 53.6 L87.6 53.6 Z" fill="#7d8a5a"/>`;
    }
    if (stage === "sick") {
      return `<path d="M88.5 50.5 L94 56 M94 50.5 L88.5 56" stroke="#444" stroke-width="1.8" stroke-linecap="round"/>`;
    }
    return `<path d="M88 53.5 Q91 56 94.4 53.5" stroke="#333" stroke-width="1.8" fill="none" stroke-linecap="round"/>`;
  }

  function mouth(stage) {
    if (stage === "happy") return `<path d="M90 60 Q94.5 63.5 98 59.5" stroke="#4a3b22" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
    if (stage === "sick") return `<path d="M90.5 61.5 Q94 59.5 97.5 61.5" stroke="#4a3b22" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
    return `<path d="M90.5 60.5 L97 60.5" stroke="#4a3b22" stroke-width="1.5" fill="none" stroke-linecap="round"/>`;
  }

  function extras(stage) {
    if (stage === "happy") {
      return `<circle cx="86" cy="58.5" r="2.6" fill="#f4a3b0" opacity="0.7"/>`;
    }
    if (stage === "sick") {
      return `<path d="M96 38 Q99 43 96 45 Q93 43 96 38 Z" fill="#7ec8e3"/>`;
    }
    if (stage === "asleep") {
      return `<text x="80" y="42" font-size="12" font-weight="bold" fill="#6b7a99" font-family="sans-serif">z</text><text x="87" y="32" font-size="9" font-weight="bold" fill="#8c9ab8" font-family="sans-serif">z</text>`;
    }
    return "";
  }

  // Testudo, the University of Maryland's diamondback terrapin.
  function mascotSVG(stage) {
    const skin = { happy: "#b9a77a", tired: "#b9a77a", sick: "#a9b88a", asleep: "#a89c7c" }[stage] || "#b9a77a";
    const shell = { happy: "#e21833", tired: "#d3243a", sick: "#c4485a", asleep: "#b52a3c" }[stage] || "#e21833";
    const gold = "#ffd520";
    const droop = stage === "sick" || stage === "asleep" ? ' transform="rotate(8 78 62)"' : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" role="img" aria-label="Testudo the terrapin, ${stage}">
  <path d="M7 68 L0 73 L8 73 Z" fill="${skin}"/>
  <ellipse cx="22" cy="77" rx="7" ry="5" fill="${skin}"/>
  <ellipse cx="62" cy="77" rx="7" ry="5" fill="${skin}"/>
  <path d="M10 66 Q10 26 43 26 Q76 26 76 66 Z" fill="${shell}"/>
  <path d="M30 38 L56 38 L63 53 L43 62 L23 53 Z" fill="none" stroke="${gold}" stroke-width="2.2" stroke-linejoin="round"/>
  <path d="M30 38 L24 28 M56 38 L62 28 M63 53 L74 54 M23 53 L12 54 M43 62 L43 66" stroke="${gold}" stroke-width="2" stroke-linecap="round" fill="none"/>
  <path d="M6 64 L80 64 Q80 74 72 74 L14 74 Q6 74 6 64 Z" fill="${gold}"/>
  <path d="M6 64 L80 64" stroke="#b8860b" stroke-width="1.2" opacity="0.6"/>
  <g${droop}>
    <ellipse cx="78" cy="62" rx="8" ry="7" fill="${skin}"/>
    <ellipse cx="88" cy="56" rx="10.5" ry="9" fill="${skin}"/>
    <path d="M80 52 Q86 48 92 49" stroke="#6f6140" stroke-width="1.2" fill="none" opacity="0.5" stroke-linecap="round"/>
    ${eyes(stage)}
    ${mouth(stage)}
    ${extras(stage)}
  </g>
</svg>`;
  }

  globalThis.Pause.pet = { STAGES, getStage, stageInfo, mascotSVG };
})();
