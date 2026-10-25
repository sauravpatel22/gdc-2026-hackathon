// Classic script. Floating pigeon on web pages, inside a Shadow DOM so the
// host site's CSS can't touch it. Reads health straight from chrome.storage.
(() => {
  const pet = globalThis.Pause && globalThis.Pause.pet;
  if (!pet) return;

  const STYLE = `
    :host { all: initial; }
    .wrap {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 8px;
      font-family: -apple-system, system-ui, sans-serif;
    }
    .bird {
      width: 64px;
      height: 64px;
      padding: 0;
      border: 0;
      background: none;
      cursor: pointer;
      animation: bob 2.4s ease-in-out infinite;
      filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.25));
    }
    .bird svg { width: 100%; height: 100%; display: block; }
    .card {
      width: 220px;
      box-sizing: border-box;
      padding: 12px;
      border-radius: 12px;
      background: #fffaf3;
      color: #3a3a3a;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
      font-size: 13px;
      line-height: 1.4;
    }
    .card[hidden] { display: none; }
    .msg { margin: 0 0 10px; }
    .bar { height: 10px; border-radius: 5px; background: #ece6dc; overflow: hidden; }
    .fill { height: 100%; border-radius: 5px; transition: width 0.4s ease, background 0.4s ease; }
    .row { display: flex; justify-content: space-between; margin-top: 6px; font-size: 11px; font-weight: 600; }
    .hide {
      margin-top: 10px;
      padding: 0;
      border: 0;
      background: none;
      color: #7a7a7a;
      font-size: 11px;
      text-decoration: underline;
      cursor: pointer;
    }
    @keyframes bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
    @media (prefers-reduced-motion: reduce) { .bird { animation: none; } }
  `;

  let host = null;
  let refs = null;
  let shownStage = null;

  function build() {
    host = document.createElement("div");
    host.id = "pausepet-root";
    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `
      <style>${STYLE}</style>
      <div class="wrap">
        <div class="card" hidden>
          <p class="msg"></p>
          <div class="bar"><div class="fill"></div></div>
          <div class="row"><span class="num"></span><span class="label"></span></div>
          <button class="hide" type="button">Hide my pigeon</button>
        </div>
        <button class="bird" type="button" aria-label="Open PausePet"></button>
      </div>`;

    refs = {
      card: root.querySelector(".card"),
      msg: root.querySelector(".msg"),
      fill: root.querySelector(".fill"),
      num: root.querySelector(".num"),
      label: root.querySelector(".label"),
      bird: root.querySelector(".bird"),
      hide: root.querySelector(".hide"),
    };

    refs.bird.addEventListener("click", (e) => {
      e.stopPropagation();
      refs.card.hidden = !refs.card.hidden;
    });
    // Click anywhere else on the page to tuck the card away.
    document.addEventListener("click", (e) => {
      if (!refs.card.hidden && !e.composedPath().includes(host)) refs.card.hidden = true;
    });
    refs.hide.addEventListener("click", () => {
      try {
        chrome.storage.local.set({ petHidden: true });
      } catch (_) {}
    });

    document.documentElement.appendChild(host);
  }

  function render(state) {
    const hidden = !!state.petHidden;
    if (hidden) {
      if (host) {
        host.remove();
        host = null;
        refs = null;
        shownStage = null;
      }
      return;
    }
    if (!host) build();

    const health = typeof state.health === "number" ? state.health : 100;
    const info = pet.stageInfo(health);
    if (shownStage !== info.stage) {
      refs.bird.innerHTML = pet.pigeonSVG(info.stage);
      shownStage = info.stage;
    }
    refs.msg.textContent = info.message;
    refs.fill.style.width = `${info.health}%`;
    refs.fill.style.background = info.color;
    refs.num.textContent = `${Math.round(info.health)} / 100`;
    refs.label.textContent = info.label;
    refs.label.style.color = info.color;
  }

  async function refresh() {
    try {
      render(await chrome.storage.local.get(["health", "petHidden"]));
    } catch (_) {
      // Extension was reloaded; leave the page alone.
    }
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && (changes.health || changes.petHidden)) refresh();
    });
  } catch (_) {}

  refresh();
})();
