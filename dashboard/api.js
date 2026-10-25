import { todayISO } from "./format.js";

export class OfflineError extends Error {
  constructor(message) {
    super(message);
    this.name = "OfflineError";
  }
}

// ?mock=1 serves fixtures from mock.js so the UI can be built without the backend.
export const MOCK = new URLSearchParams(location.search).has("mock");

const TIMEOUT_MS = 4000;
const opts = { includeDemo: false };

export function setIncludeDemo(on) {
  opts.includeDemo = !!on;
}

export async function get(path, params = {}, { timeoutMs = TIMEOUT_MS } = {}) {
  const all = { today: todayISO(), include_demo: opts.includeDemo ? 1 : 0, ...params };
  for (const k of Object.keys(all)) if (all[k] == null) delete all[k];

  if (MOCK) {
    const mock = await import("./mock.js");
    return mock.handle(path, all);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${path}?${new URLSearchParams(all)}`, { signal: ctrl.signal });
    if (!res.ok) throw new OfflineError(`${path} returned ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err instanceof OfflineError) throw err;
    throw new OfflineError(err && err.message ? err.message : "network error");
  } finally {
    clearTimeout(timer);
  }
}
