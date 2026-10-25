import { getState, setState, getDefaultState } from "./storage.js";

chrome.runtime.onInstalled.addListener(async () => {
  const state = await getState();
  await setState(state);
  console.log("PausePet installed");
});
