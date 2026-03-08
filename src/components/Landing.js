/**
 * Landing / Connect Screen
 * Shows app branding and "Connect with Strava" button.
 */

import { html } from "htm/preact";
import { startOAuth } from "../auth.js";

export function Landing() {
  return html`
    <div class="min-h-screen bg-gray-50 flex items-center justify-center px-6">
      <div class="text-center max-w-lg">
        <h1 class="text-6xl font-bold mb-2">
          <span class="gradient-text">aeyu.io</span>
        </h1>
        <p class="text-lg text-gray-500 italic mb-8 group relative inline-block cursor-help">
          The sound you make at the top of the climb
          <span class="invisible group-hover:visible absolute left-1/2 -translate-x-1/2 top-full mt-2 bg-gray-800 text-white text-xs rounded px-3 py-2 whitespace-nowrap z-10">
            It's Norwegian — like "ow" but with more suffering
          </span>
        </p>

        <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-8 mb-8">
          <h2 class="text-2xl font-semibold text-gray-800 mb-2">Participation Awards</h2>
          <p class="text-gray-600 mb-6">
            Giving recognition for efforts where effort was given.
            Connect your Strava to discover year bests, season firsts,
            and personal milestones that Strava doesn't celebrate.
          </p>

          <button
            onClick=${() => startOAuth()}
            class="inline-flex items-center gap-2 bg-[#FC4C02] hover:bg-[#e04400] text-white font-semibold px-6 py-3 rounded-lg transition-colors"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169"/>
            </svg>
            Connect with Strava
          </button>
        </div>

        <div class="text-xs text-gray-400 space-y-1">
          <p class="font-medium text-gray-500">
            100% client-side — your data never touches our servers.
          </p>
          <p>
            Strava's authorization screen asks to share data with this app,
            but all data flows directly from Strava to your browser.
            We have no server, no database, no analytics.
            Nothing leaves your device.
          </p>
        </div>
      </div>
    </div>
  `;
}
