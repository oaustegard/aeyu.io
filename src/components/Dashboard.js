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
import { renderIconSVG } from "../icons.js";
import { AWARD_LABELS } from "../award-config.js";
import { computeFitnessSummary } from "../fitness.js";

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
const streakData = signal(null);
const fitnessData = signal(null);

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

    // Compute streak data (#58) — uses all activities, not just recent 20
    if (activities.length > 0) {
      streakData.value = computeStreakData(activities);
    }

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

    // Compute fitness indicators (#106)
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

    // Start automatic background sync — handles backfill, incremental,
    // rate limit cooldowns, and periodic checks for new activities.
    if (!isDemo.value) {
      startAutoSync(() => loadDashboard());
    }

    return () => stopAutoSync();
  }, []);

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
    <div class="min-h-screen" style="background: var(--bg);">
      <!-- Header -->
      <header class="px-6 py-4" style="background: var(--surface); border-bottom: 1px solid var(--border);">
        <div class="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 style="font-family: var(--font-display); font-size: 1.25rem; color: var(--text);">Participation Awards</h1>
            ${auth && html`
              <p style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                ${auth.athlete.firstname} ${auth.athlete.lastname}
                ${isDemo.value && html`<span class="ml-2 text-xs px-2 py-0.5 rounded-full font-medium" style="background: #FBF0D8; color: #6E5010;">Demo</span>`}
              </p>
            `}
          </div>
          <div class="flex items-center gap-3">
            <!-- Unit toggle -->
            <button
              onClick=${handleUnitToggle}
              class="text-xs px-2.5 py-1.5 rounded-lg transition-colors"
              style="border: 1px solid var(--border); color: var(--text-secondary); font-family: var(--font-mono);"
              title="Toggle metric/imperial"
            >
              ${units === "metric" ? "km" : "mi"}
            </button>
            ${isDemo.value ? html`
              <button
                onClick=${async () => { await exitDemo(); authState.value = null; navigate(""); }}
                class="text-xs font-medium transition-colors"
                style="color: var(--accent);"
              >Exit Demo</button>
            ` : syncing ? html`
              <div class="inline-flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg" style="font-family: var(--font-body); color: var(--text-secondary);">
                <div class="w-3.5 h-3.5 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0" style="border-color: var(--strava); border-top-color: transparent;"></div>
                <span>Syncing</span>
              </div>
            ` : ""}
            <button
              onClick=${() => { showFaq.value = !showFaq.value; }}
              class="transition-colors"
              style="color: var(--text-tertiary);"
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
            <p class="font-medium mb-1">Initial sync paused</p>
            <p>
              Your full activity history is still loading. Strava limits API requests,
              so this happens over a few sessions. Sync will resume automatically.
            </p>
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

        <!-- Fitness Indicators (#106) -->
        ${!loading.value && fitnessData.value && (fitnessData.value.performanceCapacity.hasData || fitnessData.value.aerobicEfficiency.hasData) && html`
          <div class="mb-6 rounded-xl p-5" style="background: var(--surface); border: 1px solid var(--border);">
            <h2 style="font-family: var(--font-display); font-size: 1.125rem; color: var(--text); margin-bottom: 1rem;">Fitness Indicators</h2>

            <div class="grid grid-cols-1 gap-4" style="${fitnessData.value.performanceCapacity.hasData && fitnessData.value.aerobicEfficiency.hasData ? 'display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;' : ''}">

              <!-- Performance Capacity -->
              ${fitnessData.value.performanceCapacity.hasData && html`
                <div class="rounded-lg p-4" style="background: var(--bg); border: 1px solid var(--border);">
                  <div class="flex items-center gap-2 mb-2">
                    <span style="font-family: var(--font-body); font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary);">Performance Capacity</span>
                    ${fitnessData.value.performanceCapacity.trend != null && html`
                      <span style="font-size: 0.75rem; color: ${fitnessData.value.performanceCapacity.trend > 2 ? '#3D7A4A' : fitnessData.value.performanceCapacity.trend < -2 ? '#A05060' : 'var(--text-tertiary)'};">
                        ${fitnessData.value.performanceCapacity.trend > 2 ? '\u2191' : fitnessData.value.performanceCapacity.trend < -2 ? '\u2193' : '\u2192'}
                      </span>
                    `}
                  </div>
                  <div style="font-family: var(--font-display); font-size: 2rem; color: var(--text);">${fitnessData.value.performanceCapacity.score}</div>
                  <div style="font-family: var(--font-body); font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.25rem;">
                    from ${fitnessData.value.performanceCapacity.segments.length} climb${fitnessData.value.performanceCapacity.segments.length !== 1 ? 's' : ''}
                  </div>
                  <!-- Mini segment breakdown -->
                  ${fitnessData.value.performanceCapacity.segments.slice(0, 3).map((seg) => html`
                    <div class="mt-2 flex justify-between items-center" style="font-size: 0.75rem; color: var(--text-secondary);">
                      <span class="truncate" style="max-width: 70%;">${seg.segmentName}</span>
                      <span style="font-family: var(--font-mono); color: var(--text);">${Math.round(seg.score)}</span>
                    </div>
                  `)}
                </div>
              `}

              <!-- Aerobic Efficiency -->
              ${fitnessData.value.aerobicEfficiency.hasData && html`
                <div class="rounded-lg p-4" style="background: var(--bg); border: 1px solid var(--border);">
                  <div class="flex items-center gap-2 mb-2">
                    <span style="font-family: var(--font-body); font-size: 0.8125rem; font-weight: 500; color: var(--text-secondary);">Aerobic Efficiency</span>
                    ${fitnessData.value.aerobicEfficiency.ef.trend != null && html`
                      <span style="font-size: 0.75rem; color: ${fitnessData.value.aerobicEfficiency.ef.trend > 2 ? '#3D7A4A' : fitnessData.value.aerobicEfficiency.ef.trend < -2 ? '#A05060' : 'var(--text-tertiary)'};">
                        ${fitnessData.value.aerobicEfficiency.ef.trend > 2 ? '\u2191' : fitnessData.value.aerobicEfficiency.ef.trend < -2 ? '\u2193' : '\u2192'}
                        ${fitnessData.value.aerobicEfficiency.ef.trend != null ? ` ${Math.abs(fitnessData.value.aerobicEfficiency.ef.trend).toFixed(1)}%` : ''}
                      </span>
                    `}
                  </div>
                  <div style="font-family: var(--font-display); font-size: 2rem; color: var(--text);">${fitnessData.value.aerobicEfficiency.ef.current}</div>
                  <div style="font-family: var(--font-body); font-size: 0.75rem; color: var(--text-tertiary); margin-top: 0.25rem;">
                    EF ${fitnessData.value.aerobicEfficiency.ef.hasPowerData ? '(W/bpm)' : '(speed/bpm)'}
                    \u2022 ${fitnessData.value.aerobicEfficiency.ef.recentCount} recent rides
                  </div>
                  <!-- Monthly EF trend (last 6 months) -->
                  ${fitnessData.value.aerobicEfficiency.ef.monthlyHistory.length > 1 && html`
                    <div class="mt-3" style="display: flex; align-items: flex-end; gap: 2px; height: 40px;">
                      ${fitnessData.value.aerobicEfficiency.ef.monthlyHistory.slice(-6).map((m) => {
                        const allEf = fitnessData.value.aerobicEfficiency.ef.monthlyHistory;
                        const maxEf = Math.max(...allEf.map((x) => x.ef));
                        const minEf = Math.min(...allEf.map((x) => x.ef));
                        const range = maxEf - minEf || 1;
                        const pct = ((m.ef - minEf) / range) * 100;
                        return html`
                          <div style="flex: 1; display: flex; flex-direction: column; align-items: center; gap: 2px;">
                            <div style="width: 100%; background: #4882A8; border-radius: 2px; min-height: 4px; height: ${Math.max(15, pct)}%;" title="${m.month}: EF ${m.ef}"></div>
                            <span style="font-size: 0.5625rem; color: var(--text-tertiary); font-family: var(--font-mono);">${m.month.slice(5)}</span>
                          </div>
                        `;
                      })}
                    </div>
                  `}
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

        <!-- Loading -->
        ${loading.value && html`
          <div class="text-center py-12" style="color: var(--text-tertiary);">Loading activities...</div>
        `}

        <!-- Activity list -->
        ${!loading.value && html`
          <div class="space-y-3">
            <h2 style="font-family: var(--font-display); font-size: 1.125rem; color: var(--text);">Recent Activities</h2>
            ${recentActivities.value.length === 0 && html`
              <p class="text-center py-8" style="color: var(--text-tertiary);">
                ${syncing ? "Activities will appear here as they sync..." : "No activities yet. Tap Sync Now to get started."}
              </p>
            `}
            ${recentActivities.value.map((activity) => {
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
                  onClick=${() => navigate(`activity/${activity.id}`)}
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
                              <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style=${pillStyle}>
                                ${al ? renderIconSVG(s.type, { size: 12, color: al.dot }) : null}
                                Season First: ${routeName}${freq ? ` — ${freq} times` : ""}
                              </span>
                            `;
                          }
                          return html`
                            <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style=${pillStyle}>
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
        `}

        <!-- Powered by Strava -->
        <div class="text-center mt-12 mb-6">
          <p style="font-family: var(--font-body); font-size: 0.75rem; color: var(--text-tertiary);">Powered by Strava</p>
        </div>
      </main>

      <!-- FAQ Modal Overlay -->
      ${showFaq.value && html`
        <div
          class="fixed inset-0 z-50 flex items-start justify-center bg-black/40 backdrop-blur-sm overflow-y-auto p-4 pt-16 sm:pt-24"
          onClick=${(e) => { if (e.target === e.currentTarget) showFaq.value = false; }}
        >
          <div class="rounded-xl shadow-xl w-full max-w-lg p-6 my-4" style="background: var(--surface); border: 1px solid var(--border);">
            <div class="flex items-center justify-between mb-4">
              <h2 style="font-family: var(--font-display); font-size: 1.125rem; color: var(--text);">FAQ & Settings</h2>
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
                  What are the Fitness Indicators?
                  <svg class="w-4 h-4 group-open:rotate-180 transition-transform flex-shrink-0 ml-2" style="color: var(--text-tertiary);" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
                </summary>
                <div class="pt-3 pb-1 space-y-2" style="font-family: var(--font-body); font-size: 0.875rem; color: var(--text-secondary);">
                  <p><strong>Performance Capacity</strong> (0-100) measures what your body can produce. It tracks your climb segment times, converts them to estimated power-to-weight (VAM/Ferrari formula), and ranks recent efforts against your own history. Requires at least 3 climb segments with 3+ efforts each.</p>
                  <p><strong>Aerobic Efficiency</strong> measures output per heartbeat (Efficiency Factor = power/HR or speed/HR). Higher is better. Only appears when your activities include heart rate data.</p>
                  <p>Together they tell a training story: rising capacity + rising efficiency = ideal. Rising capacity + falling efficiency = possible overreaching.</p>
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

            <div class="mt-4 pt-4 space-y-3" style="border-top: 1px solid var(--border-light);">
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
              ${!isDemo.value && html`
                <div>
                  <button
                    onClick=${async () => {
                      try {
                        await manualSync();
                      } catch (e) {
                        console.error("Manual sync error:", e);
                      }
                      await loadDashboard();
                    }}
                    disabled=${syncing}
                    class="text-xs font-medium transition-colors inline-flex items-center gap-1.5"
                    style=${syncing
                      ? "color: var(--text-tertiary); cursor: not-allowed;"
                      : "color: var(--strava);"}
                  >
                    ${syncing ? html`
                      <div class="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin flex-shrink-0" style="border-color: var(--strava); border-top-color: transparent;"></div>
                      Syncing…
                    ` : "Sync now"}
                  </button>
                  <p class="text-xs mt-1" style="color: var(--border);">Check Strava for new activities. The app syncs automatically every 5 minutes.</p>
                </div>
              `}
              ${isDemo.value ? html`
                <div>
                  <button
                    onClick=${async () => { await exitDemo(); authState.value = null; navigate(""); }}
                    class="text-xs font-medium transition-colors"
                    style="color: var(--accent);"
                  >
                    Exit Demo Mode
                  </button>
                  <p class="text-xs mt-1" style="color: var(--border);">Returns to the landing page. Demo data is discarded.</p>
                </div>
              ` : html`
                <div>
                  <button
                    onClick=${handleDisconnect}
                    class="text-xs transition-colors"
                    style="color: var(--text-tertiary);"
                  >
                    Disconnect Strava
                  </button>
                  <p class="text-xs mt-1" style="color: var(--border);">Removes your login session. Synced data stays in your browser.</p>
                </div>
              `}
              <div>
                <button
                  onClick=${() => { showDeleteConfirm.value = !showDeleteConfirm.value; deleteConfirmText.value = ""; }}
                  class="text-xs transition-colors"
                  style="color: var(--text-tertiary);"
                >
                  Delete all data
                </button>
                <p class="text-xs mt-1" style="color: var(--border);">Permanently removes all synced activities, segments, and login from this browser.</p>
                ${showDeleteConfirm.value && html`
                  <div class="mt-2 p-3 rounded-lg" style="background: #F6DED4; border: 1px solid #E4B8A4;">
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
                          navigate("");
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
            </div>
          </div>
        </div>
      `}
    </div>
  `;
}
