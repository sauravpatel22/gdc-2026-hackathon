const PRIVACY = {
  local: "🔒 Everything here stays on your device.",
  remote: "🔒 Your history is stored on your Testudo server.",
};
const ARMED_LABEL = "Tap again to delete everything";
const ARMED_NOTE =
  "This removes your dashboard history. Your current day in the extension isn't affected.";
const RESET_MS = 5000;

const EXPORTS = [
  ["Download all (JSON)", "/api/export?format=json"],
  ["Daily history (CSV)", "/api/export?format=csv&table=daily"],
  ["Raw events (CSV)", "/api/export?format=csv&table=events"],
];

export function renderFooter(el, healthResponse, { onDelete } = {}) {
  const deployment = healthResponse && healthResponse.deployment;
  const privacy = document.createElement("p");
  privacy.className = "footer-privacy";
  privacy.textContent = PRIVACY[deployment] || PRIVACY.local;

  const links = document.createElement("p");
  links.className = "footer-links";
  for (const [label, href] of EXPORTS) {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = label;
    links.append(a);
  }

  const del = document.createElement("button");
  del.type = "button";
  del.className = "footer-delete";
  del.textContent = "Delete my data";

  const note = document.createElement("p");
  note.className = "card-note";
  note.setAttribute("role", "status");
  note.hidden = true;

  let timer = null;
  const disarm = () => {
    clearTimeout(timer);
    timer = null;
    del.textContent = "Delete my data";
    del.classList.remove("armed");
    note.hidden = true;
  };

  del.addEventListener("click", async () => {
    if (!timer) {
      del.textContent = ARMED_LABEL;
      del.classList.add("armed");
      note.textContent = ARMED_NOTE;
      note.hidden = false;
      timer = setTimeout(disarm, RESET_MS);
      return;
    }
    clearTimeout(timer);
    timer = null;
    del.disabled = true;
    try {
      await (onDelete && onDelete());
      disarm();
    } catch {
      del.textContent = "Delete my data";
      del.classList.remove("armed");
      note.textContent = "Couldn't delete right now. Nothing was changed.";
      note.hidden = false;
    } finally {
      del.disabled = false;
    }
  });

  el.replaceChildren(privacy, links, del, note);
}
