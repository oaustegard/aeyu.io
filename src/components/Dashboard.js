/**
 * Dashboard Screen
 * Main screen after login — shows recent activities, awards, sync controls,
 * and inline sync progress. Auto-triggers backfill for new users.
 *
 * Awards are deferred until initial backfill is complete so that comparative
 * awards (Year Best, Recent Best) have full segment history to work with.
 */

import { html } from "htm/preact";
import { signal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { authState, disconnect } from "../auth.js";
import {
  startBackfill,
  incrementalSync,
  syncProgress,
  rateLimitStatus,
  isSyncing,
} from "../sync.js";
import { computeAwardsForActivities } from "../awards.js";
import {
  getAllActivities,
  getAllSegments,
  getActivitiesWithoutEfforts,
  getSyncState,
  clearAllData,
  getResetEvent,
  setResetEvent,
  clearResetEvent,
  getUserConfig,
  setUserConfig,
} from "../db.js";
import { navigate } from "../app.js";
import {
  unitSystem,
  loadUnitPreference,
  setUnitPreference,
  formatDistance,
  formatTime,
  formatDateWeekday,
  formatElevation,
  formatPower,
} from "../units.js";
import { isDemo, exitDemo } from "../demo.js";

const recentActivities = signal([]);
const activityAwards = signal(new Map());
const stats = signal({ segments: 0, awards: 0 });
const loading = signal(true);
const backfillComplete = signal(false);
const showFaq = signal(false);
const deleteConfirmText = signal("");
const showDeleteConfirm = signal(false);
const activeResetEvent = signal(null);
const showResetForm = signal(false);
const resetName = signal("");
const resetDate = signal("");
const referencePoints = signal([]);
const showRefForm = signal(false);
const refType = signal("since_date");
const pendingCount = signal(0);
const refLabel = signal("");
const refDate = signal("");
const refCount = signal("10");
const refBirthday = signal("");
const refAge = signal("40");

const AWARD_LABELS = {
  year_best: { label: "Year Best", color: "bg-yellow-100 text-yellow-800" },
  season_first: { label: "Season First", color: "bg-green-100 text-green-800" },
  recent_best: { label: "Recent Best", color: "bg-blue-100 text-blue-800" },
  beat_median: { label: "Beat Median", color: "bg-purple-100 text-purple-800" },
  top_quartile: { label: "Top Quartile", color: "bg-indigo-100 text-indigo-800" },
  top_decile: { label: "Top 10%", color: "bg-red-100 text-red-800" },
  consistency: { label: "Metronome", color: "bg-teal-100 text-teal-800" },
  monthly_best: { label: "Monthly Best", color: "bg-orange-100 text-orange-800" },
  improvement_streak: { label: "On a Roll", color: "bg-emerald-100 text-emerald-800" },
  comeback: { label: "Comeback", color: "bg-rose-100 text-rose-800" },
  milestone: { label: "Milestone", color: "bg-amber-100 text-amber-800" },
  best_month_ever: { label: "Best Month Ever", color: "bg-fuchsia-100 text-fuchsia-800" },
  closing_in: { label: "Closing In", color: "bg-pink-100 text-pink-800" },
  anniversary: { label: "Anniversary", color: "bg-violet-100 text-violet-800" },
  distance_record: { label: "Longest Ride", color: "bg-cyan-100 text-cyan-800" },
  elevation_record: { label: "Most Climbing", color: "bg-sky-100 text-sky-800" },
  segment_count: { label: "Most Segments", color: "bg-lime-100 text-lime-800" },
  endurance_record: { label: "Longest by Time", color: "bg-slate-100 text-slate-800" },
  ytd_best_time: { label: "YTD Best", color: "bg-amber-200 text-amber-900" },
  ytd_best_power: { label: "YTD Power", color: "bg-red-200 text-red-900" },
  // Comeback mode awards (#60)
  comeback_pb: { label: "Comeback PB", color: "bg-rose-200 text-rose-900" },
  recovery_milestone: { label: "Recovery", color: "bg-orange-200 text-orange-900" },
  comeback_full: { label: "You're Back!", color: "bg-green-200 text-green-900" },
  comeback_distance: { label: "Comeback Distance", color: "bg-rose-100 text-rose-800" },
  comeback_elevation: { label: "Comeback Climbing", color: "bg-rose-100 text-rose-800" },
  comeback_endurance: { label: "Comeback Endurance", color: "bg-rose-100 text-rose-800" },
  reference_best: { label: "Reference Best", color: "bg-teal-200 text-teal-900" },
  // Route-level Season First (#59)
  route_season_first: { label: "Route Season First", color: "bg-green-200 text-green-900" },
  // Activity-level power awards (#45)
  season_first_power: { label: "First Power Ride", color: "bg-green-200 text-green-900" },
  np_year_best: { label: "NP Year Best", color: "bg-red-200 text-red-900" },
  np_recent_best: { label: "NP Recent Best", color: "bg-red-100 text-red-800" },
  work_year_best: { label: "Work Year Best", color: "bg-orange-200 text-orange-900" },
  work_recent_best: { label: "Work Recent Best", color: "bg-orange-100 text-orange-800" },
  peak_power: { label: "Peak Power", color: "bg-yellow-200 text-yellow-900" },
  peak_power_recent: { label: "Peak Recent", color: "bg-yellow-100 text-yellow-800" },
  // Indoor training awards (#46)
  indoor_np_year_best: { label: "Indoor NP Best", color: "bg-violet-200 text-violet-900" },
  indoor_work_year_best: { label: "Indoor Work Best", color: "bg-violet-100 text-violet-800" },
  trainer_streak: { label: "Trainer Streak", color: "bg-indigo-200 text-indigo-900" },
  indoor_vs_outdoor: { label: "Indoor vs Outdoor", color: "bg-sky-200 text-sky-900" },
};

async function loadDashboard() {
  loading.value = true;
  try {
    await loadUnitPreference();
    activeResetEvent.value = await getResetEvent();
    const userConfig = await getUserConfig();
    referencePoints.value = userConfig.referencePoints || [];
    const activities = await getAllActivities();
    // Sort by date descending, take recent 20
    activities.sort((a, b) => b.start_date_local.localeCompare(a.start_date_local));
    const recent = activities.slice(0, 20);
    recentActivities.value = recent;

    // Check sync completion state
    const state = await getSyncState();
    backfillComplete.value = state.backfill_complete;

    // Count activities awaiting detail fetch (no efforts yet)
    const pending = await getActivitiesWithoutEfforts();
    pendingCount.value = pending.length;

    // Always compute awards for activities that have efforts — even during
    // backfill. As more data syncs across sessions, segment histories grow
    // and award calculations become richer (medians, quartiles, streaks
    // all improve with more data). Awards recalculate after every sync.
    const withEfforts = recent.filter((a) => a.has_efforts);
    if (withEfforts.length > 0) {
      const awards = await computeAwardsForActivities(withEfforts);
      activityAwards.value = awards;

      let totalAwards = 0;
      for (const [, awardList] of awards) {
        totalAwards += awardList.length;
      }
      const segments = await getAllSegments();
      stats.value = { segments: segments.length, awards: totalAwards };
    } else {
      activityAwards.value = new Map();
      const segments = await getAllSegments();
      stats.value = { segments: segments.length, awards: 0 };
    }
  } finally {
    loading.value = false;
  }
}

export function Dashboard() {
  const auth = authState.value;
  const progress = syncProgress.value;
  const syncing = isSyncing.value;
  const rateLimit = rateLimitStatus.value;
  const units = unitSystem.value;

  useEffect(() => {
    async function init() {
      await loadDashboard();

      // Auto-trigger backfill if initial list sync isn't done
      const state = await getSyncState();
      if (!state.backfill_complete) {
        try {
          await startBackfill();
        } catch (err) {
          console.error("Backfill error:", err);
        }
        await loadDashboard();
      }
    }
    init();
  }, []);

  async function handleSync() {
    if (backfillComplete.value) {
      await incrementalSync();
      // Also resume any pending detail fetches from prior rate-limited sessions
      const pending = await getActivitiesWithoutEfforts();
      if (pending.length > 0) {
        try {
          await startBackfill();
        } catch (err) {
          console.error("Detail resume error:", err);
        }
      }
    } else {
      try {
        await startBackfill();
      } catch (err) {
        console.error("Backfill error:", err);
      }
    }
    await loadDashboard();
  }

  async function handleDisconnect() {
    await disconnect();
    navigate("");
  }

  async function handleUnitToggle() {
    const next = units === "metric" ? "imperial" : "metric";
    await setUnitPreference(next);
    // Recompute awards to update formatted messages
    const withEfforts = recentActivities.value.filter((a) => a.has_efforts);
    if (withEfforts.length > 0) {
      const awards = await computeAwardsForActivities(withEfforts);
      activityAwards.value = awards;
    }
  }

  // Rate limit percentages for the inline indicator
  const shortPct = rateLimit.shortLimit
    ? Math.round((rateLimit.shortUsage / rateLimit.shortLimit) * 100)
    : 0;
  const dailyPct = rateLimit.dailyLimit
    ? Math.round((rateLimit.dailyUsage / rateLimit.dailyLimit) * 100)
    : 0;
  const isThrottled = shortPct > 80 || dailyPct > 80;

  const detailPct =
    progress.detailTotal && progress.detailTotal > 0
      ? Math.round((progress.detailed / progress.detailTotal) * 100)
      : 0;

  return html`
    <div class="min-h-screen bg-gray-50">
      <!-- Header -->
      <header class="bg-white border-b border-gray-200 px-6 py-4">
        <div class="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 class="text-xl font-bold text-gray-800">Participation Awards</h1>
            ${auth && html`
              <p class="text-sm text-gray-500">
                ${auth.athlete.firstname} ${auth.athlete.lastname}
                ${isDemo.value && html`<span class="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Demo</span>`}
              </p>
            `}
          </div>
          <div class="flex items-center gap-3">
            <!-- Unit toggle -->
            <button
              onClick=${handleUnitToggle}
              class="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors"
              title="Toggle metric/imperial"
            >
              ${units === "metric" ? "km" : "mi"}
            </button>
            ${isDemo.value ? html`
              <button
                onClick=${async () => { await exitDemo(); authState.value = null; navigate(""); }}
                class="text-xs text-amber-600 hover:text-amber-800 font-medium transition-colors"
              >Exit Demo</button>
            ` : html`
              <button
                onClick=${handleSync}
                disabled=${syncing}
                class="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
              >
                ${syncing && html`
                  <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                `}
                ${syncing ? "Syncing..." : html`Sync Now${pendingCount.value > 0 ? html`\u00a0<span class="bg-blue-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full">${pendingCount.value}</span>` : ""}`}
              </button>
            `}
            <button
              onClick=${() => { showFaq.value = !showFaq.value; }}
              class="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              title="FAQ & Help"
            >
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
            </button>
          </div>
        </div>
      </header>

      <main class="max-w-3xl mx-auto px-6 py-6">
        <!-- Inline sync progress -->
        ${syncing && html`
          <div class="bg-white rounded-xl border border-gray-200 p-4 mb-6">
            <div class="flex items-center gap-3 mb-2">
              <div class="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0"></div>
              <p class="text-sm font-medium text-gray-700">${progress.message || "Starting sync..."}</p>
            </div>

            ${progress.phase === "detail" && progress.detailTotal > 0 && html`
              <div class="mb-2">
                <div class="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Loading activity details</span>
                  <span>${progress.detailed} / ${progress.detailTotal}</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-1.5">
                  <div
                    class="bg-blue-500 h-1.5 rounded-full transition-all duration-300"
                    style="width: ${detailPct}%"
                  ></div>
                </div>
              </div>
            `}

            ${isThrottled && html`
              <p class="text-xs text-amber-600 mt-1">
                Approaching Strava rate limit — sync will pause and resume next session.
              </p>
            `}
          </div>
        `}

        <!-- Sync paused banner (not actively syncing, but backfill incomplete) -->
        ${!syncing && !backfillComplete.value && !loading.value && html`
          <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800">
            <p class="font-medium mb-1">Initial sync paused</p>
            <p class="text-amber-700">
              Your full activity history is still loading. Strava limits API requests,
              so this happens over a few sessions. Tap <strong>Sync Now</strong> to continue,
              or it will resume automatically next time you visit.
            </p>
          </div>
        `}

        <!-- Comeback mode banner (#60) -->
        ${activeResetEvent.value && html`
          <div class="bg-rose-50 border border-rose-200 rounded-xl p-4 mb-6">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <span class="text-lg">🔄</span>
                <div>
                  <p class="text-sm font-medium text-rose-800">Comeback Mode: ${activeResetEvent.value.name}</p>
                  <p class="text-xs text-rose-600">Since ${new Date(activeResetEvent.value.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} — awards adjusted for recovery</p>
                </div>
              </div>
              <button
                onClick=${async () => {
                  activeResetEvent.value = null;
                  await clearResetEvent();
                  await loadDashboard();
                }}
                class="text-xs text-rose-400 hover:text-rose-600 transition-colors"
              >
                End
              </button>
            </div>
          </div>
        `}

        <!-- Demo mode banner -->
        ${isDemo.value && html`
          <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6 text-sm text-amber-800">
            <p class="font-medium mb-1">Demo Mode</p>
            <p class="text-amber-700">
              You're viewing sample data from a fictional rider. Connect your Strava to see your own awards.
            </p>
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
            ${!backfillComplete.value && !loading.value && html`
              <div class="text-xs text-gray-400 mt-1">May change as more data syncs</div>
            `}
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
            ${recentActivities.value.length === 0 && html`
              <p class="text-center py-8 text-gray-400">
                ${syncing ? "Activities will appear here as they sync..." : "No activities yet. Tap Sync Now to get started."}
              </p>
            `}
            ${recentActivities.value.map((activity) => {
              const awards = activityAwards.value.get(activity.id) || [];
              // Summarize awards by type: [{type, count}] ordered season_first > year_best > recent_best
              const typeCounts = new Map();
              for (const a of awards) {
                typeCounts.set(a.type, (typeCounts.get(a.type) || 0) + 1);
              }
              const typeOrder = ["route_season_first", "season_first", "year_best", "ytd_best_time", "ytd_best_power", "best_month_ever", "monthly_best", "recent_best", "reference_best", "improvement_streak", "comeback", "closing_in", "top_decile", "top_quartile", "beat_median", "consistency", "milestone", "anniversary", "distance_record", "elevation_record", "segment_count", "endurance_record"];
              const summary = typeOrder
                .filter((t) => typeCounts.has(t))
                .map((t) => ({ type: t, count: typeCounts.get(t) }));

              // Power display — only for measured power
              const powerLabel = activity.device_watts && activity.average_watts
                ? formatPower(activity.average_watts)
                : null;

              return html`
                <button
                  key=${activity.id}
                  onClick=${() => navigate(`activity/${activity.id}`)}
                  class="w-full text-left bg-white rounded-xl border border-gray-200 p-4 hover:border-gray-300 transition-colors"
                >
                  <div class="font-medium text-gray-800">${activity.name}</div>
                  <div class="text-sm text-gray-500 mt-1">
                    ${formatDateWeekday(activity.start_date_local)}
                    · ${formatDistance(activity.distance)}
                    · ${formatTime(activity.moving_time)}
                    ${activity.total_elevation_gain ? ` · ${formatElevation(activity.total_elevation_gain)}` : ""}
                    ${powerLabel ? ` · ${powerLabel}` : ""}
                  </div>
                  ${summary.length > 0 && html`
                    <div class="flex flex-wrap gap-1.5 mt-2">
                      ${summary.map(
                        (s) => {
                          // Route Season First: show route name + frequency (#59)
                          if (s.type === "route_season_first") {
                            const routeAward = awards.find((a) => a.type === "route_season_first");
                            const routeName = routeAward?.route_name || "Route";
                            const freq = routeAward?.route_frequency;
                            return html`
                              <span class="text-xs px-2 py-0.5 rounded-full ${AWARD_LABELS[s.type]?.color || 'bg-gray-100 text-gray-600'}">
                                Season First: ${routeName}${freq ? ` — ${freq} times` : ""}
                              </span>
                            `;
                          }
                          return html`
                            <span class="text-xs px-2 py-0.5 rounded-full ${AWARD_LABELS[s.type]?.color || 'bg-gray-100 text-gray-600'}">
                              ${s.count > 1 ? `${s.count}× ` : ""}${AWARD_LABELS[s.type]?.label || s.type}
                            </span>
                          `;
                        }
                      )}
                    </div>
                  `}
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

      <!-- FAQ Modal Overlay -->
      ${showFaq.value && html`
        <div
          class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-y-auto p-4 pt-16 sm:pt-24"
          onClick=${(e) => { if (e.target === e.currentTarget) showFaq.value = false; }}
        >
          <div class="bg-white rounded-xl border border-gray-200 shadow-xl w-full max-w-lg p-6 my-4">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-lg font-semibold text-gray-800">FAQ & Settings</h2>
              <button
                onClick=${() => { showFaq.value = false; }}
                class="text-sm text-gray-400 hover:text-gray-600"
              >Close</button>
            </div>

            <div class="divide-y divide-gray-100">
              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                  What do the awards mean?
                  <svg class="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 text-sm text-gray-600 space-y-2">
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-800 whitespace-nowrap mt-0.5">Season First</span>
                    <span>First effort on a segment this calendar year.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 whitespace-nowrap mt-0.5">Year Best</span>
                    <span>Fastest time on a segment this year (after March, with 3+ efforts).</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 whitespace-nowrap mt-0.5">YTD Best</span>
                    <span>Fastest time by this date across multiple years — your best performance at this point in the season.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-red-200 text-red-900 whitespace-nowrap mt-0.5">YTD Power</span>
                    <span>Highest measured power by this date across multiple years. Only counts power meter data.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 whitespace-nowrap mt-0.5">Recent Best</span>
                    <span>Fastest of your last 5 attempts on a segment.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 whitespace-nowrap mt-0.5">Beat Median</span>
                    <span>Faster than your median time on this segment.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-800 whitespace-nowrap mt-0.5">Top Quartile</span>
                    <span>In the top 25% of your own history on this segment.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 whitespace-nowrap mt-0.5">Top 10%</span>
                    <span>In the top 10% of your own history. Supersedes Top Quartile and Beat Median.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-800 whitespace-nowrap mt-0.5">Metronome</span>
                    <span>Remarkably consistent — low variance across your last 5 efforts.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 whitespace-nowrap mt-0.5">Monthly Best</span>
                    <span>Fastest time on a segment this calendar month.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 whitespace-nowrap mt-0.5">On a Roll</span>
                    <span>3+ consecutive improving times on a segment — each ride faster than the last.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 whitespace-nowrap mt-0.5">Comeback</span>
                    <span>Beat your median after 3+ slower efforts in a row.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 whitespace-nowrap mt-0.5">Milestone</span>
                    <span>Round-number attempt on a segment (10th, 25th, 50th, 100th, etc.).</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-800 whitespace-nowrap mt-0.5">Best Month Ever</span>
                    <span>Fastest time in this calendar month across all years — your best March ever, for example.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-pink-100 text-pink-800 whitespace-nowrap mt-0.5">Closing In</span>
                    <span>Within 10% of your all-time PR on a segment — you're close to a personal best.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 whitespace-nowrap mt-0.5">Anniversary</span>
                    <span>Rode this segment on the same date in a previous year.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-800 whitespace-nowrap mt-0.5">Longest Ride</span>
                    <span>Your longest ride of the year by distance.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 whitespace-nowrap mt-0.5">Most Climbing</span>
                    <span>Most elevation gain in a single ride this year.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-lime-100 text-lime-800 whitespace-nowrap mt-0.5">Most Segments</span>
                    <span>Most segments hit in a single ride this year.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-800 whitespace-nowrap mt-0.5">Longest by Time</span>
                    <span>Longest ride by moving time this year — your biggest endurance effort.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-teal-200 text-teal-900 whitespace-nowrap mt-0.5">Reference Best</span>
                    <span>Best effort within a user-defined window — since a date, in last N efforts, or since turning an age. Configure in settings below.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-rose-200 text-rose-900 whitespace-nowrap mt-0.5">Comeback PB</span>
                    <span>Post-injury personal best on a segment. Only appears when Comeback Mode is active.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-orange-200 text-orange-900 whitespace-nowrap mt-0.5">Recovery</span>
                    <span>You've reached 80%, 90%, or 95% of your pre-injury best on a segment.</span>
                  </div>
                  <div class="flex items-start gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-green-200 text-green-900 whitespace-nowrap mt-0.5">You're Back!</span>
                    <span>You've matched or beaten your pre-injury best. Full recovery on this segment.</span>
                  </div>
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                  How does this work without a server?
                  <svg class="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 text-sm text-gray-600">
                  Everything runs in your browser. Your activity data is fetched directly from Strava's API and stored locally. Awards are computed on your device. No server receives or stores your data.
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                  Is my data private?
                  <svg class="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 text-sm text-gray-600">
                  Completely. Your Strava data never leaves your browser. No analytics, no tracking, no cookies, no server logs. The only network requests go directly to Strava's API.
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                  Why don't I see my data on another device?
                  <svg class="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 text-sm text-gray-600">
                  Your data lives in your browser's local storage. Each browser/device needs its own Strava connection and sync. No server means no sync between devices — that's the trade-off for complete privacy.
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                  Why are some segments missing awards?
                  <svg class="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 text-sm text-gray-600">
                  Segments dominated by traffic lights or stops produce wildly varying times. If your times on a segment vary by more than 50% (coefficient of variation), awards are suppressed since those times reflect traffic, not performance. Season First is the exception — it always counts.
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                  What about power data?
                  <svg class="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 text-sm text-gray-600">
                  Power is shown for rides with a power meter (measured watts only — estimated power is excluded). Average watts appear in ride summaries and per-segment details. YTD Power awards compare your power output by date across years.
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                  Comeback Mode vs Reference Points?
                  <svg class="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 text-sm text-gray-600 space-y-2">
                  <p>Both track progress from a point in time, but they serve different purposes:</p>
                  <p><strong class="text-rose-700">Comeback Mode</strong> is for injury recovery. It shields you from demoralizing comparisons to your pre-injury self. While you're rebuilding, awards like Year Best and Top Quartile are temporarily hidden — replaced by recovery milestones (80%, 90%, 95%) and a "You're Back!" celebration when you match your old form. One active at a time.</p>
                  <p><strong class="text-teal-700">Reference Points</strong> are lightweight personal markers — "since I got my new bike", "last 20 efforts", "since turning 50". They add "best since" awards without changing how other awards work. Stack as many as you like.</p>
                  <p class="text-xs text-gray-400">In short: Comeback Mode protects; Reference Points observe.</p>
                </div>
              </details>
            </div>

            <div class="mt-4 pt-4 border-t border-gray-100 space-y-3">
              <!-- Comeback Mode Settings (#60) -->
              <div>
                <p class="text-xs font-medium text-gray-600 mb-1.5">Comeback Mode</p>
                ${activeResetEvent.value ? html`
                  <div class="flex items-center justify-between bg-rose-50 rounded-lg px-3 py-2">
                    <div>
                      <p class="text-xs font-medium text-rose-800">${activeResetEvent.value.name}</p>
                      <p class="text-xs text-rose-600">Since ${new Date(activeResetEvent.value.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                    </div>
                    <button
                      onClick=${async () => {
                        activeResetEvent.value = null;
                        await clearResetEvent();
                        await loadDashboard();
                      }}
                      class="text-xs text-rose-400 hover:text-rose-600 px-2 py-1 rounded transition-colors"
                    >
                      End comeback
                    </button>
                  </div>
                ` : html`
                  ${showResetForm.value ? html`
                    <div class="bg-gray-50 rounded-lg p-3 space-y-2">
                      <input
                        type="text"
                        placeholder="Event name (e.g. Knee surgery)"
                        value=${resetName.value}
                        onInput=${(e) => { resetName.value = e.target.value; }}
                        class="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-rose-400"
                      />
                      <input
                        type="date"
                        value=${resetDate.value}
                        onInput=${(e) => { resetDate.value = e.target.value; }}
                        class="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-rose-400"
                      />
                      <div class="flex gap-2">
                        <button
                          onClick=${async () => {
                            if (!resetName.value.trim() || !resetDate.value) return;
                            const event = { name: resetName.value.trim(), date: resetDate.value, sport_types: null };
                            await setResetEvent(event);
                            activeResetEvent.value = event;
                            showResetForm.value = false;
                            resetName.value = "";
                            resetDate.value = "";
                            await loadDashboard();
                          }}
                          disabled=${!resetName.value.trim() || !resetDate.value}
                          class="text-xs px-3 py-1.5 rounded font-medium transition-colors ${
                            resetName.value.trim() && resetDate.value
                              ? "bg-rose-600 text-white hover:bg-rose-700"
                              : "bg-gray-200 text-gray-400 cursor-not-allowed"
                          }"
                        >
                          Start comeback
                        </button>
                        <button
                          onClick=${() => { showResetForm.value = false; resetName.value = ""; resetDate.value = ""; }}
                          class="text-xs px-3 py-1.5 rounded text-gray-500 hover:text-gray-700 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ` : html`
                    <button
                      onClick=${() => { showResetForm.value = true; }}
                      class="text-xs text-gray-400 hover:text-rose-500 transition-colors"
                    >
                      Set a reset date (injury recovery)
                    </button>
                    <p class="text-xs text-gray-300 mt-1">Hides demoralizing comparisons while you rebuild. Tracks recovery milestones toward your pre-injury best.</p>
                  `}
                `}
              </div>
            </div>

            <div class="mt-4 pt-4 border-t border-gray-100 space-y-3">
              <!-- Reference Points Settings -->
              <div>
                <p class="text-xs font-medium text-gray-600 mb-1.5">Reference Points</p>
                <p class="text-xs text-gray-400 mb-2">Lightweight "best since" markers — track progress from a date, last N efforts, or an age. Doesn't change other awards.</p>

                ${referencePoints.value.length > 0 && html`
                  <div class="space-y-1.5 mb-2">
                    ${referencePoints.value.map((rp) => html`
                      <div key=${rp.id} class="flex items-center justify-between bg-teal-50 rounded-lg px-3 py-2">
                        <div>
                          <p class="text-xs font-medium text-teal-800">${rp.label}</p>
                          <p class="text-xs text-teal-600">
                            ${rp.type === "since_date" ? `Since ${new Date(rp.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}
                            ${rp.type === "last_n" ? `Last ${rp.count} efforts` : ""}
                            ${rp.type === "since_age" ? `Since turning ${rp.age} (${new Date(rp.birthday).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })})` : ""}
                          </p>
                        </div>
                        <button
                          onClick=${async () => {
                            const updated = referencePoints.value.filter((r) => r.id !== rp.id);
                            referencePoints.value = updated;
                            await setUserConfig({ referencePoints: updated });
                            await loadDashboard();
                          }}
                          class="text-xs text-teal-400 hover:text-teal-600 px-2 py-1 rounded transition-colors"
                        >
                          Remove
                        </button>
                      </div>
                    `)}
                  </div>
                `}

                ${showRefForm.value ? html`
                  <div class="bg-gray-50 rounded-lg p-3 space-y-2">
                    <select
                      value=${refType.value}
                      onChange=${(e) => {
                        refType.value = e.target.value;
                        // Set default labels
                        if (e.target.value === "since_date") refLabel.value = "";
                        if (e.target.value === "last_n") refLabel.value = "last " + refCount.value + " efforts";
                        if (e.target.value === "since_age") refLabel.value = "";
                      }}
                      class="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400 bg-white"
                    >
                      <option value="since_date">Best since date</option>
                      <option value="last_n">Best in last N efforts</option>
                      <option value="since_age">Best since turning age</option>
                    </select>

                    <input
                      type="text"
                      placeholder=${refType.value === "since_date" ? "Label (e.g. Since new bike)" : refType.value === "last_n" ? "Label (e.g. Last 10 efforts)" : "Label (e.g. Since turning 40)"}
                      value=${refLabel.value}
                      onInput=${(e) => { refLabel.value = e.target.value; }}
                      class="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
                    />

                    ${refType.value === "since_date" && html`
                      <input
                        type="date"
                        value=${refDate.value}
                        onInput=${(e) => { refDate.value = e.target.value; }}
                        class="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
                      />
                    `}

                    ${refType.value === "last_n" && html`
                      <div class="flex items-center gap-2">
                        <input
                          type="number"
                          min="2"
                          max="100"
                          value=${refCount.value}
                          onInput=${(e) => { refCount.value = e.target.value; }}
                          class="w-20 text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
                        />
                        <span class="text-xs text-gray-500">efforts per segment</span>
                      </div>
                    `}

                    ${refType.value === "since_age" && html`
                      <div class="space-y-2">
                        <div>
                          <label class="text-xs text-gray-500 block mb-0.5">Birthday</label>
                          <input
                            type="date"
                            value=${refBirthday.value}
                            onInput=${(e) => { refBirthday.value = e.target.value; }}
                            class="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
                          />
                        </div>
                        <div class="flex items-center gap-2">
                          <label class="text-xs text-gray-500">Age</label>
                          <input
                            type="number"
                            min="1"
                            max="120"
                            value=${refAge.value}
                            onInput=${(e) => { refAge.value = e.target.value; }}
                            class="w-20 text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-teal-400"
                          />
                        </div>
                      </div>
                    `}

                    <div class="flex gap-2">
                      <button
                        onClick=${async () => {
                          const label = refLabel.value.trim();
                          if (!label) return;
                          const rp = { id: Date.now().toString(), type: refType.value, label };
                          if (refType.value === "since_date") {
                            if (!refDate.value) return;
                            rp.date = refDate.value;
                          } else if (refType.value === "last_n") {
                            rp.count = parseInt(refCount.value) || 10;
                          } else if (refType.value === "since_age") {
                            if (!refBirthday.value || !parseInt(refAge.value)) return;
                            rp.birthday = refBirthday.value;
                            rp.age = parseInt(refAge.value);
                          }
                          const updated = [...referencePoints.value, rp];
                          referencePoints.value = updated;
                          await setUserConfig({ referencePoints: updated });
                          showRefForm.value = false;
                          refLabel.value = "";
                          refDate.value = "";
                          refType.value = "since_date";
                          await loadDashboard();
                        }}
                        disabled=${!refLabel.value.trim() || (refType.value === "since_date" && !refDate.value) || (refType.value === "since_age" && (!refBirthday.value || !parseInt(refAge.value)))}
                        class="text-xs px-3 py-1.5 rounded font-medium transition-colors ${
                          refLabel.value.trim() && (refType.value !== "since_date" || refDate.value) && (refType.value !== "since_age" || (refBirthday.value && parseInt(refAge.value)))
                            ? "bg-teal-600 text-white hover:bg-teal-700"
                            : "bg-gray-200 text-gray-400 cursor-not-allowed"
                        }"
                      >
                        Add reference point
                      </button>
                      <button
                        onClick=${() => { showRefForm.value = false; refLabel.value = ""; refDate.value = ""; refType.value = "since_date"; }}
                        class="text-xs px-3 py-1.5 rounded text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ` : html`
                  <button
                    onClick=${() => { showRefForm.value = true; }}
                    class="text-xs text-gray-400 hover:text-teal-500 transition-colors"
                  >
                    Add a reference point
                  </button>
                `}
              </div>
            </div>

            <div class="mt-4 pt-4 border-t border-gray-100 space-y-3">
              ${isDemo.value ? html`
                <div>
                  <button
                    onClick=${async () => { await exitDemo(); authState.value = null; navigate(""); }}
                    class="text-xs text-amber-600 hover:text-red-500 transition-colors font-medium"
                  >
                    Exit Demo Mode
                  </button>
                  <p class="text-xs text-gray-300 mt-1">Returns to the landing page. Demo data is discarded.</p>
                </div>
              ` : html`
                <div>
                  <button
                    onClick=${handleDisconnect}
                    class="text-xs text-gray-400 hover:text-red-500 transition-colors"
                  >
                    Disconnect Strava
                  </button>
                  <p class="text-xs text-gray-300 mt-1">Removes your login session. Synced data stays in your browser.</p>
                </div>
              `}
              <div>
                <button
                  onClick=${() => { showDeleteConfirm.value = !showDeleteConfirm.value; deleteConfirmText.value = ""; }}
                  class="text-xs text-gray-400 hover:text-red-500 transition-colors"
                >
                  Delete all data
                </button>
                <p class="text-xs text-gray-300 mt-1">Permanently removes all synced activities, segments, and login from this browser.</p>
                ${showDeleteConfirm.value && html`
                  <div class="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p class="text-xs text-red-700 mb-2">
                      This will delete all your data from this browser. To confirm, type <span class="font-mono font-bold">delete my data</span> below.
                    </p>
                    <input
                      type="text"
                      value=${deleteConfirmText.value}
                      onInput=${(e) => { deleteConfirmText.value = e.target.value; }}
                      placeholder="delete my data"
                      class="w-full text-xs border border-red-300 rounded px-2 py-1.5 mb-2 focus:outline-none focus:ring-1 focus:ring-red-400"
                    />
                    <div class="flex gap-2">
                      <button
                        onClick=${async () => {
                          await clearAllData();
                          navigate("");
                          window.location.reload();
                        }}
                        disabled=${deleteConfirmText.value !== "delete my data"}
                        class="text-xs px-3 py-1.5 rounded font-medium transition-colors ${
                          deleteConfirmText.value === "delete my data"
                            ? "bg-red-600 text-white hover:bg-red-700"
                            : "bg-gray-200 text-gray-400 cursor-not-allowed"
                        }"
                      >
                        Delete everything
                      </button>
                      <button
                        onClick=${() => { showDeleteConfirm.value = false; deleteConfirmText.value = ""; }}
                        class="text-xs px-3 py-1.5 rounded text-gray-500 hover:text-gray-700 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                `}
              </div>
            </div>
          </div>
        </div>
      `}
    </div>
  `;
}
