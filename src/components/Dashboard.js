/**
 * Dashboard Screen
 * Main screen after sync — shows recent activities, awards, and sync controls.
 */

import { html } from "htm/preact";
import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { authState, disconnect } from "../auth.js";
import { incrementalSync, syncProgress, isSyncing } from "../sync.js";
import { computeAwardsForActivities } from "../awards.js";
import { getAllActivities, getAllSegments, getSyncState } from "../db.js";
import { navigate } from "../app.js";

const recentActivities = signal([]);
const activityAwards = signal(new Map());
const stats = signal({ segments: 0, awards: 0 });
const loading = signal(true);

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

function formatDistance(meters) {
  const km = meters / 1000;
  return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

const AWARD_LABELS = {
  year_best: { label: "Year Best", color: "bg-yellow-100 text-yellow-800" },
  season_first: { label: "Season First", color: "bg-green-100 text-green-800" },
  recent_best: { label: "Recent Best", color: "bg-blue-100 text-blue-800" },
};

async function loadDashboard() {
  loading.value = true;
  try {
    const activities = await getAllActivities();
    // Sort by date descending, take recent 20
    activities.sort((a, b) => b.start_date_local.localeCompare(a.start_date_local));
    const recent = activities.slice(0, 20);
    recentActivities.value = recent;

    // Compute awards for recent activities with efforts
    const withEfforts = recent.filter((a) => a.has_efforts);
    const awards = await computeAwardsForActivities(withEfforts);
    activityAwards.value = awards;

    // Stats
    const segments = await getAllSegments();
    let totalAwards = 0;
    for (const [, awardList] of awards) {
      totalAwards += awardList.length;
    }
    stats.value = { segments: segments.length, awards: totalAwards };
  } finally {
    loading.value = false;
  }
}

export function Dashboard() {
  const auth = authState.value;
  const progress = syncProgress.value;
  const syncing = isSyncing.value;

  useEffect(() => {
    loadDashboard();
  }, []);

  async function handleSync() {
    await incrementalSync();
    await loadDashboard();
  }

  async function handleDisconnect() {
    await disconnect();
    navigate("");
  }

  return html`
    <div class="min-h-screen bg-gray-50">
      <!-- Header -->
      <header class="bg-white border-b border-gray-200 px-6 py-4">
        <div class="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 class="text-xl font-bold text-gray-800">Participation Awards</h1>
            ${auth && html`
              <p class="text-sm text-gray-500">${auth.athlete.firstname} ${auth.athlete.lastname}</p>
            `}
          </div>
          <div class="flex items-center gap-3">
            <button
              onClick=${handleSync}
              disabled=${syncing}
              class="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
            >
              ${syncing && html`
                <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
              `}
              ${syncing ? "Syncing..." : "Sync Now"}
            </button>
            <button
              onClick=${handleDisconnect}
              class="text-sm text-gray-500 hover:text-red-600 transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      </header>

      <main class="max-w-3xl mx-auto px-6 py-6">
        <!-- Sync status -->
        ${syncing && html`
          <div class="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 mb-6 text-sm text-blue-700">
            ${progress.message}
          </div>
        `}

        <!-- Stats -->
        <div class="grid grid-cols-2 gap-4 mb-6">
          <div class="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div class="text-3xl font-bold text-gray-800">${stats.value.segments}</div>
            <div class="text-sm text-gray-500">Segments tracked</div>
          </div>
          <div class="bg-white rounded-xl border border-gray-200 p-4 text-center">
            <div class="text-3xl font-bold text-gray-800">${stats.value.awards}</div>
            <div class="text-sm text-gray-500">Awards (recent 20)</div>
          </div>
        </div>

        <!-- Loading -->
        ${loading.value && html`
          <div class="text-center py-12 text-gray-400">Loading activities...</div>
        `}

        <!-- Activity list -->
        ${!loading.value && html`
          <div class="space-y-3">
            <h2 class="text-lg font-semibold text-gray-800">Recent Activities</h2>
            ${recentActivities.value.map((activity) => {
              const awards = activityAwards.value.get(activity.id) || [];
              return html`
                <button
                  key=${activity.id}
                  onClick=${() => navigate(`activity/${activity.id}`)}
                  class="w-full text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors"
                >
                  <div class="flex items-start justify-between">
                    <div>
                      <div class="font-medium text-gray-800">${activity.name}</div>
                      <div class="text-sm text-gray-500 mt-1">
                        ${formatDate(activity.start_date_local)}
                        · ${formatDistance(activity.distance)}
                        · ${formatTime(activity.moving_time)}
                      </div>
                    </div>
                    ${awards.length > 0 && html`
                      <div class="flex flex-wrap gap-1 ml-3">
                        ${awards.map(
                          (a) => html`
                            <span class="text-xs px-2 py-0.5 rounded-full ${AWARD_LABELS[a.type]?.color || 'bg-gray-100 text-gray-600'}">
                              ${AWARD_LABELS[a.type]?.label || a.type}
                            </span>
                          `
                        )}
                      </div>
                    `}
                  </div>
                  ${!activity.has_efforts && html`
                    <div class="text-xs text-gray-400 mt-2">Details not yet loaded</div>
                  `}
                </button>
              `;
            })}
          </div>
        `}

        <!-- Powered by Strava -->
        <div class="text-center mt-12 mb-6">
          <p class="text-xs text-gray-400">Powered by Strava</p>
        </div>
      </main>
    </div>
  `;
}
