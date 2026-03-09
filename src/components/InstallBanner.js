/**
 * InstallBanner — Mobile install interstitial for Landing page.
 * Guides mobile browser visitors to install the PWA before logging in,
 * preventing the "double sync" problem (browser and PWA have separate IndexedDB).
 */

import { html } from "htm/preact";
import {
  installContext,
  triggerInstall,
  dismissInstallBanner,
} from "../install.js";

function ShareIcon() {
  return html`
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block align-text-bottom" style="color: var(--accent);">
      <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8"/>
      <polyline points="16 6 12 2 8 6"/>
      <line x1="12" y1="2" x2="12" y2="15"/>
    </svg>
  `;
}

function IOSInstructions() {
  return html`
    <div class="space-y-3 text-left">
      <div class="flex items-start gap-3">
        <span class="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold" style="background: var(--accent); color: white;">1</span>
        <p style="font-size: 15px; color: var(--text-secondary);">
          Tap the Share button <${ShareIcon} /> at the bottom of Safari
        </p>
      </div>
      <div class="flex items-start gap-3">
        <span class="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold" style="background: var(--accent); color: white;">2</span>
        <p style="font-size: 15px; color: var(--text-secondary);">
          Scroll down and tap <span style="font-weight: 500; color: var(--text);">Add to Home Screen</span>
        </p>
      </div>
      <div class="flex items-start gap-3">
        <span class="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold" style="background: var(--accent); color: white;">3</span>
        <p style="font-size: 15px; color: var(--text-secondary);">
          Tap <span style="font-weight: 500; color: var(--text);">Add</span>, then open aeyu.io from your home screen
        </p>
      </div>
    </div>
  `;
}

function AndroidInstructions() {
  const ctx = installContext.value;

  if (ctx.deferredPrompt) {
    return html`
      <button
        onClick=${triggerInstall}
        class="inline-flex items-center gap-2 font-semibold px-6 py-3 rounded-lg transition-colors w-full justify-center"
        style="background: var(--text); color: var(--bg); font-family: var(--font-body);"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="7 10 12 15 17 10"/>
          <line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        Install App
      </button>
    `;
  }

  return html`
    <div class="space-y-3 text-left">
      <div class="flex items-start gap-3">
        <span class="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold" style="background: var(--accent); color: white;">1</span>
        <p style="font-size: 15px; color: var(--text-secondary);">
          Tap the <span style="font-weight: 500; color: var(--text);">&#8942;</span> menu in your browser
        </p>
      </div>
      <div class="flex items-start gap-3">
        <span class="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold" style="background: var(--accent); color: white;">2</span>
        <p style="font-size: 15px; color: var(--text-secondary);">
          Tap <span style="font-weight: 500; color: var(--text);">Install App</span> or <span style="font-weight: 500; color: var(--text);">Add to Home Screen</span>
        </p>
      </div>
      <div class="flex items-start gap-3">
        <span class="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold" style="background: var(--accent); color: white;">3</span>
        <p style="font-size: 15px; color: var(--text-secondary);">
          Open aeyu.io from your home screen
        </p>
      </div>
    </div>
  `;
}

export function InstallBanner() {
  const ctx = installContext.value;

  return html`
    <div class="text-center">
      <h3 class="mb-2" style="font-family: var(--font-display); font-size: 1.125rem; color: var(--text);">
        Install for the best experience
      </h3>
      <p class="mb-5" style="font-family: var(--font-body); font-size: 15px; color: var(--text-secondary);">
        Add aeyu.io to your home screen first, then connect
        Strava inside the app. This keeps your ride data
        with the app where it belongs.
      </p>

      <div class="mb-5 rounded-lg p-4" style="background: var(--bg); border: 1px solid var(--border-light);">
        ${ctx.platform === "ios" && html`<${IOSInstructions} />`}
        ${ctx.platform === "android" && html`<${AndroidInstructions} />`}
        ${ctx.platform === "other" && html`
          <p style="font-size: 15px; color: var(--text-secondary);">
            Use your browser's menu to install or add this page to your home screen,
            then open it from there.
          </p>
        `}
      </div>

      <button
        onClick=${dismissInstallBanner}
        class="transition-colors"
        style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-tertiary);"
      >
        Use in browser instead
      </button>
      <p class="mt-1" style="font-family: var(--font-body); font-size: 0.75rem; color: var(--text-tertiary);">
        You can always install later. If you do, you'll need to
        reconnect Strava and sync again — no data is lost,
        it just takes a few minutes.
      </p>
    </div>
  `;
}
