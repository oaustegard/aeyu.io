/**
 * Activity Detail Screen
 * Shows all segment efforts for an activity with award indicators.
 */

import { html } from "htm/preact";
import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { getActivity, getSegment } from "../db.js";
import { computeAwards } from "../awards.js";
import { navigate } from "../app.js";

const activity = signal(null);
const awards = signal([]);
const segmentHistory = signal(new Map());
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
    year: "numeric",
  });
}

const AWARD_LABELS = {
  year_best: { label: "Year Best", color: "bg-yellow-100 text-yellow-800", icon: "★" },
  season_first: { label: "Season First", color: "bg-green-100 text-green-800", icon: "🌱" },
  recent_best: { label: "Recent Best", color: "bg-blue-100 text-blue-800", icon: "↑" },
};

async function loadActivity(id) {
  loading.value = true;
  try {
    const act = await getActivity(Number(id));
    if (!act) return;
    activity.value = act;

    if (act.has_efforts) {
      const awardsList = await computeAwards(act);
      awards.value = awardsList;

      // Load segment history for each effort
      const history = new Map();
      for (const effort of act.segment_efforts || []) {
        const seg = await getSegment(effort.segment.id);
        if (seg) {
          history.set(effort.segment.id, seg);
        }
      }
      segmentHistory.value = history;
    }
  } finally {
    loading.value = false;
  }
}

export function ActivityDetail({ id }) {
  useEffect(() => {
    if (id) loadActivity(id);
  }, [id]);

  const act = activity.value;

  if (loading.value) {
    return html`
      <div class="min-h-screen bg-gray-50 flex items-center justify-center">
        <p class="text-gray-400">Loading activity...</p>
      </div>
    `;
  }

  if (!act) {
    return html`
      <div class="min-h-screen bg-gray-50 flex items-center justify-center">
        <div class="text-center">
          <p class="text-gray-500">Activity not found</p>
          <button onClick=${() => navigate("dashboard")} class="mt-4 text-blue-600 hover:underline">
            Back to dashboard
          </button>
        </div>
      </div>
    `;
  }

  // Build a map of segment_id → awards for this effort
  const effortAwards = new Map();
  for (const award of awards.value) {
    if (!effortAwards.has(award.segment_id)) {
      effortAwards.set(award.segment_id, []);
    }
    effortAwards.get(award.segment_id).push(award);
  }

  return html`
    <div class="min-h-screen bg-gray-50">
      <!-- Header -->
      <header class="bg-white border-b border-gray-200 px-6 py-4">
        <div class="max-w-3xl mx-auto">
          <button onClick=${() => navigate("dashboard")} class="text-sm text-blue-600 hover:underline mb-2 block">
            ← Back to dashboard
          </button>
          <h1 class="text-xl font-bold text-gray-800">${act.name}</h1>
          <p class="text-sm text-gray-500">
            ${formatDate(act.start_date_local)}
            · ${formatDistance(act.distance)}
            · ${formatTime(act.moving_time)}
            ${act.total_elevation_gain ? ` · ${Math.round(act.total_elevation_gain)}m elevation` : ""}
          </p>
        </div>
      </header>

      <main class="max-w-3xl mx-auto px-6 py-6">
        <!-- Awards summary -->
        ${awards.value.length > 0 && html`
          <div class="bg-white rounded-xl border border-gray-200 p-4 mb-6">
            <h2 class="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Awards Earned</h2>
            <div class="space-y-2">
              ${awards.value.map(
                (award) => html`
                  <div class="flex items-start gap-3 p-2 rounded-lg bg-gray-50">
                    <span class="text-lg">${AWARD_LABELS[award.type]?.icon || "•"}</span>
                    <div>
                      <span class="text-xs px-2 py-0.5 rounded-full ${AWARD_LABELS[award.type]?.color || 'bg-gray-100'}">
                        ${AWARD_LABELS[award.type]?.label || award.type}
                      </span>
                      <p class="text-sm text-gray-700 mt-1">${award.message}</p>
                    </div>
                  </div>
                `
              )}
            </div>
          </div>
        `}

        <!-- Segment efforts -->
        ${act.has_efforts && act.segment_efforts && act.segment_efforts.length > 0 && html`
          <h2 class="text-lg font-semibold text-gray-800 mb-3">Segment Efforts</h2>
          <div class="space-y-3">
            ${act.segment_efforts.map((effort) => {
              const seg = segmentHistory.value.get(effort.segment.id);
              const segAwards = effortAwards.get(effort.segment.id) || [];
              const effortCount = seg ? seg.efforts.length : 0;

              return html`
                <div class="bg-white rounded-xl border border-gray-200 p-4">
                  <div class="flex items-start justify-between">
                    <div>
                      <div class="font-medium text-gray-800">${effort.segment.name}</div>
                      <div class="text-sm text-gray-500 mt-1">
                        ${formatDistance(effort.segment.distance)}
                        · ${effort.segment.average_grade}% grade
                        · ${formatTime(effort.elapsed_time)}
                      </div>
                      ${effortCount > 1 && html`
                        <div class="text-xs text-gray-400 mt-1">
                          ${effortCount} total efforts on this segment
                        </div>
                      `}
                    </div>
                    ${segAwards.length > 0 && html`
                      <div class="flex flex-wrap gap-1 ml-3">
                        ${segAwards.map(
                          (a) => html`
                            <span class="text-xs px-2 py-0.5 rounded-full ${AWARD_LABELS[a.type]?.color || 'bg-gray-100'}">
                              ${AWARD_LABELS[a.type]?.icon || ""} ${AWARD_LABELS[a.type]?.label || a.type}
                            </span>
                          `
                        )}
                      </div>
                    `}
                  </div>

                  <!-- Strava PR indicator -->
                  ${effort.pr_rank && html`
                    <div class="mt-2 text-xs text-orange-600">
                      Strava PR #${effort.pr_rank}
                    </div>
                  `}
                </div>
              `;
            })}
          </div>
        `}

        ${!act.has_efforts && html`
          <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-700">
            Segment details have not been loaded yet for this activity. Run a sync to fetch them.
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
