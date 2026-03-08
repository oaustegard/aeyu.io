/**
 * Sync Progress Screen
 * Shows during initial backfill with progress, rate limits, and resume info.
 */

import { html } from "htm/preact";
import { useEffect } from "preact/hooks";
import { syncProgress, rateLimitStatus, isSyncing, startBackfill } from "../sync.js";
import { authState } from "../auth.js";
import { navigate } from "../app.js";

export function SyncProgress() {
  const progress = syncProgress.value;
  const rateLimit = rateLimitStatus.value;
  const syncing = isSyncing.value;
  const auth = authState.value;

  useEffect(() => {
    if (!syncing && progress.phase === "idle") {
      startBackfill().catch((err) => console.error("Backfill error:", err));
    }
  }, []);

  const shortPct = rateLimit.shortLimit
    ? Math.round((rateLimit.shortUsage / rateLimit.shortLimit) * 100)
    : 0;
  const dailyPct = rateLimit.dailyLimit
    ? Math.round((rateLimit.dailyUsage / rateLimit.dailyLimit) * 100)
    : 0;

  const detailPct =
    progress.detailTotal && progress.detailTotal > 0
      ? Math.round((progress.detailed / progress.detailTotal) * 100)
      : 0;

  const isThrottled = shortPct > 80 || dailyPct > 80;

  return html`
    <div class="min-h-screen bg-gray-50 flex items-center justify-center px-6">
      <div class="max-w-lg w-full">
        <div class="text-center mb-6">
          <h1 class="text-3xl font-bold text-gray-800 mb-1">Syncing your activities</h1>
          ${auth && html`
            <p class="text-gray-500">Welcome, ${auth.athlete.firstname}!</p>
          `}
        </div>

        <!-- Explainer header -->
        <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-sm text-amber-800">
          <p class="font-medium mb-1">Why is this slow?</p>
          <p class="text-amber-700">
            Your activity data is stored entirely in your browser — we have
            no server or database. That means we fetch everything directly
            from Strava's API on your behalf, one page at a time.
            Strava limits apps to${" "}
            <strong>100 requests per 15 minutes</strong> and${" "}
            <strong>1,000 per day</strong>, so a large history takes a
            few sessions to fully load. You can close this page and come
            back — we'll pick up where we left off.
          </p>
        </div>

        <div class="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          <!-- Phase indicator -->
          <div class="flex items-center gap-3 mb-4">
            ${syncing && html`
              <div class="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            `}
            <p class="text-gray-700 font-medium">${progress.message || "Preparing..."}</p>
          </div>

          <!-- Progress bar for detail phase -->
          ${progress.phase === "detail" && progress.detailTotal && html`
            <div class="mb-4">
              <div class="flex justify-between text-sm text-gray-500 mb-1">
                <span>Activity details</span>
                <span>${progress.detailed} / ${progress.detailTotal}</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2">
                <div
                  class="bg-blue-500 h-2 rounded-full transition-all duration-300"
                  style="width: ${detailPct}%"
                ></div>
              </div>
            </div>
          `}

          <!-- Stats -->
          <div class="grid grid-cols-2 gap-4 text-center text-sm">
            <div class="bg-gray-50 rounded-lg p-3">
              <div class="text-2xl font-bold text-gray-800">${progress.fetched}</div>
              <div class="text-gray-500">Activities found</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-3">
              <div class="text-2xl font-bold text-gray-800">${progress.detailed}</div>
              <div class="text-gray-500">Details loaded</div>
            </div>
          </div>
        </div>

        <!-- Rate limit indicator -->
        ${(shortPct > 0 || dailyPct > 0) && html`
          <div class="bg-white rounded-xl shadow-sm border ${isThrottled ? 'border-amber-300' : 'border-gray-200'} p-4 mb-4">
            <div class="flex items-center justify-between mb-2">
              <p class="text-xs text-gray-500 font-medium">Strava API usage</p>
              ${isThrottled && html`
                <span class="text-xs text-amber-600 font-medium">Throttling to stay within limits</span>
              `}
            </div>
            <div class="flex gap-4 text-xs">
              <div class="flex-1">
                <div class="flex justify-between text-gray-500 mb-1">
                  <span>15-min</span>
                  <span>${rateLimit.shortUsage}/${rateLimit.shortLimit}</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    class="h-1.5 rounded-full transition-all ${shortPct > 80 ? 'bg-red-500' : 'bg-green-500'}"
                    style="width: ${shortPct}%"
                  ></div>
                </div>
              </div>
              <div class="flex-1">
                <div class="flex justify-between text-gray-500 mb-1">
                  <span>Daily</span>
                  <span>${rateLimit.dailyUsage}/${rateLimit.dailyLimit}</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    class="h-1.5 rounded-full transition-all ${dailyPct > 80 ? 'bg-red-500' : 'bg-green-500'}"
                    style="width: ${dailyPct}%"
                  ></div>
                </div>
              </div>
            </div>
          </div>
        `}

        <p class="text-center text-sm text-gray-400 mb-4">
          You can close this tab — we'll pick up where we left off.
        </p>

        ${progress.phase === "done" && html`
          <div class="text-center">
            <button
              onClick=${() => navigate("dashboard")}
              class="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
            >
              View Dashboard
            </button>
          </div>
        `}

        <!-- Powered by Strava -->
        <div class="text-center mt-8">
          <p class="text-xs text-gray-400">Powered by Strava</p>
        </div>
      </div>
    </div>
  `;
}
