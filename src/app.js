/**
 * Participation Awards — Main App Component
 * Hash-based routing, auth state management, Preact + HTM + Signals
 */

import { html } from "htm/preact";
import { render } from "preact";
import { signal, effect } from "@preact/signals";
import { authState, initAuth } from "./auth.js";
import { Landing } from "./components/Landing.js";
import { SyncProgress } from "./components/SyncProgress.js";
import { Dashboard } from "./components/Dashboard.js";
import { ActivityDetail } from "./components/ActivityDetail.js";

// --- Router ---

export const route = signal(parseHash());
export const routeParams = signal({});

function parseHash() {
  const hash = window.location.hash.slice(1) || "";
  const [path, ...rest] = hash.split("/");
  return path || "";
}

window.addEventListener("hashchange", () => {
  const hash = window.location.hash.slice(1) || "";
  const parts = hash.split("/");
  route.value = parts[0] || "";
  routeParams.value = { id: parts[1] || null };
});

export function navigate(path) {
  window.location.hash = path;
}

// --- App ---

function App() {
  const auth = authState.value;
  const currentRoute = route.value;

  // Not authenticated — show landing
  if (!auth && currentRoute !== "callback") {
    return html`<${Landing} />`;
  }

  // Route based on hash
  switch (currentRoute) {
    case "sync":
      return html`<${SyncProgress} />`;
    case "activity":
      return html`<${ActivityDetail} id=${routeParams.value.id} />`;
    case "dashboard":
    default:
      return auth ? html`<${Dashboard} />` : html`<${Landing} />`;
  }
}

// --- Init ---

async function init() {
  await initAuth();
  render(html`<${App} />`, document.getElementById("app"));

  // Re-render on auth and route changes
  effect(() => {
    const _ = authState.value;
    const __ = route.value;
    const ___ = routeParams.value;
    render(html`<${App} />`, document.getElementById("app"));
  });
}

init();
