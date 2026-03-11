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
  startAutoSync,
  stopAutoSync,
  manualSync,
  updateSyncWindow,
  syncProgress,
  rateLimitStatus,
  isSyncing,
} from "../sync.js";
import { computeAwardsForActivities, computeStreakData } from "../awards.js";
import {
  getAllActivities,
  getAllSegments,
  getActivitiesWithoutEfforts,
  getSyncState,
  updateSyncState,
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
import { isDemo, exitDemo, startDemo } from "../demo.js";
import { renderIconSVG } from "../icons.js";
import { AWARD_LABELS } from "../award-config.js";
import { computeFitnessSummary } from "../fitness.js";
import { StickyHeader, headerCompact } from "./StickyHeader.js";

const recentActivities = signal([]);
const activityAwards = signal(new Map());
const stats = signal({ segments: 0, awards: 0 });
const loading = signal(true);
const backfillComplete = signal(false);
const showFaq = signal(false);
const showSettings = signal(false);
const searchQuery = signal("");
const showSearch = signal(false);
const allActivities = signal([]);
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
const steepestClimbName = signal(null);
const refLabel = signal("");
const refDate = signal("");
const refCount = signal("10");
const refBirthday = signal("");
const refAge = signal("40");
const streakData = signal(null);
const fitnessData = signal(null);
const syncWindowChoice = signal("5y"); // "2y" | "3y" | "5y" | "all" | "custom"
const syncWindowCustomDate = signal("");
const currentSyncAfterEpoch = signal(null);
const showFirstSyncPrompt = signal(false);
const firstSyncChoice = signal("5y");

function pickSteepestClimb(segments) {
  let best = null;
  for (const seg of segments) {
    if ((seg.average_grade || 0) >= 5 && (!best || seg.average_grade > best.average_grade)) {
      best = seg;
    }
  }
  steepestClimbName.value = best ? best.name : null;
}

async function loadDashboard() {
  loading.value = true;
  // Reset all data signals to prevent stale data flash when switching modes
  recentActivities.value = [];
  allActivities.value = [];
  activityAwards.value = new Map();
  stats.value = { segments: 0, awards: 0 };
  streakData.value = null;
  fitnessData.value = null;
  backfillComplete.value = false;
  pendingCount.value = 0;
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
    allActivities.value = activities;

    // Compute streak data (#58) — uses all activities, not just recent 20
    if (activities.length > 0) {
      streakData.value = computeStreakData(activities);
    }

    // Check sync completion state
    const state = await getSyncState();
    backfillComplete.value = state.backfill_complete;

    // Load sync window preference (#111)
    currentSyncAfterEpoch.value = state.sync_after_epoch || null;
    if (state.sync_after_epoch) {
      // Determine which preset matches, if any
      const now = Date.now() / 1000;
      const diffYears = (now - state.sync_after_epoch) / (365.25 * 24 * 3600);
      if (Math.abs(diffYears - 2) < 0.1) syncWindowChoice.value = "2y";
      else if (Math.abs(diffYears - 3) < 0.1) syncWindowChoice.value = "3y";
      else if (Math.abs(diffYears - 5) < 0.1) syncWindowChoice.value = "5y";
      else {
        syncWindowChoice.value = "custom";
        syncWindowCustomDate.value = new Date(state.sync_after_epoch * 1000).toISOString().slice(0, 10);
      }
    } else {
      syncWindowChoice.value = "all";
    }

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
      pickSteepestClimb(segments);
    } else {
      activityAwards.value = new Map();
      const segments = await getAllSegments();
      stats.value = { segments: segments.length, awards: 0 };
      pickSteepestClimb(segments);
    }

    // Compute form indicators (#106)
    try {
      fitnessData.value = await computeFitnessSummary();
    } catch (e) {
      console.warn("Fitness computation failed:", e);
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
    loadDashboard();

    // Check if this is a first-time sync — prompt user for data window
    if (!isDemo.value) {
      getSyncState().then((state) => {
        if (!state.last_sync && !state.backfill_complete && !state.initial_backfill_complete && state.sync_after_epoch === null) {
          showFirstSyncPrompt.value = true;
        } else {
          startAutoSync(() => loadDashboard());
        }
      });
    }

    return () => stopAutoSync();
  }, []);

  async function handleDisconnect() {
    await disconnect();
    navigate("/");
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
    <div class="min-h-screen" style="background: var(--bg);">
      <!-- Header -->
      <${StickyHeader}
        onHelp=${() => { showFaq.value = !showFaq.value; }}
        onSearch=${() => { showSearch.value = !showSearch.value; if (!showSearch.value) searchQuery.value = ""; }}
        searchActive=${showSearch.value}
        syncing=${syncing}
        unitSystem=${units}
        onUnitToggle=${handleUnitToggle}
        menuItems=${[
          ...(isDemo.value ? [{
            label: "Exit Demo",
            onClick: async () => {
              await exitDemo();
              navigate(authState.value ? "/dashboard" : "/");
            },
          }] : [{
            label: syncing ? "Syncing…" : "Sync now",
            onClick: async () => { try { await manualSync(loadDashboard); } catch(e) { console.error("Manual sync error:", e); } await loadDashboard(); },
            hidden: syncing,
          }]),
          {
            label: "Settings",
            onClick: () => { showSettings.value = true; },
          },
          ...(!isDemo.value ? [{
            label: "Try Demo",
            onClick: async () => { await startDemo(); navigate("/demo"); },
          }] : []),
          ...(!isDemo.value ? [{
            label: "Disconnect Strava",
            onClick: handleDisconnect,
          }] : []),
          ...(!isDemo.value ? [{
            label: "Delete all data",
            onClick: () => { showSettings.value = true; showDeleteConfirm.value = true; deleteConfirmText.value = ""; },
            danger: true,
          }] : []),
        ]}
      />

      ${showSearch.value && html`
        <div style="background: var(--accent);">
          <div class="max-w-3xl mx-auto px-6 pb-4">
            <div class="relative">
              <svg class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style="color: rgba(255,255,255,0.5);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"/>
              </svg>
              <input
                type="text"
                placeholder="Search activities by name, date, or award..."
                value=${searchQuery.value}
                onInput=${(e) => { searchQuery.value = e.target.value; }}
                onKeyDown=${(e) => { if (e.key === "Escape") { searchQuery.value = ""; showSearch.value = false; } }}
                class="search-input w-full rounded-lg py-2 pl-9 pr-8 text-sm"
                style="background: rgba(255,255,255,0.15); color: white; border: 1px solid rgba(255,255,255,0.2); font-family: var(--font-body); outline: none;"
                ref=${(el) => { if (el) setTimeout(() => el.focus(), 0); }}
              />
              ${searchQuery.value && html`
                <button
                  onClick=${() => { searchQuery.value = ""; }}
                  class="absolute right-2 top-1/2 -translate-y-1/2"
                  style="color: rgba(255,255,255,0.6);"
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              `}
            </div>
          </div>
        </div>
      `}

      <main class="max-w-3xl mx-auto px-6 py-6">
        ${!searchQuery.value.trim() && html`
        <!-- Inline sync progress -->
        ${syncing && html`
          <div class="rounded-xl p-4 mb-6" style="background: var(--surface); border: 1px solid var(--border);">
            <div class="flex items-center gap-3 mb-2">
              <div class="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0" style="border-color: var(--strava); border-top-color: transparent;"></div>
              <p style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">${progress.message || "Starting sync..."}</p>
            </div>

            ${progress.phase === "detail" && progress.detailTotal > 0 && html`
              <div class="mb-2">
                <div class="flex justify-between mb-1" style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary);">
                  <span>Loading activity details</span>
                  <span>${progress.detailed} / ${progress.detailTotal}</span>
                </div>
                <div class="w-full rounded-full h-1.5" style="background: var(--border);">
                  <div
                    class="h-1.5 rounded-full transition-all duration-300"
                    style="width: ${detailPct}%; background: var(--strava);"
                  ></div>
                </div>
              </div>
            `}

            ${isThrottled && html`
              <p class="mt-1" style="font-family: var(--font-body); font-size: 0.75rem; color: var(--accent);">
                Approaching Strava rate limit — sync will pause and resume next session.
              </p>
            `}
          </div>
        `}

        <!-- Sync paused banner (not actively syncing, but backfill incomplete) -->
        ${!syncing && !backfillComplete.value && !loading.value && html`
          <div class="rounded-xl p-4 mb-6" style="background: #FBF0D8; border: 1px solid #E8D4A0; font-family: var(--font-body); font-size: 0.875rem; color: #6E5010;">
            <div class="flex items-center justify-between mb-1">
              <p class="font-medium">Initial sync paused</p>
              <button
                onClick=${() => manualSync(loadDashboard).catch(() => {}).then(() => loadDashboard())}
                class="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                style="background: var(--strava); color: white;"
              >Sync Now</button>
            </div>
            ${progress.phase === "error" ? html`
              <p>${progress.message}</p>
            ` : dailyPct > 80 ? html`
              <p>
                Strava's daily API limit has been reached. Sync will resume tomorrow.
              </p>
            ` : shortPct > 80 ? html`
              <p>
                Strava's 15-minute rate limit reached. Sync will resume shortly.
              </p>
            ` : html`
              <p>
                Your full activity history is still loading. Strava limits API requests,
                so this happens over a few sessions. Sync will resume automatically.
              </p>
            `}
            ${(dailyPct > 0 || shortPct > 0) && html`
              <p class="mt-2" style="font-family: var(--font-mono); font-size: 0.75rem; color: #8A6B10;">
                API usage: ${rateLimit.shortUsage}/${rateLimit.shortLimit} (15-min) · ${rateLimit.dailyUsage}/${rateLimit.dailyLimit} (daily)
              </p>
            `}
          </div>
        `}

        <!-- Comeback mode banner (#60) -->
        ${activeResetEvent.value && html`
          <div class="rounded-xl p-4 mb-6" style="background: #F4E4E8; border: 1px solid #DCC0C8;">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                ${renderIconSVG("comeback", { size: 20, color: "#A05060" })}
                <div>
                  <p style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: #6E2E3C;">Comeback Mode: ${activeResetEvent.value.name}</p>
                  <p style="font-family: var(--font-mono); font-size: 0.75rem; color: #A05060;">Since ${new Date(activeResetEvent.value.date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} — awards adjusted for recovery</p>
                </div>
              </div>
              <button
                onClick=${async () => {
                  activeResetEvent.value = null;
                  await clearResetEvent();
                  await loadDashboard();
                }}
                class="text-xs transition-colors"
                style="color: #A05060;"
              >
                End
              </button>
            </div>
          </div>
        `}

        <!-- Demo mode banner -->
        ${isDemo.value && html`
          <div class="rounded-xl p-4 mb-6" style="background: #FBF0D8; border: 1px solid #E8D4A0; font-family: var(--font-body); font-size: 0.875rem; color: #6E5010;">
            <p class="font-medium mb-1">Demo Mode</p>
            <p>
              You're viewing sample data from a fictional rider. Connect your Strava to see your own awards.
            </p>
          </div>
        `}

        <!-- Streak Danger Warning (#58) -->
        ${streakData.value?.weeklyStreak?.danger && html`
          <div class="rounded-xl p-4 mb-6" style="background: ${streakData.value.weeklyStreak.danger.level === 'critical' ? '#F6DED4' : '#FBF0D8'}; border: 1px solid ${streakData.value.weeklyStreak.danger.level === 'critical' ? '#E4B8A4' : '#E8D4A0'};">
            <div class="flex items-center gap-2">
              ${renderIconSVG("weekly_streak", { size: 20, color: streakData.value.weeklyStreak.danger.level === "critical" ? "#7A3418" : "#6E5010" })}
              <p style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: ${streakData.value.weeklyStreak.danger.level === 'critical' ? '#7A3418' : '#6E5010'};">
                ${streakData.value.weeklyStreak.danger.message}
              </p>
            </div>
          </div>
        `}

        <!-- Streak Cards (#58) -->
        ${streakData.value?.weeklyStreak?.current >= 4 && html`
          <div class="grid gap-4 mb-6" style="grid-template-columns: ${streakData.value.groupRides?.length > 0 ? '1fr 1fr' : '1fr'};">
            <!-- Weekly Ride Streak -->
            <div class="rounded-xl p-4" style="background: var(--surface); border: 1px solid var(--border);">
              <div class="flex items-center gap-2 mb-2">
                ${renderIconSVG("weekly_streak", { size: 18, color: "#3D7A4A" })}
                <span style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">Ride Streak</span>
                ${streakData.value.weeklyStreak.mulliganUsed && html`
                  <span class="text-xs px-1.5 py-0.5 rounded-full" style="background: #FBF0D8; color: #6E5010; font-family: var(--font-mono);">mulligan</span>
                `}
              </div>
              <div style="font-family: var(--font-display); font-size: 2rem; color: #3D7A4A;">${streakData.value.weeklyStreak.current}</div>
              <div style="font-family: var(--font-body); font-size: 0.75rem; color: var(--text-secondary);">
                consecutive weeks${streakData.value.weeklyStreak.streakStart ? ` since ${streakData.value.weeklyStreak.streakStart.replace("-W", " W")}` : ""}
              </div>
              ${streakData.value.weeklyStreak.longest > streakData.value.weeklyStreak.current && html`
                <div class="mt-1" style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary);">
                  Best: ${streakData.value.weeklyStreak.longest} weeks
                </div>
              `}
            </div>

            <!-- Top Group Ride -->
            ${streakData.value.groupRides?.length > 0 && (() => {
              const topGroup = streakData.value.groupRides[0];
              return html`
                <div class="rounded-xl p-4" style="background: var(--surface); border: 1px solid var(--border);">
                  <div class="flex items-center gap-2 mb-2">
                    ${renderIconSVG("group_consistency", { size: 18, color: "#5B6CA0" })}
                    <span style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">Group Ride</span>
                  </div>
                  <div style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: #34406A;">${topGroup.name}</div>
                  <div style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-secondary);">
                    ${topGroup.totalRides} rides total${topGroup.attendanceStreak >= 3 ? ` · ${topGroup.attendanceStreak}-week streak` : ""}
                  </div>
                  ${topGroup.attendanceMulligan && topGroup.attendanceStreak >= 3 && html`
                    <span class="text-xs px-1.5 py-0.5 rounded-full mt-1 inline-block" style="background: #FBF0D8; color: #6E5010; font-family: var(--font-mono);">mulligan used</span>
                  `}
                </div>
              `;
            })()}
          </div>
        `}

        <!-- Additional Group Rides (if streak < 4 but groups exist) -->
        ${streakData.value && !(streakData.value.weeklyStreak?.current >= 4) && streakData.value.groupRides?.length > 0 && html`
          <div class="rounded-xl p-4 mb-6" style="background: var(--surface); border: 1px solid var(--border);">
            <div class="flex items-center gap-2 mb-2">
              ${renderIconSVG("group_consistency", { size: 18, color: "#5B6CA0" })}
              <span style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">Recurring Rides</span>
            </div>
            <div class="space-y-2">
              ${streakData.value.groupRides.slice(0, 3).map((g) => html`
                <div class="flex items-center justify-between">
                  <div>
                    <span style="font-family: var(--font-body); font-size: 0.875rem; color: #34406A;">${g.name}</span>
                    <span style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--text-tertiary);"> · ${g.totalRides} rides</span>
                  </div>
                  ${g.attendanceStreak >= 3 && html`
                    <span class="text-xs px-2 py-0.5 rounded-full" style="background: #E4E8F2; color: #34406A; border: 1px solid #BCC4DC;">${g.attendanceStreak}w streak</span>
                  `}
                </div>
              `)}
            </div>
          </div>
        `}

        <!-- Stats -->
        <div class="grid grid-cols-2 gap-4 mb-6">
          <div class="rounded-xl p-4 text-center" style="background: var(--surface); border: 1px solid var(--border);">
            <div style="font-family: var(--font-display); font-size: 1.875rem; color: var(--text);">${stats.value.segments}</div>
            <div style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">Segments tracked</div>
          </div>
          <div class="rounded-xl p-4 text-center" style="background: var(--surface); border: 1px solid var(--border);">
            <div style="font-family: var(--font-display); font-size: 1.875rem; color: var(--text);">${stats.value.awards}</div>
            <div style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">Awards (recent 20)</div>
            ${!backfillComplete.value && !loading.value && html`
              <div style="font-family: var(--font-body); font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.25rem;">May change as more data syncs</div>
            `}
          </div>
        </div>

        <!-- Form Indicators (#106) -->
        ${!loading.value && fitnessData.value && (fitnessData.value.performanceCapacity.hasData || fitnessData.value.aerobicEfficiency.hasData) && html`
          <div class="mb-6 rounded-xl p-5" style="background: var(--surface); border: 1px solid var(--border);">
            <h2 class="group relative inline-block cursor-help" style="font-family: var(--font-display); font-size: 1.125rem; color: var(--text); margin-bottom: 1rem;">Form Indicators
              <span class="invisible group-hover:visible absolute left-1/2 -translate-x-1/2 top-full mt-2 text-white text-xs rounded px-3 py-2 whitespace-nowrap z-10" style="background: var(--text); font-family: var(--font-body); font-weight: 400;">Capacity + efficiency together tell a training story</span>
            </h2>

            <div class="${fitnessData.value.performanceCapacity.hasData && fitnessData.value.aerobicEfficiency.hasData ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : 'grid grid-cols-1 gap-4'}">

              <!-- Performance Capacity -->
              ${fitnessData.value.performanceCapacity.hasData && html`
                <div class="rounded-lg p-4" style="background: var(--bg); border: 1px solid var(--border);">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="group relative cursor-help" style="font-family: var(--font-body); font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary);">Performance Capacity
                      <span class="invisible group-hover:visible absolute left-1/2 -translate-x-1/2 text-white text-xs rounded px-3 py-2 z-10" style="background: var(--text); font-family: var(--font-body); bottom: 100%; margin-bottom: 0.5rem; white-space: normal; width: 220px; text-align: center;">0-100 score from your climb segments. Bars show each climb\u2019s percentile vs. your all-time history (last 90 days, recency-weighted).</span>
                    </span>
                    ${fitnessData.value.performanceCapacity.trend != null && html`
                      <span style="font-size: 0.75rem; color: ${fitnessData.value.performanceCapacity.trend > 2 ? '#3D7A4A' : fitnessData.value.performanceCapacity.trend < -2 ? '#A05060' : 'var(--text-tertiary)'};">
                        ${fitnessData.value.performanceCapacity.trend > 2 ? '\u2191' : fitnessData.value.performanceCapacity.trend < -2 ? '\u2193' : '\u2192'}
                      </span>
                    `}
                  </div>
                  <div class="flex items-baseline gap-2">
                    <div style="font-family: var(--font-display); font-size: 2rem; color: var(--text);">${fitnessData.value.performanceCapacity.score}</div>
                    <div style="font-family: var(--font-body); font-size: 0.75rem; color: var(--text-tertiary);">
                      from ${fitnessData.value.performanceCapacity.segments.length} climb${fitnessData.value.performanceCapacity.segments.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <!-- Segment bar chart -->
                  <div class="mt-3" style="display: flex; flex-direction: column; gap: 6px;">
                    ${fitnessData.value.performanceCapacity.segments.slice(0, 5).map((seg) => html`
                      <div style="display: flex; align-items: center; gap: 6px;" title="${seg.segmentName}: ${Math.round(seg.score)}/100 from ${seg.effortCount} efforts (${seg.recentCount} recent)">
                        <span class="truncate" style="font-size: 0.6875rem; color: var(--text-secondary); width: 40%; min-width: 0; flex-shrink: 0;">${seg.segmentName}</span>
                        <div style="flex: 1; height: 14px; background: var(--border); border-radius: 3px; overflow: hidden; position: relative;">
                          <div style="height: 100%; width: ${Math.round(seg.score)}%; background: ${seg.score >= 70 ? '#3D7A4A' : seg.score >= 40 ? '#4882A8' : '#A05060'}; border-radius: 3px; transition: width 0.3s;"></div>
                        </div>
                        <span style="font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text); min-width: 1.5rem; text-align: right;">${Math.round(seg.score)}</span>
                      </div>
                    `)}
                  </div>
                </div>
              `}

              <!-- Aerobic Efficiency -->
              ${fitnessData.value.aerobicEfficiency.hasData && html`
                <div class="rounded-lg p-4" style="background: var(--bg); border: 1px solid var(--border);">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="group relative cursor-help" style="font-family: var(--font-body); font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary);">Aerobic Efficiency
                      <span class="invisible group-hover:visible absolute left-1/2 -translate-x-1/2 text-white text-xs rounded px-3 py-2 z-10" style="background: var(--text); font-family: var(--font-body); bottom: 100%; margin-bottom: 0.5rem; white-space: normal; width: 220px; text-align: center;">Efficiency Factor (power or speed \u00F7 heart rate). Each dot is a ride; the dashed line shows your trend over time.</span>
                    </span>
                    ${fitnessData.value.aerobicEfficiency.ef.trend != null && html`
                      <span style="font-size: 0.75rem; color: ${fitnessData.value.aerobicEfficiency.ef.trend > 2 ? '#3D7A4A' : fitnessData.value.aerobicEfficiency.ef.trend < -2 ? '#A05060' : 'var(--text-tertiary)'};">
                        ${fitnessData.value.aerobicEfficiency.ef.trend > 2 ? '\u2191' : fitnessData.value.aerobicEfficiency.ef.trend < -2 ? '\u2193' : '\u2192'}
                        ${fitnessData.value.aerobicEfficiency.ef.trend != null ? ` ${Math.abs(fitnessData.value.aerobicEfficiency.ef.trend).toFixed(1)}%` : ''}
                      </span>
                    `}
                  </div>
                  <div class="flex items-baseline gap-2">
                    <div style="font-family: var(--font-display); font-size: 2rem; color: var(--text);">${fitnessData.value.aerobicEfficiency.ef.current}</div>
                    <div style="font-family: var(--font-body); font-size: 0.75rem; color: var(--text-tertiary);">
                      EF ${fitnessData.value.aerobicEfficiency.ef.hasPowerData ? '(W/bpm)' : '(speed/bpm)'}
                      \u2022 ${fitnessData.value.aerobicEfficiency.ef.recentCount} recent rides
                    </div>
                  </div>
                  <!-- EF scatter plot with trend line -->
                  ${fitnessData.value.aerobicEfficiency.ef.history.length > 2 && (() => {
                    const pts = fitnessData.value.aerobicEfficiency.ef.history;
                    const efs = pts.map((p) => p.ef);
                    const dates = pts.map((p) => p.date);
                    const minEf = Math.min(...efs);
                    const maxEf = Math.max(...efs);
                    const efRange = maxEf - minEf || 0.1;
                    const padded = { min: minEf - efRange * 0.1, max: maxEf + efRange * 0.1 };
                    const pRange = padded.max - padded.min;
                    const minDate = Math.min(...dates);
                    const maxDate = Math.max(...dates);
                    const dateRange = maxDate - minDate || 1;
                    // SVG dimensions: left margin for y-axis, bottom margin for x-axis
                    const W = 280, H = 90, ML = 32, MR = 4, MT = 4, MB = 18;
                    const cW = W - ML - MR, cH = H - MT - MB;
                    const x = (d) => ML + ((d - minDate) / dateRange) * cW;
                    const y = (ef) => MT + cH - ((ef - padded.min) / pRange) * cH;
                    // Linear regression for trend line
                    const n = pts.length;
                    const sumX = dates.reduce((s, d) => s + d, 0);
                    const sumY = efs.reduce((s, e) => s + e, 0);
                    const sumXY = pts.reduce((s, p) => s + p.date * p.ef, 0);
                    const sumX2 = dates.reduce((s, d) => s + d * d, 0);
                    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
                    const intercept = (sumY - slope * sumX) / n;
                    const trendY1 = slope * minDate + intercept;
                    const trendY2 = slope * maxDate + intercept;
                    // Y-axis tick values (3 ticks: min, mid, max of padded range)
                    const yTicks = [padded.min, padded.min + pRange / 2, padded.max].map((v) => +v.toFixed(2));
                    // X-axis month labels
                    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    const xLabels = [];
                    const startDate = new Date(minDate);
                    const endDate = new Date(maxDate);
                    let cur = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 1);
                    while (cur <= endDate) {
                      xLabels.push({ date: cur.getTime(), label: monthNames[cur.getMonth()] });
                      cur = new Date(cur.getFullYear(), cur.getMonth() + 2, 1);
                    }
                    // Only show ~4-6 labels max
                    const labelStep = Math.max(1, Math.ceil(xLabels.length / 5));
                    const shownLabels = xLabels.filter((_, i) => i % labelStep === 0);
                    return html`
                      <svg viewBox="0 0 ${W} ${H}" style="width: 100%; height: auto; margin-top: 0.75rem; overflow: visible;">
                        <!-- Y-axis ticks -->
                        ${yTicks.map((v) => html`
                          <text x="${ML - 3}" y="${y(v) + 1}" text-anchor="end" style="font-size: 7px; fill: var(--text-tertiary); font-family: var(--font-mono);">${v}</text>
                          <line x1="${ML}" y1="${y(v)}" x2="${W - MR}" y2="${y(v)}" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="2,2" />
                        `)}
                        <!-- X-axis labels -->
                        ${shownLabels.map((l) => html`
                          <text x="${x(l.date)}" y="${H - 2}" text-anchor="middle" style="font-size: 7px; fill: var(--text-tertiary); font-family: var(--font-mono);">${l.label}</text>
                        `)}
                        <!-- Trend line -->
                        <line x1="${x(minDate)}" y1="${y(trendY1)}" x2="${x(maxDate)}" y2="${y(trendY2)}" stroke="${slope > 0 ? '#3D7A4A' : '#A05060'}" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.7" />
                        <!-- Data points -->
                        ${pts.map((p) => {
                          const d = new Date(p.date);
                          const label = `${d.toLocaleDateString()}: EF ${p.ef.toFixed(2)}`;
                          return html`<circle cx="${x(p.date)}" cy="${y(p.ef)}" r="2.5" fill="#4882A8" opacity="0.7"><title>${label}</title></circle>`;
                        })}
                      </svg>
                    `;
                  })()}
                </div>
              `}
            </div>

            <!-- Interpretation -->
            ${fitnessData.value.interpretation && html`
              <div class="mt-3 px-3 py-2 rounded-lg" style="background: ${
                fitnessData.value.interpretation === 'ideal' ? '#E8F2E6' :
                fitnessData.value.interpretation === 'overreaching' ? '#F4E4E8' :
                fitnessData.value.interpretation === 'detraining' ? '#F4E4E8' :
                'var(--bg)'
              }; border: 1px solid ${
                fitnessData.value.interpretation === 'ideal' ? '#C0D8B8' :
                fitnessData.value.interpretation === 'overreaching' ? '#DCC0C8' :
                fitnessData.value.interpretation === 'detraining' ? '#DCC0C8' :
                'var(--border)'
              };">
                <span style="font-family: var(--font-body); font-size: 0.8125rem; color: ${
                  fitnessData.value.interpretation === 'ideal' ? '#1E4D28' :
                  fitnessData.value.interpretation === 'overreaching' ? '#6E2E3C' :
                  fitnessData.value.interpretation === 'detraining' ? '#6E2E3C' :
                  'var(--text-secondary)'
                };">
                  ${{
                    ideal: "Getting stronger and more efficient",
                    pushing: "Pushing harder \u2014 output up, economy steady",
                    building: "Base building \u2014 economy improving, capacity stable",
                    overreaching: "Watch out \u2014 output up but costing more",
                    detraining: "Both capacity and efficiency declining",
                    maintaining: "Maintaining current fitness level",
                  }[fitnessData.value.interpretation]}
                </span>
              </div>
            `}
          </div>
        `}

        `}

        <!-- Loading -->
        ${loading.value && html`
          <div class="text-center py-12" style="color: var(--text-tertiary);">Loading activities...</div>
        `}

        <!-- Activity list -->
        ${!loading.value && (() => {
          const query = searchQuery.value.trim().toLowerCase();
          const isSearching = query.length > 0;
          const sourceActivities = isSearching ? allActivities.value : recentActivities.value;
          const displayActivities = isSearching
            ? sourceActivities.filter((activity) => {
                // Search by activity name
                if (activity.name && activity.name.toLowerCase().includes(query)) return true;
                // Search by date
                if (activity.start_date_local && activity.start_date_local.toLowerCase().includes(query)) return true;
                // Search by formatted date
                try {
                  const formatted = formatDateWeekday(activity.start_date_local).toLowerCase();
                  if (formatted.includes(query)) return true;
                } catch (e) {}
                // Search by award labels
                const awards = activityAwards.value.get(activity.id) || [];
                for (const award of awards) {
                  const al = AWARD_LABELS[award.type];
                  if (al && al.label.toLowerCase().includes(query)) return true;
                  if (award.segment_name && award.segment_name.toLowerCase().includes(query)) return true;
                }
                return false;
              })
            : sourceActivities;
          return html`
          <div class="space-y-3">
            <h2 style="font-family: var(--font-display); font-size: 1.125rem; color: var(--text);">
              ${isSearching
                ? `${displayActivities.length} result${displayActivities.length !== 1 ? "s" : ""} for "${searchQuery.value.trim()}"`
                : "Recent Activities"}
            </h2>
            ${displayActivities.length === 0 && html`
              <p class="text-center py-8" style="color: var(--text-tertiary);">
                ${isSearching
                  ? "No activities match your search."
                  : syncing ? "Activities will appear here as they sync..." : "No activities yet. Tap Sync Now to get started."}
              </p>
            `}
            ${displayActivities.map((activity) => {
              const awards = activityAwards.value.get(activity.id) || [];
              const typeCounts = new Map();
              for (const a of awards) {
                typeCounts.set(a.type, (typeCounts.get(a.type) || 0) + 1);
              }
              const typeOrder = ["route_season_first", "season_first", "year_best", "ytd_best_time", "ytd_best_power", "best_month_ever", "monthly_best", "recent_best", "reference_best", "improvement_streak", "comeback", "closing_in", "top_decile", "top_quartile", "beat_median", "consistency", "milestone", "anniversary", "distance_record", "elevation_record", "segment_count", "endurance_record", "weekly_streak", "group_consistency"];
              const summary = typeOrder
                .filter((t) => typeCounts.has(t))
                .map((t) => ({ type: t, count: typeCounts.get(t) }));

              const powerLabel = activity.device_watts && activity.average_watts
                ? formatPower(activity.average_watts)
                : null;

              return html`
                <button
                  key=${activity.id}
                  onClick=${() => navigate(`/activity?id=${activity.id}`)}
                  class="w-full text-left rounded-xl p-4 transition-colors"
                  style="background: var(--surface); border: 1px solid var(--border);"
                  onMouseOver=${(e) => e.currentTarget.style.background = 'var(--surface-hover)'}
                  onMouseOut=${(e) => e.currentTarget.style.background = 'var(--surface)'}
                >
                  <div style="font-family: var(--font-body); font-size: 16px; font-weight: 500; color: var(--text);">${activity.name}</div>
                  <div class="mt-1" style="font-family: var(--font-mono); font-size: 14px; color: var(--text-secondary);">
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
                          const al = AWARD_LABELS[s.type];
                          const pillStyle = al ? `background: ${al.bg}; color: ${al.text}; border: 1px solid ${al.border};` : "background: #ECEAE6; color: #3E3A36;";
                          if (s.type === "route_season_first") {
                            const routeAward = awards.find((a) => a.type === "route_season_first");
                            const routeName = routeAward?.route_name || "Route";
                            const freq = routeAward?.route_frequency;
                            return html`
                              <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full cursor-help" style=${pillStyle} title=${al?.tip || ""}>
                                ${al ? renderIconSVG(s.type, { size: 12, color: al.dot }) : null}
                                Season First: ${routeName}${freq ? ` — ${freq} times` : ""}
                              </span>
                            `;
                          }
                          return html`
                            <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full cursor-help" style=${pillStyle} title=${al?.tip || ""}>
                              ${al ? renderIconSVG(s.type, { size: 12, color: al.dot }) : null}
                              ${s.count > 1 ? `${s.count}× ` : ""}${al?.label || s.type}
                            </span>
                          `;
                        }
                      )}
                    </div>
                  `}
                  ${!activity.has_efforts && html`
                    <div class="mt-2" style="font-family: var(--font-body); font-size: 0.75rem; color: var(--text-tertiary);">Details not yet loaded</div>
                  `}
                </button>
              `;
            })}
          </div>
        `;
        })()}

      </main>

      <!-- Powered by Strava -->
      <footer class="text-center py-4 mt-4" style="border-top: 1px solid var(--border);">
        <img src="assets/strava/api_logo_pwrdBy_strava_horiz_orange.svg" alt="Powered by Strava" style="height: 18px; display: inline-block; opacity: 0.6;" />
      </footer>

      <!-- First Sync Data Window Prompt -->
      ${showFirstSyncPrompt.value && html`
        <div
          class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-y-auto p-4 pt-16 sm:pt-24"
        >
          <div class="rounded-xl shadow-xl w-full max-w-md p-6 my-4" style="background: var(--surface); border: 1px solid var(--border);">
            <h2 style="font-family: var(--font-display); font-size: 1.125rem; color: var(--text); margin-bottom: 0.5rem;">How far back should we sync?</h2>
            <p class="text-xs mb-3" style="color: var(--text-tertiary);">
              We'll fetch your last 13 months of rides first for quick results, then backfill to your chosen window. Only cycling activities are synced.
            </p>

            <div class="flex flex-wrap gap-1.5 mb-3">
              ${["2y", "3y", "5y", "all"].map((opt) => {
                const labels = { "2y": "Last 2 years", "3y": "Last 3 years", "5y": "Last 5 years", "all": "All time" };
                const descs = { "2y": "Fastest sync", "3y": "", "5y": "Recommended", "all": "May take several sessions" };
                const isActive = firstSyncChoice.value === opt;
                return html`
                  <button
                    key=${opt}
                    onClick=${() => { firstSyncChoice.value = opt; }}
                    class="text-xs px-2.5 py-1.5 rounded-lg transition-colors"
                    style=${isActive
                      ? "background: var(--text); color: var(--surface); font-family: var(--font-body);"
                      : "border: 1px solid var(--border); color: var(--text-secondary); font-family: var(--font-body);"}
                  >
                    ${labels[opt]}${descs[opt] ? html` <span class="opacity-60">(${descs[opt]})</span>` : ""}
                  </button>
                `;
              })}
            </div>

            <button
              onClick=${async () => {
                const now = Date.now() / 1000;
                let epoch = null;
                if (firstSyncChoice.value === "2y") epoch = Math.floor(now - 2 * 365.25 * 24 * 3600);
                else if (firstSyncChoice.value === "3y") epoch = Math.floor(now - 3 * 365.25 * 24 * 3600);
                else if (firstSyncChoice.value === "5y") epoch = Math.floor(now - 5 * 365.25 * 24 * 3600);
                // null = all time
                await updateSyncState({ sync_after_epoch: epoch });
                currentSyncAfterEpoch.value = epoch;
                syncWindowChoice.value = firstSyncChoice.value;
                showFirstSyncPrompt.value = false;
                startAutoSync(() => loadDashboard());
              }}
              class="text-xs px-4 py-2 rounded font-medium transition-colors w-full"
              style="background: var(--strava); color: white;"
            >
              Start Syncing
            </button>
          </div>
        </div>
      `}

      <!-- FAQ Modal Overlay -->
      ${showFaq.value && html`
        <div
          class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-y-auto p-4 pt-16 sm:pt-24"
          onClick=${(e) => { if (e.target === e.currentTarget) showFaq.value = false; }}
        >
          <div class="rounded-xl shadow-xl w-full max-w-lg p-6 my-4" style="background: var(--surface); border: 1px solid var(--border);">
            <div class="flex items-center justify-between mb-4">
              <h2 style="font-family: var(--font-display); font-size: 1.125rem; color: var(--text);">FAQ</h2>
              <button
                onClick=${() => { showFaq.value = false; }}
                class="text-sm transition-colors"
                style="color: var(--text-tertiary);"
              >Close</button>
            </div>

            <div style="border-color: var(--border-light);" class="divide-y">
              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  What do the awards mean?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 space-y-2" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  ${[
                    ["season_first", "Season First", "First effort on a segment this calendar year."],
                    ["year_best", "Year Best", "Fastest time on a segment this year (after March, with 3+ efforts)."],
                    ["ytd_best_time", "YTD Best", "Fastest time by this date across multiple years — your best performance at this point in the season."],
                    ["ytd_best_power", "YTD Power", "Highest measured power by this date across multiple years. Only counts power meter data."],
                    ["recent_best", "Recent Best", "Fastest of your last 5 attempts on a segment."],
                    ["beat_median", "Beat Median", "Beat your median time by 2%+ on a segment (requires 5+ efforts)."],
                    ["top_quartile", "Top Quartile", "In the top 25% of your own history on this segment (requires 5+ efforts)."],
                    ["top_decile", "Top 10%", "In the top 10% of your own history. Supersedes Top Quartile and Beat Median."],
                    ["consistency", "Metronome", "Remarkably consistent — low variance across your last 8 efforts (CV < 3%)."],
                    ["monthly_best", "Monthly Best", "Fastest time on a segment this calendar month."],
                    ["improvement_streak", "On a Roll", "3+ consecutive improving times on a segment — each ride faster than the last."],
                    ["comeback", "Comeback", "Beat your median after 3+ slower efforts in a row."],
                    ["milestone", "Milestone", "Round-number attempt on a segment (10th, 25th, 50th, 100th, etc.)."],
                    ["best_month_ever", "Best Month Ever", "Fastest time in this calendar month across all years — your best March ever, for example."],
                    ["closing_in", "Closing In", "Within 5% of your all-time PR on a segment — you're close to a personal best."],
                    ["anniversary", "Anniversary", "Rode this segment on the same date in a previous year."],
                    ["distance_record", "Longest Ride", "Your longest ride of the year by distance."],
                    ["elevation_record", "Most Climbing", "Most elevation gain in a single ride this year."],
                    ["segment_count", "Most Segments", "Most segments hit in a single ride this year."],
                    ["endurance_record", "Longest by Time", "Longest ride by moving time this year — your biggest endurance effort."],
                    ["reference_best", "Reference Best", "Best effort within a user-defined window — since a date, in last N efforts, or since turning an age. Configure in settings below."],
                    ["comeback_pb", "Comeback PB", "Post-injury personal best on a segment. Only appears when Comeback Mode is active."],
                    ["recovery_milestone", "Recovery", "You've reached 80%, 90%, or 95% of your pre-injury best on a segment."],
                    ["comeback_full", "You're Back!", "You've matched or beaten your pre-injury best. Full recovery on this segment."],
                    ["weekly_streak", "Ride Streak", "Consecutive weeks with at least one ride. One missed week is forgiven (mulligan) — two consecutive misses break the streak."],
                    ["group_consistency", "Group Ride", "Detects recurring rides by day, time, and location. Tracks your attendance streak on each group ride."],
                    ["watt_milestone", "Watt Milestone", "First ride where your average power exceeds a threshold (100W, 150W, ... 350W). Measures sustained effort."],
                    ["kj_milestone", "kJ Milestone", "First ride exceeding an energy threshold (500kJ, 1000kJ, ... 3000kJ). Energy is energy — sport-agnostic."],
                    ["power_progression", "Power Up", "Your Normalized Power is trending upward over your last 10 rides. Uses linear regression to detect real improvement."],
                    ["power_consistency", "Steady Power", "Low variation in NP across your last 10 rides — steady, repeatable power output."],
                    ["ftp_milestone", "FTP Milestone", "Your estimated FTP (95% of 20-min best) crosses a threshold (150W, 200W, ... 400W). Requires power curve data."],
                    ["curve_year_best", "Curve Year Best", "Year's best power at a standard duration (5s sprint, 1min anaerobic, 5min VO2max, 20min FTP, etc)."],
                    ["curve_all_time", "Curve Record", "All-time personal record at a standard power curve duration. Your best ever."],
                  ].map(([type, label, desc]) => {
                    const al = AWARD_LABELS[type];
                    return html`
                      <div class="flex items-start gap-2">
                        <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full whitespace-nowrap mt-0.5" style="background: ${al?.bg || '#ECEAE6'}; color: ${al?.text || '#3E3A36'}; border: 1px solid ${al?.border || '#D4D0C8'};">
                          ${al ? renderIconSVG(type, { size: 12, color: al.dot }) : null}
                          ${label}
                        </span>
                        <span>${desc}</span>
                      </div>
                    `;
                  })}
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  What are the Form Indicators?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 space-y-2" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  <p><strong>Performance Capacity</strong> (0-100) measures what your body can produce. It tracks your climb segment times, converts them to estimated power-to-weight (VAM/Ferrari formula), and ranks recent efforts (last 90 days) against your all-time history. The horizontal bar chart shows your top climb segments colored by percentile: green (\u226570), blue (\u226540), or red (below 40). Long-press or hover a bar for effort counts. Requires at least 3 climb segments with 3+ efforts each.</p>
                  <p><strong>Aerobic Efficiency</strong> measures output per heartbeat (Efficiency Factor = power/HR or speed/HR). Higher means more work per heartbeat = fitter. The scatter plot shows individual ride EF values over time. A dashed trend line shows the overall direction: green = improving, red = declining. Long-press or hover a dot for the date and exact EF. Only appears when your activities include heart rate data.</p>
                  <p>Together they tell a training story: rising capacity + rising efficiency = ideal. Rising capacity + falling efficiency = possible overreaching. The colored banner below interprets the combination.</p>
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  How does this work without a server?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  Everything runs in your browser. Your activity data is fetched directly from Strava's API and stored locally. Awards are computed on your device. No server receives or stores your data.
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  Is my data private?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  Completely. Your Strava data never leaves your browser. No analytics, no tracking, no cookies, no server logs. The only network requests go directly to Strava's API.
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  Why don't I see my data on another device?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  Your data lives in your browser's local storage. Each browser/device needs its own Strava connection and sync. No server means no sync between devices — that's the trade-off for complete privacy.
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  Why are some segments missing awards?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  Segments dominated by traffic lights or stops produce wildly varying times. If your times on a segment vary by more than 50% (coefficient of variation), awards are suppressed since those times reflect traffic, not performance. Season First is the exception — it always counts.
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  What about power data?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
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

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  What are the segment charts?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 space-y-2" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  <p>Each segment effort in the activity detail view has a <strong>sparkline</strong> — a small inline chart showing your recent effort history (up to 20 efforts). The current effort is highlighted in orange.</p>
                  <p>A <strong>trend line</strong> overlays the chart using linear regression. Green means you're getting faster, red means you're slowing down, gray means stable. Tap the sparkline to expand it and see your best time, effort count, and improvement rate (seconds gained or lost per month).</p>
                  <p>The dashboard Form Indicators also include charts. <strong>Performance Capacity</strong> shows horizontal bars for your top climb segments, colored by percentile (green \u226570, blue \u226540, red below). <strong>Aerobic Efficiency</strong> shows a scatter plot of individual ride EF values over time with a dashed trend line (green = improving, red = declining). Long-press or hover any bar or dot for details.</p>
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  How do share cards work?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 space-y-2" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  <p>From the activity detail view, you can generate shareable images of your rides or individual segment efforts. These are rendered locally on a canvas — nothing is uploaded.</p>
                  <p><strong>Activity share cards</strong> show the ride summary (distance, time, elevation, power), award highlights, and top awards. <strong>Segment share cards</strong> include a performance chart of your effort history on that segment, plus award details. Both can be saved as images or shared directly.</p>
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  How does search work?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  The search bar (magnifying glass icon in the header) filters your activity list by name, date, award type, or segment name. It searches across all loaded activities in real time. Press Escape to close the search.
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  What is Ride Streak?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 space-y-2" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  <p>Ride Streak counts consecutive weeks where you've ridden at least once. One missed week is forgiven (a "mulligan") — two consecutive missed weeks break the streak. When your streak is at risk, you'll see a warning banner.</p>
                  <p><strong>Group Rides</strong> are automatically detected by matching recurring rides on the same day of the week, similar time, and similar starting location. Your attendance streak is tracked for each group ride, also with mulligan forgiveness.</p>
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  What is the Power Curve?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 space-y-2" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  <p>If you ride with a power meter, the app can fetch your per-second power data and compute your <strong>power curve</strong> — your best average power at standard durations (5s sprint, 30s, 1 min, 5 min VO2max, 20 min FTP proxy, 60 min sustained).</p>
                  <p>Your <strong>FTP</strong> (Functional Threshold Power) is estimated as 95% of your best 20-minute power. Awards like Curve Year Best and Curve Record track improvements at each duration. Power curve data is fetched and cached locally over multiple sync sessions.</p>
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  Can I switch between metric and imperial?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  Yes — tap the unit toggle button in the header (km/mi). This switches all distance, elevation, and speed values between metric and imperial. Your preference is saved locally and persists between sessions.
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  How does syncing work?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 space-y-2" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  <p>After connecting Strava, the app fetches your <strong>cycling activities</strong> only (rides, virtual rides, gravel, MTB, e-bike) and detail-fetches each for segment efforts. Non-cycling activities (runs, walks, swims, etc.) are excluded.</p>
                  <p>Sync uses a <strong>two-phase approach</strong>: your last 13 months are fetched first so you get usable data quickly, then the app backfills to your full sync window (default 5 years, configurable in settings). This is <strong>resumable</strong> — if you close the browser or hit a rate limit, sync picks up where it left off.</p>
                  <p>Strava enforces API rate limits (per 15-minute window and daily). The app tracks usage and pauses automatically when limits are approached.</p>
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  What is Demo Mode?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 space-y-2" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  <p>Demo Mode lets you explore the app without connecting Strava. It loads sample data (~60 activities, 10 segments) into a separate database so you can see how awards, charts, and the dashboard work. Your real data is never touched.</p>
                  <p>You can enter Demo Mode at any time, even while logged in. When you exit, you'll be returned to your own dashboard with all your data intact.</p>
                  ${!isDemo.value && html`
                    <button
                      onClick=${async () => { showFaq.value = false; await startDemo(); navigate("/demo"); }}
                      class="text-xs transition-colors"
                      style="color: var(--accent); font-family: var(--font-body);"
                    >Try the demo →</button>
                  `}
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  What are routes?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  The app automatically detects recurring routes by comparing which segments appear on each ride. If two activities share 70%+ of their segments, they're considered the same route. This powers the Route Season First award — rather than listing a Season First for every segment on a familiar ride, it collapses them into a single route-level award.
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  How do I see award descriptions on my phone?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  Long-press any award pill to see its description. On desktop you can hover, but touch screens don't have hover — so a half-second press triggers the tooltip instead.
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  The app seems stuck on an old version
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  The app uses a service worker to work offline, which can sometimes serve cached files after an update. Go to Settings and tap "Clear cached code and reload" to force a fresh download. This only clears app code — your activity data is not affected.
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  What does "aeyu" mean?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 space-y-2" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  <p>It's the sound you make at the top of ${steepestClimbName.value ? steepestClimbName.value : "the climb"}.</p>
                  <p>Really though, it was a URL that was short and available. The letters are the vowels from left to right on the keyboard — which is how you'll remember it.</p>
                </div>
              </details>
            </div>

          </div>
        </div>
      `}

      <!-- Settings Modal Overlay -->
      ${showSettings.value && html`
        <div
          class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-y-auto p-4 pt-16 sm:pt-24"
          onClick=${(e) => { if (e.target === e.currentTarget) { showSettings.value = false; showDeleteConfirm.value = false; deleteConfirmText.value = ""; } }}
        >
          <div class="rounded-xl shadow-xl w-full max-w-lg p-6 my-4" style="background: var(--surface); border: 1px solid var(--border);">
            <div class="flex items-center justify-between mb-4">
              <h2 style="font-family: var(--font-display); font-size: 1.125rem; color: var(--text);">Settings</h2>
              <button
                onClick=${() => { showSettings.value = false; showDeleteConfirm.value = false; deleteConfirmText.value = ""; }}
                class="text-sm transition-colors"
                style="color: var(--text-tertiary);"
              >Close</button>
            </div>

            ${!isDemo.value && html`
            <div class="space-y-3">
              <!-- Sync Window Settings (#111) -->
              <div>
                <p class="text-xs font-medium mb-1.5" style="color: var(--text-secondary); font-family: var(--font-body);">Sync Window</p>
                <p class="text-xs mb-2" style="color: var(--text-tertiary);">How far back to sync cycling activities from Strava. The last 13 months sync first, then historical data fills in.</p>

                <div class="flex flex-wrap gap-1.5 mb-2">
                  ${["2y", "3y", "5y", "all"].map((opt) => {
                    const labels = { "2y": "Last 2 years", "3y": "Last 3 years", "5y": "Last 5 years", "all": "All time" };
                    const isActive = syncWindowChoice.value === opt;
                    return html`
                      <button
                        key=${opt}
                        onClick=${() => { syncWindowChoice.value = opt; }}
                        class="text-xs px-2.5 py-1.5 rounded-lg transition-colors"
                        style=${isActive
                          ? "background: var(--text); color: var(--surface); font-family: var(--font-body);"
                          : "border: 1px solid var(--border); color: var(--text-secondary); font-family: var(--font-body);"}
                      >
                        ${labels[opt]}
                      </button>
                    `;
                  })}
                  <button
                    onClick=${() => { syncWindowChoice.value = "custom"; }}
                    class="text-xs px-2.5 py-1.5 rounded-lg transition-colors"
                    style=${syncWindowChoice.value === "custom"
                      ? "background: var(--text); color: var(--surface); font-family: var(--font-body);"
                      : "border: 1px solid var(--border); color: var(--text-secondary); font-family: var(--font-body);"}
                  >
                    Custom
                  </button>
                </div>

                ${syncWindowChoice.value === "custom" && html`
                  <input
                    type="date"
                    value=${syncWindowCustomDate.value}
                    onInput=${(e) => { syncWindowCustomDate.value = e.target.value; }}
                    class="w-full text-xs rounded px-2 py-1.5 mb-2 focus:outline-none focus:ring-1"
                    style="border: 1px solid var(--border); font-family: var(--font-mono);"
                  />
                `}

                <button
                  onClick=${async () => {
                    let epoch = null;
                    const now = Date.now() / 1000;
                    if (syncWindowChoice.value === "2y") epoch = Math.floor(now - 2 * 365.25 * 24 * 3600);
                    else if (syncWindowChoice.value === "3y") epoch = Math.floor(now - 3 * 365.25 * 24 * 3600);
                    else if (syncWindowChoice.value === "5y") epoch = Math.floor(now - 5 * 365.25 * 24 * 3600);
                    else if (syncWindowChoice.value === "custom" && syncWindowCustomDate.value) {
                      epoch = Math.floor(new Date(syncWindowCustomDate.value).getTime() / 1000);
                    }
                    // null = all time
                    if (epoch === currentSyncAfterEpoch.value) return;
                    await updateSyncWindow(epoch);
                    currentSyncAfterEpoch.value = epoch;
                    await loadDashboard();
                  }}
                  disabled=${syncing || (syncWindowChoice.value === "custom" && !syncWindowCustomDate.value)}
                  class="text-xs px-3 py-1.5 rounded font-medium transition-colors"
                  style=${syncing || (syncWindowChoice.value === "custom" && !syncWindowCustomDate.value)
                    ? "background: var(--border); color: var(--text-tertiary); cursor: not-allowed;"
                    : "background: var(--strava); color: white;"}
                >
                  Apply
                </button>

                ${currentSyncAfterEpoch.value && html`
                  <p class="text-xs mt-1.5" style="color: var(--text-tertiary); font-family: var(--font-mono);">
                    Currently syncing since ${new Date(currentSyncAfterEpoch.value * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                  </p>
                `}
              </div>
            </div>
            `}

            <div class="${!isDemo.value ? 'mt-4 pt-4' : ''} space-y-3" style="${!isDemo.value ? 'border-top: 1px solid var(--border-light);' : ''}">
              <!-- Reference Points Settings -->
              <div>
                <p class="text-xs font-medium mb-1.5" style="color: var(--text-secondary); font-family: var(--font-body);">Reference Points</p>
                <p class="text-xs mb-2" style="color: var(--text-tertiary);">Lightweight "best since" markers — track progress from a date, last N efforts, or an age. Doesn't change other awards.</p>

                ${referencePoints.value.length > 0 && html`
                  <div class="space-y-1.5 mb-2">
                    ${referencePoints.value.map((rp) => html`
                      <div key=${rp.id} class="flex items-center justify-between rounded-lg px-3 py-2" style="background: #ECEAE6;">
                        <div>
                          <p class="text-xs font-medium" style="color: var(--text);">${rp.label}</p>
                          <p class="text-xs" style="color: var(--text-secondary);">
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
                          class="text-xs px-2 py-1 rounded transition-colors"
                          style="color: var(--text-tertiary);"
                        >
                          Remove
                        </button>
                      </div>
                    `)}
                  </div>
                `}

                ${showRefForm.value ? html`
                  <div class="rounded-lg p-3 space-y-2" style="background: var(--bg);">
                    <select
                      value=${refType.value}
                      onChange=${(e) => {
                        refType.value = e.target.value;
                        if (e.target.value === "since_date") refLabel.value = "";
                        if (e.target.value === "last_n") refLabel.value = "last " + refCount.value + " efforts";
                        if (e.target.value === "since_age") refLabel.value = "";
                      }}
                      class="w-full text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1"
                      style="border: 1px solid var(--border); font-family: var(--font-body); background: var(--surface);"
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
                      class="w-full text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1" style="border: 1px solid var(--border); font-family: var(--font-body);"
                    />

                    ${refType.value === "since_date" && html`
                      <input
                        type="date"
                        value=${refDate.value}
                        onInput=${(e) => { refDate.value = e.target.value; }}
                        class="w-full text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1" style="border: 1px solid var(--border); font-family: var(--font-body);"
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
                          class="w-20 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1" style="border: 1px solid var(--border); font-family: var(--font-mono);"
                        />
                        <span class="text-xs" style="color: var(--text-secondary);">efforts per segment</span>
                      </div>
                    `}

                    ${refType.value === "since_age" && html`
                      <div class="space-y-2">
                        <div>
                          <label class="text-xs block mb-0.5" style="color: var(--text-secondary);">Birthday</label>
                          <input
                            type="date"
                            value=${refBirthday.value}
                            onInput=${(e) => { refBirthday.value = e.target.value; }}
                            class="w-full text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1" style="border: 1px solid var(--border); font-family: var(--font-body);"
                          />
                        </div>
                        <div class="flex items-center gap-2">
                          <label class="text-xs" style="color: var(--text-secondary);">Age</label>
                          <input
                            type="number"
                            min="1"
                            max="120"
                            value=${refAge.value}
                            onInput=${(e) => { refAge.value = e.target.value; }}
                            class="w-20 text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1" style="border: 1px solid var(--border); font-family: var(--font-mono);"
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
                        class="text-xs px-3 py-1.5 rounded font-medium transition-colors"
                        style=${refLabel.value.trim() && (refType.value !== "since_date" || refDate.value) && (refType.value !== "since_age" || (refBirthday.value && parseInt(refAge.value)))
                          ? "background: var(--accent); color: white;"
                          : "background: var(--border); color: var(--text-tertiary); cursor: not-allowed;"}
                      >
                        Add reference point
                      </button>
                      <button
                        onClick=${() => { showRefForm.value = false; refLabel.value = ""; refDate.value = ""; refType.value = "since_date"; }}
                        class="text-xs px-3 py-1.5 rounded transition-colors"
                        style="color: var(--text-secondary);"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ` : html`
                  <button
                    onClick=${() => { showRefForm.value = true; }}
                    class="text-xs transition-colors"
                    style="color: var(--text-tertiary);"
                  >
                    Add a reference point
                  </button>
                `}
              </div>
            </div>

            <div class="mt-4 pt-4 space-y-3" style="border-top: 1px solid var(--border-light);">
              <!-- Comeback Mode Settings (#60) -->
              <div>
                <p class="text-xs font-medium mb-1.5" style="color: var(--text-secondary); font-family: var(--font-body);">Comeback Mode</p>
                ${activeResetEvent.value ? html`
                  <div class="flex items-center justify-between rounded-lg px-3 py-2" style="background: #F4E4E8;">
                    <div>
                      <p class="text-xs font-medium" style="color: #6E2E3C;">${activeResetEvent.value.name}</p>
                      <p class="text-xs" style="color: #A05060;">Since ${new Date(activeResetEvent.value.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>
                    </div>
                    <button
                      onClick=${async () => {
                        activeResetEvent.value = null;
                        await clearResetEvent();
                        await loadDashboard();
                      }}
                      class="text-xs px-2 py-1 rounded transition-colors"
                      style="color: #A05060;"
                    >
                      End comeback
                    </button>
                  </div>
                ` : html`
                  ${showResetForm.value ? html`
                    <div class="rounded-lg p-3 space-y-2" style="background: var(--bg);">
                      <input
                        type="text"
                        placeholder="Event name (e.g. Knee surgery)"
                        value=${resetName.value}
                        onInput=${(e) => { resetName.value = e.target.value; }}
                        class="w-full text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1"
                        style="border: 1px solid var(--border); font-family: var(--font-body); focus:ring-color: #A05060;"
                      />
                      <input
                        type="date"
                        value=${resetDate.value}
                        onInput=${(e) => { resetDate.value = e.target.value; }}
                        class="w-full text-xs rounded px-2 py-1.5 focus:outline-none focus:ring-1"
                        style="border: 1px solid var(--border); font-family: var(--font-mono);"
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
                          class="text-xs px-3 py-1.5 rounded font-medium transition-colors"
                          style=${resetName.value.trim() && resetDate.value
                            ? "background: #A05060; color: white;"
                            : "background: var(--border); color: var(--text-tertiary); cursor: not-allowed;"}
                        >
                          Start comeback
                        </button>
                        <button
                          onClick=${() => { showResetForm.value = false; resetName.value = ""; resetDate.value = ""; }}
                          class="text-xs px-3 py-1.5 rounded transition-colors"
                          style="color: var(--text-secondary);"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ` : html`
                    <button
                      onClick=${() => { showResetForm.value = true; }}
                      class="text-xs transition-colors"
                      style="color: var(--text-tertiary);"
                    >
                      Set a reset date (injury recovery)
                    </button>
                    <p class="text-xs mt-1" style="color: var(--border);">Hides demoralizing comparisons while you rebuild. Tracks recovery milestones toward your pre-injury best.</p>
                  `}
                `}
              </div>
            </div>

            <div class="mt-4 pt-4" style="border-top: 1px solid var(--border-light);">
              <p class="text-xs font-medium mb-1.5" style="color: var(--text-secondary); font-family: var(--font-body);">Hard Reload</p>
              <button
                onClick=${async () => {
                  try {
                    const cacheNames = await caches.keys();
                    await Promise.all(cacheNames.map(name => caches.delete(name)));
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(registrations.map(r => r.unregister()));
                  } catch (e) { /* SW/cache API may not be available */ }
                  window.location.reload(true);
                }}
                class="text-xs transition-colors"
                style="color: var(--accent);"
              >
                Clear cached code and reload
              </button>
              <p class="text-xs mt-1" style="color: var(--border);">Forces a fresh download of all app files. Your activity data is not affected.</p>
            </div>

            ${!isDemo.value && html`
            <div class="mt-4 pt-4" style="border-top: 1px solid var(--border-light);">
              <p class="text-xs font-medium mb-1.5" style="color: var(--text-secondary); font-family: var(--font-body);">Delete Data</p>
              ${!showDeleteConfirm.value ? html`
                <button
                  onClick=${() => { showDeleteConfirm.value = true; deleteConfirmText.value = ""; }}
                  class="text-xs transition-colors"
                  style="color: #A03020;"
                >
                  Delete all data from this browser
                </button>
              ` : html`
                <div class="p-3 rounded-lg" style="background: #F6DED4; border: 1px solid #E4B8A4;">
                  <p class="text-xs mb-2" style="color: #7A2E18;">
                    This will delete all your data from this browser. To confirm, type <span style="font-family: var(--font-mono); font-weight: 700;">delete my data</span> below.
                  </p>
                  <input
                    type="text"
                    value=${deleteConfirmText.value}
                    onInput=${(e) => { deleteConfirmText.value = e.target.value; }}
                    placeholder="delete my data"
                    class="w-full text-xs rounded px-2 py-1.5 mb-2 focus:outline-none focus:ring-1"
                    style="border: 1px solid #E4B8A4; font-family: var(--font-mono);"
                  />
                  <div class="flex gap-2">
                    <button
                      onClick=${async () => {
                        await clearAllData();
                        navigate("/");
                        window.location.reload();
                      }}
                      disabled=${deleteConfirmText.value !== "delete my data"}
                      class="text-xs px-3 py-1.5 rounded font-medium transition-colors"
                      style=${deleteConfirmText.value === "delete my data"
                        ? "background: #A03020; color: white;"
                        : "background: var(--border); color: var(--text-tertiary); cursor: not-allowed;"}
                    >
                      Delete everything
                    </button>
                    <button
                      onClick=${() => { showDeleteConfirm.value = false; deleteConfirmText.value = ""; }}
                      class="text-xs px-3 py-1.5 rounded transition-colors"
                      style="color: var(--text-secondary);"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              `}
            </div>
            `}
          </div>
        </div>
      `}
    </div>
  `;
}
