/**
 * Participation Awards — Main App Component
 * Path-based routing (History API), auth state management, Preact + HTM + Signals
 */

import { html } from "htm/preact";
import { render, Component } from "preact";
import { signal, effect } from "@preact/signals";
import { authState, initAuth } from "./auth.js";
import { checkDemo, isDemo, startDemo, exitDemo } from "./demo.js";
import { initInstallDetection } from "./install.js";
import { initTouchTooltips } from "./touch-tooltip.js";
import { Landing } from "./components/Landing.js";
import { Dashboard } from "./components/Dashboard.js";
import { ActivityDetail } from "./components/ActivityDetail.js";

// --- Router ---

function parsePath() {
  const path = window.location.pathname.replace(/\.html$/, "").replace(/^\//, "") || "";
  const params = Object.fromEntries(new URLSearchParams(window.location.search));
  return { path, params };
}

const initial = parsePath();
export const route = signal(initial.path);
export const routeParams = signal(initial.params);

// Handle legacy hash-based URLs: redirect #route to /route
(function migrateHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return;
  const parts = hash.split("/");
  const path = "/" + (parts[0] || "");
  const query = parts[1] ? "?id=" + parts[1] : "";
  history.replaceState(null, "", path + query);
  const updated = parsePath();
  route.value = updated.path;
  routeParams.value = updated.params;
})();

window.addEventListener("popstate", () => {
  const { path, params } = parsePath();
  route.value = path;
  routeParams.value = params;
});

export function navigate(url) {
  history.pushState(null, "", url);
  const { path, params } = parsePath();
  route.value = path;
  routeParams.value = params;
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

  // If demo is active but user navigated away from /demo, exit demo mode
  // and let the app re-render with the real auth state.
  if (currentRoute !== "demo" && isDemo.value) {
    exitDemo();
    return null;
  }

  // /demo is always accessible — start demo if needed
  if (currentRoute === "demo") {
    if (isDemo.value) return html`<${Dashboard} key="demo" />`;
    startDemo().then(() => safeRender());
    return html`<div class="min-h-screen flex items-center justify-center"
      style="color: var(--text-secondary); font-family: var(--font-body);">Loading demo…</div>`;
  }

  // All other routes require auth — redirect to landing
  if (!auth) {
    if (currentRoute !== "") navigate("/");
    return html`<${Landing} />`;
  }

  // Authenticated routes
  switch (currentRoute) {
    case "activity":
      return html`<${ActivityDetail} id=${routeParams.value.id} />`;
    case "sync": // legacy — now handled by dashboard
    case "dashboard":
    default:
      return html`<${Dashboard} key="real" />`;
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
    initTouchTooltips();
  } catch (err) {
    console.error("Touch tooltip init error:", err);
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
