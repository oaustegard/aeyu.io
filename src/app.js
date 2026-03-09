/**
 * Participation Awards — Main App Component
 * Hash-based routing, auth state management, Preact + HTM + Signals
 */

import { html } from "htm/preact";
import { render, Component } from "preact";
import { signal, effect } from "@preact/signals";
import { authState, initAuth } from "./auth.js";
import { checkDemo, isDemo } from "./demo.js";
import { initInstallDetection } from "./install.js";
import { Landing } from "./components/Landing.js";
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

// --- Error Boundary ---

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Render error:", error, info);
  }

  render() {
    if (this.state.error) {
      return html`
        <div class="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
          <p style="color: var(--text-secondary); font-family: var(--font-body);">
            Something went wrong while loading the app.
          </p>
          <p style="color: var(--text-tertiary); font-family: var(--font-mono); font-size: 0.75rem; max-width: 400px; word-break: break-word;">
            ${this.state.error.message || "Unknown error"}
          </p>
          <button
            onClick=${() => {
              this.setState({ error: null });
              window.location.reload();
            }}
            style="background: var(--strava); color: white; padding: 0.5rem 1.5rem; border-radius: 0.5rem; border: none; cursor: pointer; font-family: var(--font-body);"
          >Reload</button>
        </div>
      `;
    }
    return this.props.children;
  }
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
    case "activity":
      return html`<${ActivityDetail} id=${routeParams.value.id} />`;
    case "sync": // legacy — now handled by dashboard
    case "dashboard":
    default:
      return auth ? html`<${Dashboard} />` : html`<${Landing} />`;
  }
}

// --- Init ---

function safeRender() {
  try {
    render(
      html`<${ErrorBoundary}><${App} /></${ErrorBoundary}>`,
      document.getElementById("app")
    );
    window.__appRendered = true;
  } catch (err) {
    console.error("Render failed:", err);
    const app = document.getElementById("app");
    if (app) {
      app.innerHTML =
        '<div class="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">' +
        '<p style="color: var(--text-secondary); font-family: var(--font-body);">Failed to render the app.</p>' +
        '<p style="color: var(--text-tertiary); font-family: var(--font-mono); font-size: 0.75rem; max-width: 400px; word-break: break-word;">' +
        (err.message || "Unknown error") + "</p>" +
        '<button onclick="window.location.reload()" style="background: var(--strava); color: white; ' +
        'padding: 0.5rem 1.5rem; border-radius: 0.5rem; border: none; cursor: pointer; ' +
        'font-family: var(--font-body);">Reload</button></div>';
    }
  }
}

async function init() {
  try {
    initInstallDetection();
  } catch (err) {
    console.error("Install detection error:", err);
  }

  try {
    await initAuth();
  } catch (err) {
    console.error("Auth init error:", err);
  }

  try {
    await checkDemo();
  } catch (err) {
    console.error("Demo check error:", err);
  }

  safeRender();

  // Re-render on auth and route changes
  effect(() => {
    const _ = authState.value;
    const __ = route.value;
    const ___ = routeParams.value;
    const ____ = isDemo.value;
    safeRender();
  });
}

// Signal that the module loaded (even if init hasn't finished yet)
window.__appModuleLoaded = true;

init();
