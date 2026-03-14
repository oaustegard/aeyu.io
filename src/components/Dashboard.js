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
  formatSpeed,
  formatPower,
} from "../units.js";
import { isDemo, exitDemo, startDemo } from "../demo.js";
import { renderIconSVG } from "../icons.js";
import { AWARD_LABELS, AWARD_GROUPS } from "../award-config.js";
import { computeFitnessSummary } from "../fitness.js";
import { getAllTimeBestCurve, estimateFTP, POWER_CURVE_DURATIONS, DURATION_LABELS } from "../power-curve.js";
import { StickyHeader, headerCompact } from "./StickyHeader.js";
import { buildLLMContext, contextToMarkdown } from "../export-llm.js";

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
const powerCurveData = signal(null);
const syncWindowChoice = signal("5y"); // "2y" | "3y" | "5y" | "all" | "custom"
const syncWindowCustomDate = signal("");
const currentSyncAfterEpoch = signal(null);
const showFirstSyncPrompt = signal(false);
const firstSyncChoice = signal("5y");
const exportDays = signal("90");
const exportFormat = signal("markdown");
const exportStatus = signal(null); // null | "loading" | "copied" | "error"
const activeChartHelp = signal(null);
const disabledAwardTypes = signal(new Set());

function ChartHelp({ id, children }) {
  const isOpen = activeChartHelp.value === id;
  return html`
    <span class="relative" style="display: inline-flex; align-items: center;">
      <button
        onClick=${(e) => { e.stopPropagation(); activeChartHelp.value = isOpen ? null : id; }}
        class="inline-flex items-center justify-center rounded-full"
        style="width: 18px; height: 18px; font-size: 11px; font-weight: 600; color: var(--text-tertiary); border: 1.5px solid var(--text-tertiary); background: transparent; cursor: pointer; line-height: 1; padding: 0; margin-left: 6px; flex-shrink: 0;"
        aria-label="Help"
      >?</button>
      ${isOpen && html`
        <div onClick=${() => { activeChartHelp.value = null; }} style="position: fixed; inset: 0; z-index: 19;"></div>
        <div
          onClick=${(e) => e.stopPropagation()}
          class="absolute z-20 rounded-lg shadow-lg p-4"
          style="top: calc(100% + 8px); left: 50%; transform: translateX(-50%); width: 280px; background: var(--surface); border: 1px solid var(--border); font-family: var(--font-body); font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.5;"
        >
          <button
            onClick=${() => { activeChartHelp.value = null; }}
            style="position: absolute; top: 6px; right: 8px; background: none; border: none; cursor: pointer; color: var(--text-tertiary); font-size: 16px; line-height: 1; padding: 2px;"
            aria-label="Close"
          >\u00D7</button>
          ${children}
        </div>
      `}
    </span>
  `;
}

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
  powerCurveData.value = null;
  backfillComplete.value = false;
  pendingCount.value = 0;
  try {
    await loadUnitPreference();
    activeResetEvent.value = await getResetEvent();
    const userConfig = await getUserConfig();
    referencePoints.value = userConfig.referencePoints || [];
    disabledAwardTypes.value = new Set(userConfig.disabledAwards || []);
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
      const awards = await computeAwardsForActivities(withEfforts, disabledAwardTypes.value);
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

    // Load power curve data
    try {
      const bestCurve = await getAllTimeBestCurve();
      if (Object.keys(bestCurve).length > 0) {
        powerCurveData.value = { curve: bestCurve, ftp: estimateFTP(bestCurve) };
      }
    } catch (e) {
      console.warn("Power curve computation failed:", e);
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
      const awards = await computeAwardsForActivities(withEfforts, disabledAwardTypes.value);
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

        <!-- Form Indicators (#106, redesigned #189) -->
        ${!loading.value && fitnessData.value && (fitnessData.value.performanceCapacity.hasData || fitnessData.value.aerobicEfficiency.hasData) && html`
          <div class="mb-6 rounded-xl p-5" style="background: var(--surface); border: 1px solid var(--border);">
            <h2 class="inline-flex items-center" style="font-family: var(--font-display); font-size: 1.125rem; color: var(--text); margin-bottom: 1rem;">Form Indicators
              <${ChartHelp} id="form-indicators">
                These indicators track your recent form over 6-week windows. The sparkline shows your 4-week rolling score over the last 6 months. Trend arrows compare the last 6 weeks to the prior 6 weeks.
              <//>
            </h2>

            <div class="${fitnessData.value.performanceCapacity.hasData && fitnessData.value.aerobicEfficiency.hasData ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : 'grid grid-cols-1 gap-4'}">

              <!-- Climb Form (was Performance Capacity) -->
              ${fitnessData.value.performanceCapacity.hasData && html`
                <div class="rounded-lg p-4" style="background: var(--bg); border: 1px solid var(--border);">
                  <div class="flex items-center gap-2 mb-2">
                    <span style="font-family: var(--font-body); font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary); display: inline-flex; align-items: center;">Climb Form
                      <${ChartHelp} id="climb-form">
                        <strong>Climb Form</strong> (0\u2013100) tracks how your recent climb efforts compare to your personal history. The sparkline shows your 4-week rolling average over 6 months. Trend arrow compares the last 6 weeks to the prior 6 weeks.
                      <//>
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
                      riding climbs at ${fitnessData.value.performanceCapacity.score}% of your best
                    </div>
                  </div>
                  <div style="font-family: var(--font-body); font-size: 0.6875rem; color: var(--text-tertiary); margin-top: 0.125rem;">
                    Based on ${fitnessData.value.performanceCapacity.totalEfforts} effort${fitnessData.value.performanceCapacity.totalEfforts !== 1 ? 's' : ''} across ${fitnessData.value.performanceCapacity.climbCount} climb${fitnessData.value.performanceCapacity.climbCount !== 1 ? 's' : ''}
                  </div>
                  <!-- 6-month sparkline of 4-week rolling score -->
                  ${fitnessData.value.performanceCapacity.rollingHistory.length > 1 && (() => {
                    const pts = fitnessData.value.performanceCapacity.rollingHistory;
                    const scores = pts.map((p) => p.score);
                    const minS = Math.min(...scores);
                    const maxS = Math.max(...scores);
                    const range = maxS - minS || 1;
                    const W = 280, H = 50, ML = 4, MR = 4, MT = 4, MB = 4;
                    const cW = W - ML - MR, cH = H - MT - MB;
                    const xPos = (i) => ML + (i / (pts.length - 1)) * cW;
                    const yPos = (s) => MT + cH - ((s - minS) / range) * cH;
                    const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(p.score).toFixed(1)}`).join(' ');
                    const lastPt = pts[pts.length - 1];
                    const gradientD = pathD + ` L${xPos(pts.length - 1).toFixed(1)},${H - MB} L${ML},${H - MB} Z`;
                    return html`
                      <svg viewBox="0 0 ${W} ${H}" style="width: 100%; height: auto; margin-top: 0.5rem; overflow: visible;">
                        <defs>
                          <linearGradient id="climbGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="#4882A8" stop-opacity="0.15" />
                            <stop offset="100%" stop-color="#4882A8" stop-opacity="0.02" />
                          </linearGradient>
                        </defs>
                        <path d="${gradientD}" fill="url(#climbGrad)" />
                        <path d="${pathD}" fill="none" stroke="#4882A8" stroke-width="1.5" stroke-linejoin="round" />
                        <circle cx="${xPos(pts.length - 1)}" cy="${yPos(lastPt.score)}" r="3" fill="#4882A8" />
                      </svg>
                    `;
                  })()}
                  <!-- Collapsible segment detail -->
                  ${fitnessData.value.performanceCapacity.segments.length > 0 && html`
                    <details style="margin-top: 0.5rem;">
                      <summary style="font-family: var(--font-body); font-size: 0.6875rem; color: var(--text-tertiary); cursor: pointer; user-select: none;">
                        Climb details
                      </summary>
                      <div class="mt-2" style="display: flex; flex-direction: column; gap: 4px;">
                        ${fitnessData.value.performanceCapacity.segments.slice(0, 8).map((seg) => html`
                          <div style="display: flex; align-items: center; gap: 6px;" title="${seg.segmentName}: ${Math.round(seg.score)}/100 from ${seg.effortCount} efforts (${seg.recentCount} recent)">
                            <span class="truncate" style="font-size: 0.625rem; color: var(--text-secondary); width: 40%; min-width: 0; flex-shrink: 0;">${seg.segmentName}</span>
                            <div style="flex: 1; height: 10px; background: var(--border); border-radius: 3px; overflow: hidden;">
                              <div style="height: 100%; width: ${Math.round(seg.score)}%; background: ${seg.score >= 70 ? '#3D7A4A' : seg.score >= 40 ? '#4882A8' : '#A05060'}; border-radius: 3px;"></div>
                            </div>
                            <span style="font-family: var(--font-mono); font-size: 0.625rem; color: var(--text-tertiary); min-width: 1.5rem; text-align: right;">${Math.round(seg.score)}</span>
                          </div>
                        `)}
                      </div>
                    </details>
                  `}
                </div>
              `}

              <!-- Aerobic Efficiency -->
              ${fitnessData.value.aerobicEfficiency.hasData && html`
                <div class="rounded-lg p-4" style="background: var(--bg); border: 1px solid var(--border);">
                  <div class="flex items-center gap-2 mb-2">
                    <span style="font-family: var(--font-body); font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary); display: inline-flex; align-items: center;">Aerobic Efficiency
                      <${ChartHelp} id="aerobic-eff">
                        <strong>Aerobic Efficiency</strong> (EF = Normalized Power / avg HR) measures output per heartbeat. Higher = fitter. The displayed value is the average EF from your last 6 weeks of steady-state rides. Bars show monthly averages over the last 12 months. Trend compares the last 6 weeks to the prior 6 weeks.
                      <//>
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
                      EF (W/bpm)
                      \u2022 ${fitnessData.value.aerobicEfficiency.ef.recentCount} ride${fitnessData.value.aerobicEfficiency.ef.recentCount !== 1 ? 's' : ''} in last 6 wk
                    </div>
                  </div>
                  <!-- Monthly EF bar chart (replaces scatter plot) -->
                  ${fitnessData.value.aerobicEfficiency.ef.monthlyHistory.length > 1 && (() => {
                    const months = fitnessData.value.aerobicEfficiency.ef.monthlyHistory;
                    const efs = months.map((m) => m.ef);
                    const minEf = Math.min(...efs);
                    const maxEf = Math.max(...efs);
                    const efRange = maxEf - minEf || 0.1;
                    const padded = { min: Math.max(0, minEf - efRange * 0.15), max: maxEf + efRange * 0.1 };
                    const pRange = padded.max - padded.min;
                    const W = 280, H = 80, ML = 32, MR = 4, MT = 4, MB = 18;
                    const cW = W - ML - MR, cH = H - MT - MB;
                    const barW = Math.max(6, Math.min(20, (cW / months.length) - 3));
                    const yTicks = [padded.min, padded.min + pRange / 2, padded.max].map((v) => +v.toFixed(2));
                    const y = (ef) => MT + cH - ((ef - padded.min) / pRange) * cH;
                    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                    // Show ~4-6 labels max
                    const labelStep = Math.max(1, Math.ceil(months.length / 6));
                    return html`
                      <svg viewBox="0 0 ${W} ${H}" style="width: 100%; height: auto; margin-top: 0.75rem; overflow: visible;">
                        <!-- Y-axis ticks -->
                        ${yTicks.map((v) => html`
                          <text x="${ML - 3}" y="${y(v) + 1}" text-anchor="end" style="font-size: 7px; fill: var(--text-tertiary); font-family: var(--font-mono);">${v}</text>
                          <line x1="${ML}" y1="${y(v)}" x2="${W - MR}" y2="${y(v)}" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="2,2" />
                        `)}
                        <!-- Monthly bars -->
                        ${months.map((m, i) => {
                          const xPos = ML + (i / (months.length - 1 || 1)) * (cW - barW) + barW / 2;
                          const barH = ((m.ef - padded.min) / pRange) * cH;
                          const barY = MT + cH - barH;
                          const monthIdx = parseInt(m.month.split('-')[1]) - 1;
                          const isLast = i === months.length - 1;
                          return html`
                            <g>
                              <rect x="${xPos - barW / 2}" y="${barY}" width="${barW}" height="${barH}" rx="2" fill="${isLast ? '#4882A8' : '#4882A8'}" opacity="${isLast ? '0.9' : '0.45'}">
                                <title>${monthNames[monthIdx]} ${m.month.split('-')[0]}: EF ${m.ef} (${m.count} ride${m.count !== 1 ? 's' : ''})</title>
                              </rect>
                              ${i % labelStep === 0 ? html`
                                <text x="${xPos}" y="${H - 2}" text-anchor="middle" style="font-size: 7px; fill: var(--text-tertiary); font-family: var(--font-mono);">${monthNames[monthIdx]}</text>
                              ` : ''}
                            </g>
                          `;
                        })}
                      </svg>
                    `;
                  })()}
                </div>
              `}
            </div>

            <!-- Contextual Interpretation (#189) -->
            ${fitnessData.value.interpretation && (() => {
              const interp = fitnessData.value.interpretation;
              const season = fitnessData.value.season;
              const capTrend = fitnessData.value.performanceCapacity.trend;
              const efTrend = fitnessData.value.aerobicEfficiency.ef?.trend;

              // Build contextual, directional descriptions instead of blunt labels
              const capDir = capTrend > 2 ? "climbing" : capTrend < -2 ? "dipping" : "holding steady";
              const efDir = efTrend > 2 ? "improving" : efTrend < -2 ? "dipping" : "steady";
              const efAbs = efTrend != null ? `${Math.abs(efTrend).toFixed(0)}%` : null;

              let message, detail;
              if (interp === "ideal") {
                message = `Climb power ${capDir} and efficiency ${efDir}`;
                detail = "Strong form \u2014 both metrics trending well.";
              } else if (interp === "pushing") {
                message = `Climb power ${capDir}; efficiency ${efDir}`;
                detail = "Pushing harder \u2014 output rising while economy stays stable.";
              } else if (interp === "building") {
                message = `Efficiency ${efDir}; climb power ${capDir}`;
                detail = "Base building \u2014 aerobic economy is improving.";
              } else if (interp === "overreaching") {
                message = `Climb power ${capDir} but efficiency ${efDir}${efAbs ? ` (~${efAbs})` : ''}`;
                detail = "Output is up but costing more \u2014 consider recovery.";
              } else if (interp === "detraining") {
                message = `Climb power ${capDir}; efficiency ${efDir}${efAbs ? ` (~${efAbs})` : ''}`;
                if (season === "off_season" || season === "early_season") {
                  detail = "Typical for this time of year \u2014 numbers usually rise once consistent riding resumes.";
                } else {
                  detail = "Both metrics are dropping \u2014 could indicate insufficient volume or recovery needs.";
                }
              } else {
                message = `Climb power ${capDir}; efficiency ${efDir}`;
                detail = "Fitness is holding at current levels.";
              }

              // Muted colors: only ideal gets light green, others are neutral
              const bgColor = interp === "ideal" ? "#E8F2E6" : "var(--bg)";
              const borderColor = interp === "ideal" ? "#C0D8B8" : "var(--border)";
              const textColor = interp === "ideal" ? "#1E4D28" : "var(--text-secondary)";

              return html`
                <div class="mt-3 px-3 py-2 rounded-lg" style="background: ${bgColor}; border: 1px solid ${borderColor};">
                  <div style="font-family: var(--font-body); font-size: 0.8125rem; color: ${textColor}; font-weight: 500;">${message}</div>
                  <div style="font-family: var(--font-body); font-size: 0.75rem; color: ${textColor}; opacity: 0.8; margin-top: 0.125rem;">${detail}</div>
                </div>
              `;
            })()}
          </div>
        `}

        <!-- Power Curve -->
        ${!loading.value && powerCurveData.value && html`
          <div class="mb-6 rounded-xl p-5" style="background: var(--surface); border: 1px solid var(--border);">
            <div class="flex items-center justify-between mb-3">
              <h2 class="inline-flex items-center" style="font-family: var(--font-display); font-size: 1.125rem; color: var(--text); margin: 0;">Power Curve
                <${ChartHelp} id="power-curve">
                  Your all-time best average power at each standard duration from your power meter data.<br/><br/>
                  <strong>FTP</strong> (Functional Threshold Power) is estimated as 95% of your best 20-minute power. Durations: 5s sprint, 30s, 1 min, 5 min VO\u2082max, 20 min FTP, 60 min sustained.
                <//>
              </h2>
              ${powerCurveData.value.ftp && html`
                <div class="flex items-center gap-1.5" title="Estimated FTP: 95% of 20-min best power">
                  <span style="font-family: var(--font-body); font-size: 0.75rem; color: var(--text-tertiary);">est. FTP</span>
                  <span style="font-family: var(--font-display); font-size: 1.25rem; color: var(--text);">${powerCurveData.value.ftp}</span>
                  <span style="font-family: var(--font-body); font-size: 0.75rem; color: var(--text-tertiary);">W</span>
                </div>
              `}
            </div>
            <div style="display: flex; flex-direction: column; gap: 6px;">
              ${POWER_CURVE_DURATIONS.filter((dur) => powerCurveData.value.curve[dur]).map((dur) => {
                const watts = powerCurveData.value.curve[dur];
                const maxWatts = Math.max(...POWER_CURVE_DURATIONS.map((d) => powerCurveData.value.curve[d] || 0));
                const pct = maxWatts > 0 ? Math.round((watts / maxWatts) * 100) : 0;
                const labels = { 5: "Sprint", 30: "30s", 60: "1 min", 300: "VO\u2082max", 1200: "FTP", 3600: "60 min" };
                return html`
                  <div style="display: flex; align-items: center; gap: 6px;" title="${DURATION_LABELS[dur]} best: ${watts}W">
                    <span style="font-size: 0.6875rem; color: var(--text-secondary); width: 52px; flex-shrink: 0; text-align: right;">${labels[dur]}</span>
                    <div style="flex: 1; height: 14px; background: var(--border); border-radius: 3px; overflow: hidden;">
                      <div style="height: 100%; width: ${pct}%; background: #4882A8; border-radius: 3px; transition: width 0.3s;"></div>
                    </div>
                    <span style="font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text); min-width: 2.5rem; text-align: right;">${watts}W</span>
                  </div>
                `;
              })}
            </div>
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
                    ${activity.average_speed ? ` · ${formatSpeed(activity.average_speed)}` : ""}
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
                  <p><strong>Climb Form</strong> (0\u2013100) shows how your recent climb efforts compare to your personal history. It tracks segment times, converts them to estimated power-to-weight, and ranks recent efforts against your all-time range. The sparkline shows your 4-week rolling average over the last 6 months. Trend arrows compare the last 6 weeks to the prior 6 weeks. Tap "Climb details" to see per-segment breakdowns.</p>
                  <p><strong>Aerobic Efficiency</strong> measures output per heartbeat (EF = Normalized Power / avg HR, per Friel). Higher = more work per heartbeat = fitter. Only steady-state rides \u226530 min with a power meter are included. The displayed value is the average EF from your last 6 weeks of qualifying rides. The bar chart shows monthly averages over the last 12 months. Trend compares the last 6 weeks to the prior 6 weeks.</p>
                  <p>The interpretation below describes the current trajectory with seasonal context \u2014 declining numbers in winter or early spring are normal for outdoor cyclists.</p>
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
                  <p>The dashboard Form Indicators also include charts. <strong>Climb Form</strong> shows a sparkline of your 4-week rolling score over 6 months. <strong>Aerobic Efficiency</strong> shows monthly EF averages (Normalized Power / avg HR) as a bar chart over the last 12 months. Tap "Climb details" for per-segment breakdowns. Hover or long-press any bar for details.</p>
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
                  How do I report a bug or request a feature?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  File an issue on the <a href="https://github.com/oaustegard/aeyu.io/issues" target="_blank" rel="noopener noreferrer" style="color: var(--accent); text-decoration: underline;">GitHub issue tracker</a>. Bug reports, feature requests, and general feedback are all welcome.
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  Can I export my data for an AI coach?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 space-y-2" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  <p>Yes! Go to Settings and use "Export for AI Coach" to copy a compact summary of your recent training to the clipboard. It includes weekly volume rollups, monthly trends, fitness indicators, consistency streaks, and your last 10 rides — everything an LLM needs to give you coaching advice without overwhelming its context window.</p>
                  <p>You can also export a single ride from any Activity Detail page. The ride export includes all segment efforts with awards, and optionally your form context leading into the ride (training load from the preceding 7/14/30 days, recent rides, fitness indicators, and streaks).</p>
                  <p>Choose Markdown (best for chat) or JSON (best for structured prompts). Paste the result into ChatGPT, Claude, or any LLM and ask for training analysis.</p>
                </div>
              </details>

              <details class="group py-3">
                <summary class="flex items-center justify-between cursor-pointer" style="font-family: var(--font-body); font-size: 0.875rem; font-weight: 500; color: var(--text);">
                  Can I hide certain award types?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  Yes. Go to Settings and scroll to "Award Toggles." Each award type has a checkbox — uncheck it to stop that type from appearing on your dashboard and activity detail pages. You can toggle entire groups at once (e.g. all Power Awards) or individual types. Your preference is saved locally and persists across sessions.
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
              <p class="text-xs font-medium mb-1.5" style="color: var(--text-secondary); font-family: var(--font-body);">Award Toggles</p>
              <p class="text-xs mb-2" style="color: var(--text-tertiary);">Turn off award types you don't want to see. Changes apply after recomputation.</p>
              <div class="space-y-3">
                ${AWARD_GROUPS.map(({ group, types }) => {
                  const allDisabled = types.every((t) => disabledAwardTypes.value.has(t.type));
                  const someDisabled = types.some((t) => disabledAwardTypes.value.has(t.type));
                  return html`
                    <details class="group" key=${group}>
                      <summary class="flex items-center justify-between cursor-pointer py-1">
                        <span class="text-xs font-medium" style="color: var(--text);">${group}</span>
                        <div class="flex items-center gap-2">
                          ${someDisabled && !allDisabled ? html`<span class="text-xs" style="color: var(--text-tertiary);">partial</span>` : null}
                          <button
                            onClick=${async (e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              const next = new Set(disabledAwardTypes.value);
                              if (allDisabled) {
                                types.forEach((t) => next.delete(t.type));
                              } else {
                                types.forEach((t) => next.add(t.type));
                              }
                              disabledAwardTypes.value = next;
                              const config = await getUserConfig();
                              await setUserConfig({ ...config, disabledAwards: [...next] });
                              await loadDashboard();
                            }}
                            class="text-xs px-2 py-0.5 rounded transition-colors"
                            style=${allDisabled
                              ? "background: var(--border); color: var(--text-secondary);"
                              : "background: var(--bg); color: var(--text-tertiary);"}
                          >
                            ${allDisabled ? "Enable all" : "Disable all"}
                          </button>
                          <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                        </div>
                      </summary>
                      <div class="pt-1 pb-2 space-y-1">
                        ${types.map(({ type, desc }) => {
                          const al = AWARD_LABELS[type];
                          const isDisabled = disabledAwardTypes.value.has(type);
                          return html`
                            <label key=${type} class="flex items-start gap-2 py-1 cursor-pointer rounded px-1 transition-colors" style=${isDisabled ? "opacity: 0.5;" : ""}>
                              <input
                                type="checkbox"
                                checked=${!isDisabled}
                                onChange=${async () => {
                                  const next = new Set(disabledAwardTypes.value);
                                  if (isDisabled) next.delete(type); else next.add(type);
                                  disabledAwardTypes.value = next;
                                  const config = await getUserConfig();
                                  await setUserConfig({ ...config, disabledAwards: [...next] });
                                  await loadDashboard();
                                }}
                                class="mt-0.5 flex-shrink-0"
                                style="accent-color: ${al?.dot || '#6B6260'};"
                              />
                              <div class="min-w-0">
                                <span class="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-full" style="background: ${al?.bg || '#ECEAE6'}; color: ${al?.text || '#3E3A36'}; border: 1px solid ${al?.border || '#D4D0C8'};">
                                  ${al ? renderIconSVG(type, { size: 10, color: al.dot }) : null}
                                  ${al?.label || type}
                                </span>
                                <p class="text-xs mt-0.5" style="color: var(--text-tertiary);">${desc}</p>
                              </div>
                            </label>
                          `;
                        })}
                      </div>
                    </details>
                  `;
                })}
              </div>
            </div>

            <div class="mt-4 pt-4" style="border-top: 1px solid var(--border-light);">
              <p class="text-xs font-medium mb-1.5" style="color: var(--text-secondary); font-family: var(--font-body);">Export for AI Coach</p>
              <p class="text-xs mb-2" style="color: var(--border);">Copy a compact summary of your recent training data for use with ChatGPT, Claude, or other LLMs.</p>
              <div class="flex items-center gap-2 mb-2">
                <select
                  value=${exportDays.value}
                  onChange=${(e) => { exportDays.value = e.target.value; exportStatus.value = null; }}
                  class="text-xs rounded px-2 py-1 focus:outline-none"
                  style="border: 1px solid var(--border); background: var(--bg-card); color: var(--text); font-family: var(--font-mono);"
                >
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="180">Last 6 months</option>
                  <option value="365">Last year</option>
                </select>
                <select
                  value=${exportFormat.value}
                  onChange=${(e) => { exportFormat.value = e.target.value; exportStatus.value = null; }}
                  class="text-xs rounded px-2 py-1 focus:outline-none"
                  style="border: 1px solid var(--border); background: var(--bg-card); color: var(--text); font-family: var(--font-mono);"
                >
                  <option value="markdown">Markdown</option>
                  <option value="json">JSON</option>
                </select>
              </div>
              <button
                onClick=${async () => {
                  exportStatus.value = "loading";
                  try {
                    const days = parseInt(exportDays.value);
                    const fmt = exportFormat.value;
                    // Pass a Promise to ClipboardItem so user activation is captured now,
                    // even though buildLLMContext resolves later
                    const textPromise = (async () => {
                      const ctx = await buildLLMContext({ days });
                      return fmt === "markdown" ? contextToMarkdown(ctx) : JSON.stringify(ctx, null, 2);
                    })();
                    const blobPromise = textPromise.then(t => new Blob([t], { type: "text/plain" }));
                    await navigator.clipboard.write([new ClipboardItem({ "text/plain": blobPromise })]);
                    exportStatus.value = "copied";
                    setTimeout(() => { exportStatus.value = null; }, 3000);
                  } catch (e) {
                    console.error("Export failed:", e);
                    exportStatus.value = "error";
                    setTimeout(() => { exportStatus.value = null; }, 3000);
                  }
                }}
                disabled=${exportStatus.value === "loading"}
                class="text-xs transition-colors"
                style="color: var(--accent);"
              >
                ${exportStatus.value === "loading" ? "Building export..." : exportStatus.value === "copied" ? "Copied to clipboard!" : exportStatus.value === "error" ? "Export failed" : "Copy training data to clipboard"}
              </button>
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
