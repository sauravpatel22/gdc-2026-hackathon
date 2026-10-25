import { getState } from "./storage.js";

const state = await getState();
document.getElementById("status").textContent =
  `Hi there. Health: ${state.health}`;
