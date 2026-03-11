/**
 * Participation Awards — Strava Sync Engine
 * Handles activity backfill (list + detail) and incremental sync.
 */

import { signal } from "@preact/signals";
import { STRAVA_API_BASE } from "./config.js";
import { getValidToken } from "./auth.js";
import {
  putActivities,
  putActivity,
  getActivity,
  getActivitiesWithoutEfforts,
  getActivitiesWithoutPower,
  getActivitiesWithoutHeartRate,
  getSyncState,
  updateSyncState,
  appendEffort,
  removeEffortsForActivity,
} from "./db.js";

// --- Signals ---

export const syncProgress = signal({
  phase: "idle", // idle | list | detail | incremental | done | error
  fetched: 0,
  total: null,
  detailed: 0,
  detailTotal: null,
  message: "",
});

export const rateLimitStatus = signal({
  shortUsage: 0,
  shortLimit: 100,
  dailyUsage: 0,
  dailyLimit: 1000,
});

export const isSyncing = signal(false);

const BATCH_SIZE = 80;
const RATE_LIMIT_THRESHOLD = 0.8;
const LIST_PAGE_SIZE = 100; // Smaller pages for interleaved list+detail sync

// Cycling-related sport types — filter out walks, runs, swims, etc.
const CYCLING_SPORT_TYPES = new Set([
  "Ride", "VirtualRide", "MountainBikeRide", "GravelRide", "EBikeRide",
  "EMountainBikeRide", "Velomobile", "Handcycle",
]);

function isCyclingActivity(activity) {
  return CYCLING_SPORT_TYPES.has(activity.sport_type);
}

// --- Rate Limit Tracking ---

function parseRateLimits(response) {
  const usage = response.headers.get("X-Ratelimit-Usage");
  const limit = response.headers.get("X-Ratelimit-Limit");
  if (usage && limit) {
    const [shortUsage, dailyUsage] = usage.split(",").map(Number);
    const [shortLimit, dailyLimit] = limit.split(",").map(Number);
    rateLimitStatus.value = { shortUsage, shortLimit, dailyUsage, dailyLimit };
  }
}

function isRateLimited() {
  const { shortUsage, shortLimit, dailyUsage, dailyLimit } =
    rateLimitStatus.value;
  return (
    shortUsage / shortLimit > RATE_LIMIT_THRESHOLD ||
    dailyUsage / dailyLimit > RATE_LIMIT_THRESHOLD
  );
}

// --- API Helpers ---

async function stravaFetch(path) {
  const token = await getValidToken();
  const response = await fetch(`${STRAVA_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  parseRateLimits(response);

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get("Retry-After") || "900");
    throw new RateLimitError(retryAfter);
  }

  if (!response.ok) {
    throw new Error(`Strava API error: ${response.status}`);
  }

  return response.json();
}

class RateLimitError extends Error {
  constructor(retryAfter) {
    super(`Rate limited. Retry after ${retryAfter}s`);
    this.retryAfter = retryAfter;
  }
}

// --- Phase 1: Activity List (page-at-a-time) ---

function toActivitySummary(a) {
  return {
    id: a.id,
    name: a.name,
    sport_type: a.sport_type,
    start_date: a.start_date,
    start_date_local: a.start_date_local,
    distance: a.distance,
    moving_time: a.moving_time,
    elapsed_time: a.elapsed_time,
    total_elevation_gain: a.total_elevation_gain,
    average_speed: a.average_speed,
    max_speed: a.max_speed,
    // Power fields (from activity summary)
    average_watts: a.average_watts || null,
    max_watts: a.max_watts || null,
    weighted_average_watts: a.weighted_average_watts || null,
    device_watts: a.device_watts || false,
    kilojoules: a.kilojoules || null,
    trainer: a.trainer || false,
    // Heart rate fields (#106)
    has_heartrate: a.has_heartrate || false,
    average_heartrate: a.average_heartrate || null,
    max_heartrate: a.max_heartrate || null,
    // Group ride detection fields (#58)
    start_latlng: a.start_latlng || null,
    athlete_count: a.athlete_count || 1,
    has_efforts: false,
    segment_efforts: [],
  };
}

/**
 * Fetch a single page of activities from the Strava API.
 * @param {number} page - Page number (1-based)
 * @param {Object} opts
 * @param {number|null} opts.afterEpoch - Strava `after` param (epoch seconds). Only used for incremental sync.
 * @param {number|null} opts.cutoffEpoch - Client-side cutoff: discard activities before this epoch.
 *   Used during backfill so we don't pass `after` to Strava (which changes sort order to oldest-first).
 * Returns { summaries, hasMore, newestDate, hitCutoff }.
 */
async function fetchActivityListPage(page, { afterEpoch = null, cutoffEpoch = null } = {}) {
  if (isRateLimited()) {
    throw new RateLimitError(900);
  }

  const params = new URLSearchParams({
    per_page: String(LIST_PAGE_SIZE),
    page: String(page),
  });

  if (afterEpoch) {
    params.set("after", String(afterEpoch));
  }

  const activities = await stravaFetch(`/athlete/activities?${params}`);

  if (activities.length === 0) {
    return { summaries: [], hasMore: false, newestDate: null, hitCutoff: false };
  }

  // Without `after`, Strava returns newest first. Apply client-side cutoff
  // to stop at the sync window boundary without changing sort order.
  let filtered = activities;
  let hitCutoff = false;
  if (cutoffEpoch && !afterEpoch) {
    filtered = activities.filter(
      (a) => new Date(a.start_date).getTime() / 1000 >= cutoffEpoch
    );
    hitCutoff = filtered.length < activities.length;
  }

  // Filter to cycling activities only
  filtered = filtered.filter(isCyclingActivity);

  if (filtered.length === 0) {
    // If we had activities but all were non-cycling, there may be more pages
    return { summaries: [], hasMore: activities.length >= LIST_PAGE_SIZE && !hitCutoff, newestDate: null, hitCutoff };
  }

  const summaries = filtered.map(toActivitySummary);
  await putActivities(summaries);

  // Strava returns newest first (without `after` param); track the most recent date
  const newestDate = filtered[0].start_date;

  return {
    summaries,
    hasMore: activities.length >= LIST_PAGE_SIZE && !hitCutoff,
    newestDate,
    hitCutoff,
  };
}

/**
 * Fetch ALL pages of new activities (used for incremental sync).
 * Returns all new activity summaries.
 */
async function fetchAllNewActivities(lastActivityDate) {
  let page = 1;
  let allNew = [];
  const afterEpoch = lastActivityDate
    ? Math.floor(new Date(lastActivityDate).getTime() / 1000)
    : undefined;

  syncProgress.value = {
    ...syncProgress.value,
    phase: "list",
    message: "Checking for new activities...",
  };

  while (true) {
    const result = await fetchActivityListPage(page, { afterEpoch });

    if (result.summaries.length > 0) {
      allNew.push(...result.summaries);
      syncProgress.value = {
        ...syncProgress.value,
        fetched: syncProgress.value.fetched + result.summaries.length,
        message: `Found ${syncProgress.value.fetched + result.summaries.length} new activities...`,
      };
    }

    if (!result.hasMore) break;
    page++;
  }

  // Update last_activity_fetch if we found newer activities
  // Note: with `after` param, Strava may not return newest first,
  // so find the actual newest date across all results
  if (allNew.length > 0) {
    const newestDate = allNew.reduce((latest, a) =>
      !latest || a.start_date > latest ? a.start_date : latest, null);
    const state = await getSyncState();
    const currentNewest = state.last_activity_fetch;
    if (!currentNewest || newestDate > currentNewest) {
      await updateSyncState({ last_activity_fetch: newestDate });
    }
  }

  return allNew;
}

// --- Phase 2: Detail Backfill ---

async function fetchActivityDetails() {
  const pending = await getActivitiesWithoutEfforts();
  if (pending.length === 0) return [];

  syncProgress.value = {
    ...syncProgress.value,
    phase: "detail",
    detailed: 0,
    detailTotal: pending.length,
    message: `Loading activity details: 0/${pending.length}`,
  };

  const detailed = [];
  let batchCount = 0;

  for (const activity of pending) {
    if (isRateLimited()) {
      syncProgress.value = {
        ...syncProgress.value,
        message: `Rate limit approaching — pausing. ${detailed.length}/${pending.length} detailed.`,
      };
      break;
    }

    try {
      const full = await stravaFetch(
        `/activities/${activity.id}?include_all_efforts=true`
      );

      const efforts = (full.segment_efforts || []).map((e) => ({
        id: e.id,
        name: e.name,
        segment: {
          id: e.segment.id,
          name: e.segment.name,
          distance: e.segment.distance,
          average_grade: e.segment.average_grade,
          elevation_high: e.segment.elevation_high,
          elevation_low: e.segment.elevation_low,
          climb_category: e.segment.climb_category,
        },
        elapsed_time: e.elapsed_time,
        moving_time: e.moving_time,
        start_date: e.start_date,
        start_date_local: e.start_date_local,
        pr_rank: e.pr_rank || null,
        achievements: e.achievements || [],
        // Power fields per segment effort
        average_watts: e.average_watts || null,
        device_watts: e.device_watts || false,
        // Heart rate fields per segment effort (#106)
        average_heartrate: e.average_heartrate || null,
        max_heartrate: e.max_heartrate || null,
      }));

      const updated = {
        ...activity,
        has_efforts: true,
        segment_efforts: efforts,
        // Update power fields from detail response (more complete than summary)
        average_watts: full.average_watts || activity.average_watts || null,
        max_watts: full.max_watts || activity.max_watts || null,
        weighted_average_watts: full.weighted_average_watts || activity.weighted_average_watts || null,
        device_watts: full.device_watts || activity.device_watts || false,
        kilojoules: full.kilojoules || activity.kilojoules || null,
        trainer: full.trainer || activity.trainer || false,
        // Heart rate fields from detail response (#106)
        has_heartrate: full.has_heartrate || false,
        average_heartrate: full.average_heartrate || null,
        max_heartrate: full.max_heartrate || null,
        // Group ride detection fields (#58)
        start_latlng: full.start_latlng || activity.start_latlng || null,
        athlete_count: full.athlete_count || activity.athlete_count || 1,
      };

      await putActivity(updated);

      // Denormalize into segments store — include power + HR in effort record
      for (const effort of efforts) {
        await appendEffort(effort.segment.id, effort.segment, {
          effort_id: effort.id,
          activity_id: activity.id,
          elapsed_time: effort.elapsed_time,
          moving_time: effort.moving_time,
          start_date: effort.start_date,
          start_date_local: effort.start_date_local,
          pr_rank: effort.pr_rank,
          average_watts: effort.average_watts,
          device_watts: effort.device_watts,
          average_heartrate: effort.average_heartrate,
          max_heartrate: effort.max_heartrate,
        });
      }

      detailed.push(updated);
      batchCount++;

      syncProgress.value = {
        ...syncProgress.value,
        detailed: detailed.length,
        message: `Loading activity details: ${detailed.length}/${pending.length}`,
      };

      // Pause after each batch
      if (batchCount >= BATCH_SIZE) {
        const state = await getSyncState();
        await updateSyncState({
          detailed_activities: state.detailed_activities + batchCount,
        });
        batchCount = 0;

        if (isRateLimited()) {
          syncProgress.value = {
            ...syncProgress.value,
            message: `Batch complete. Rate limit approaching — pausing at ${detailed.length}/${pending.length}.`,
          };
          break;
        }
      }
    } catch (err) {
      if (err instanceof RateLimitError) {
        syncProgress.value = {
          ...syncProgress.value,
          message: `Rate limited. ${detailed.length}/${pending.length} detailed. Retry in ${Math.ceil(err.retryAfter / 60)} min.`,
        };
        break;
      }
      // Skip individual activity errors but continue
      console.warn(`Failed to fetch activity ${activity.id}:`, err);
    }
  }

  // Final state update
  if (batchCount > 0) {
    const state = await getSyncState();
    await updateSyncState({
      detailed_activities: state.detailed_activities + batchCount,
    });
  }

  return detailed;
}

// --- Phase 3: Power Fields Migration ---

/**
 * One-time migration for activities stored before power tracking (pre-486be78).
 * Instead of re-fetching from the list API, resets has_efforts on legacy
 * activities so the detail fetch pipeline re-processes them — capturing
 * both activity-level AND segment-effort-level power fields.
 * Triggered when schema_version is missing or below 2.
 */
async function runPowerMigration() {
  const state = await getSyncState();
  if (state.schema_version >= 2) return;

  const legacy = await getActivitiesWithoutPower();
  // Only consider activities that already had details fetched
  const needsRefetch = legacy.filter((a) => a.has_efforts);

  if (needsRefetch.length === 0) {
    await updateSyncState({ schema_version: 2, power_backfill_complete: true });
    return;
  }

  syncProgress.value = {
    ...syncProgress.value,
    phase: "detail",
    message: `Migrating ${needsRefetch.length} activities for power data...`,
  };

  // Reset has_efforts so fetchActivityDetails() will re-fetch them
  const reset = needsRefetch.map((a) => ({ ...a, has_efforts: false }));
  await putActivities(reset);

  await updateSyncState({ schema_version: 2, power_backfill_complete: true });
}

// --- Phase 4: Heart Rate Fields Migration (#106) ---

/**
 * One-time migration for activities stored before HR tracking.
 * Resets has_efforts on legacy activities so the detail fetch pipeline
 * re-processes them — capturing activity-level and effort-level HR fields.
 * Triggered when schema_version is below 3.
 */
async function runHeartRateMigration() {
  const state = await getSyncState();
  if (state.schema_version >= 3) return;

  const legacy = await getActivitiesWithoutHeartRate();
  const needsRefetch = legacy.filter((a) => a.has_efforts);

  if (needsRefetch.length === 0) {
    await updateSyncState({ schema_version: 3 });
    return;
  }

  syncProgress.value = {
    ...syncProgress.value,
    phase: "detail",
    message: `Migrating ${needsRefetch.length} activities for heart rate data...`,
  };

  // Reset has_efforts so fetchActivityDetails() will re-fetch them
  const reset = needsRefetch.map((a) => ({ ...a, has_efforts: false }));
  await putActivities(reset);

  await updateSyncState({ schema_version: 3 });
}

// --- Public API ---

// 13-month priority window — gives users a full year of context quickly
const INITIAL_WINDOW_MONTHS = 13;
const INITIAL_WINDOW_SECONDS = INITIAL_WINDOW_MONTHS * 30.44 * 24 * 3600;

// Default full sync window when user hasn't chosen (5 years)
const DEFAULT_SYNC_WINDOW_YEARS = 5;

/**
 * Run one pass of interleaved list+detail backfill within a cutoff window.
 * Returns true if completed (all pages fetched), false if interrupted (rate limit).
 */
async function runBackfillPass(cutoffEpoch, startPage, onProgress) {
  let page = startPage;
  let lastActivityDate = (await getSyncState()).last_activity_fetch;
  let totalFetched = 0;

  const windowLabel = cutoffEpoch
    ? `since ${new Date(cutoffEpoch * 1000).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
    : "all time";

  while (true) {
    syncProgress.value = {
      ...syncProgress.value,
      phase: "list",
      message: `Fetching rides ${windowLabel} (page ${page})...`,
    };

    const result = await fetchActivityListPage(page, { cutoffEpoch });

    if (result.summaries.length > 0) {
      totalFetched += result.summaries.length;

      if (result.newestDate && (!lastActivityDate || result.newestDate > lastActivityDate)) {
        lastActivityDate = result.newestDate;
      }

      syncProgress.value = {
        ...syncProgress.value,
        fetched: totalFetched,
        message: `Fetched ${totalFetched} rides. Loading details...`,
      };

      await updateSyncState({
        backfill_page: page + 1,
        fetched_activities: (await getSyncState()).fetched_activities + result.summaries.length,
        last_activity_fetch: lastActivityDate,
      });

      await fetchActivityDetails();
      if (onProgress) onProgress();
    }

    if (!result.hasMore) return true; // completed

    if (isRateLimited()) {
      syncProgress.value = {
        ...syncProgress.value,
        message: `Rate limit approaching — pausing after ${totalFetched} rides.`,
      };
      return false; // interrupted
    }

    page++;
  }
}

/**
 * Start full backfill — two-phase approach for API rate limit efficiency.
 *
 * Phase 1: Fetch the last 13 months of cycling activities. This gives users
 * a full year of segment history quickly (enough for year-best, season-first,
 * median/quartile awards).
 *
 * Phase 2: Once the 13-month window is complete, extend backfill to the full
 * sync window (default 5 years, configurable in settings).
 *
 * Only cycling activities are synced (Ride, VirtualRide, MountainBikeRide, etc.).
 * Resumable: checks sync_state on restart.
 *
 * @param {Function} [onProgress] - called after each page+detail cycle so the UI can refresh
 */
export async function startBackfill(onProgress) {
  if (isSyncing.value) return;
  isSyncing.value = true;

  try {
    syncProgress.value = {
      phase: "list",
      fetched: 0,
      total: null,
      detailed: 0,
      detailTotal: null,
      message: "Starting sync...",
    };

    const state = await getSyncState();

    // If backfill was already completed, this is a resume for pending details
    if (state.backfill_complete) {
      await runPowerMigration();
      await runHeartRateMigration();
      await fetchActivityDetails();
    } else {
      // Set full sync window default if not yet chosen by user
      if (state.sync_after_epoch === null && !state.initial_backfill_complete) {
        const defaultEpoch = Math.floor(Date.now() / 1000 - DEFAULT_SYNC_WINDOW_YEARS * 365.25 * 24 * 3600);
        await updateSyncState({ sync_after_epoch: defaultEpoch });
      }

      const fullSyncEpoch = (await getSyncState()).sync_after_epoch;

      // --- Phase 1: 13-month priority window ---
      if (!state.initial_backfill_complete) {
        const initialCutoff = Math.floor(Date.now() / 1000 - INITIAL_WINDOW_SECONDS);
        // Use the later of (13-month cutoff, full sync window) so we don't
        // exceed the user's chosen window if it's shorter than 13 months
        const phase1Cutoff = fullSyncEpoch ? Math.max(initialCutoff, fullSyncEpoch) : initialCutoff;

        const page = state.backfill_page || 1;
        const completed = await runBackfillPass(phase1Cutoff, page, onProgress);

        if (completed && !isRateLimited()) {
          await updateSyncState({ initial_backfill_complete: true, backfill_page: 1 });

          // If the full window is the same as phase 1, skip phase 2
          if (fullSyncEpoch && fullSyncEpoch >= phase1Cutoff) {
            await updateSyncState({ backfill_complete: true });
          }
        }
      }

      // --- Phase 2: Full sync window (historical backfill) ---
      const refreshedState = await getSyncState();
      if (refreshedState.initial_backfill_complete && !refreshedState.backfill_complete && !isRateLimited()) {
        syncProgress.value = {
          ...syncProgress.value,
          message: "Expanding to full history...",
        };

        const page = refreshedState.backfill_page || 1;
        const completed = await runBackfillPass(fullSyncEpoch, page, onProgress);

        if (completed && !isRateLimited()) {
          await updateSyncState({ backfill_complete: true });
        }
      }

      // Run migrations after full backfill completes
      if ((await getSyncState()).backfill_complete && !isRateLimited()) {
        await runPowerMigration();
        await runHeartRateMigration();
        await fetchActivityDetails();
      }
    }

    const remaining = await getActivitiesWithoutEfforts();

    if (remaining.length === 0) {
      const s = await getSyncState();
      const phaseMsg = s.backfill_complete
        ? "Sync complete!"
        : s.initial_backfill_complete
          ? "Recent history synced! Historical backfill continues in background."
          : "Sync paused.";
      syncProgress.value = {
        ...syncProgress.value,
        phase: "done",
        message: phaseMsg,
      };
      await updateSyncState({ last_sync: new Date().toISOString() });
    } else {
      syncProgress.value = {
        ...syncProgress.value,
        phase: "done",
        message: `Paused — ${remaining.length} activities still need details. Re-open to continue.`,
      };
    }
  } catch (err) {
    syncProgress.value = {
      ...syncProgress.value,
      phase: "error",
      message: err.message,
    };
    throw err;
  } finally {
    isSyncing.value = false;
  }
}

/**
 * Incremental sync — fetch new activities since last sync, detail them first,
 * then continue any pending detail backfill from prior sessions.
 */
export async function incrementalSync() {
  if (isSyncing.value) return;
  isSyncing.value = true;

  try {
    syncProgress.value = {
      phase: "incremental",
      fetched: 0,
      total: null,
      detailed: 0,
      detailTotal: null,
      message: "Checking for new activities...",
    };

    const state = await getSyncState();
    const newActivities = await fetchAllNewActivities(state.last_activity_fetch);

    if (newActivities.length > 0) {
      syncProgress.value = {
        ...syncProgress.value,
        message: `Found ${newActivities.length} new activities. Fetching details...`,
      };
      // Detail-fetch prioritizes newest first (getActivitiesWithoutEfforts sorts desc)
      await fetchActivityDetails();
    }

    // Resume any pending details from prior rate-limited sessions
    const pending = await getActivitiesWithoutEfforts();
    if (pending.length > 0) {
      syncProgress.value = {
        ...syncProgress.value,
        message: `Resuming detail fetch for ${pending.length} remaining activities...`,
      };
      await fetchActivityDetails();
    }

    const stillPending = await getActivitiesWithoutEfforts();
    syncProgress.value = {
      ...syncProgress.value,
      phase: "done",
      message: stillPending.length > 0
        ? `Synced ${newActivities.length} new. ${stillPending.length} activities still need details.`
        : newActivities.length
          ? `Synced ${newActivities.length} new activities.`
          : "Already up to date.",
    };

    await updateSyncState({ last_sync: new Date().toISOString() });
    return newActivities;
  } catch (err) {
    syncProgress.value = {
      ...syncProgress.value,
      phase: "error",
      message: err.message,
    };
    throw err;
  } finally {
    isSyncing.value = false;
  }
}

/**
 * Update the sync window cutoff (#111).
 * If the window is extended (sync_after_epoch moved earlier or removed),
 * resets backfill so the newly-included period gets fetched.
 * If the window is shrunk, just updates the preference — no data deleted.
 * @param {number|null} newEpoch - Unix timestamp cutoff, or null for all-time
 */
export async function updateSyncWindow(newEpoch) {
  const state = await getSyncState();
  const oldEpoch = state.sync_after_epoch || null;

  await updateSyncState({ sync_after_epoch: newEpoch });

  // If window was extended (new epoch is earlier or removed), trigger re-backfill
  const windowExtended =
    (oldEpoch !== null && newEpoch === null) || // expanded to all-time
    (oldEpoch !== null && newEpoch !== null && newEpoch < oldEpoch); // moved earlier

  if (windowExtended && state.backfill_complete) {
    // Reset backfill so the new range gets fetched
    await updateSyncState({
      backfill_complete: false,
      backfill_page: 1,
    });
  }
}

/**
 * Manual sync — triggered by user from settings menu.
 * Runs backfill or incremental as appropriate, same as auto-sync cycle.
 * Returns without error on rate-limit (progress signal shows status).
 */
export async function manualSync(onProgress) {
  if (isSyncing.value) return;

  const state = await getSyncState();

  if (!state.backfill_complete) {
    await startBackfill(onProgress);
  } else {
    await incrementalSync();
  }
}

// --- Auto-Sync Scheduler ---

const SYNC_INTERVAL = 5 * 60 * 1000;       // 5 min between incremental checks
const RATE_LIMIT_COOLDOWN = 16 * 60 * 1000; // 16 min cooldown after hitting rate limit
const BACKFILL_PAUSE = 2 * 1000;            // 2s pause between backfill rounds

let autoSyncTimer = null;
let autoSyncCallback = null;

/**
 * Start automatic background syncing. Runs immediately, then schedules
 * repeats based on sync state and rate limits.
 * @param {Function} onComplete - called after each sync cycle (e.g. to reload UI)
 */
export function startAutoSync(onComplete) {
  if (autoSyncTimer) return;
  autoSyncCallback = onComplete || null;
  scheduleNext(0); // run immediately
}

/**
 * Stop the auto-sync scheduler.
 */
export function stopAutoSync() {
  if (autoSyncTimer) {
    clearTimeout(autoSyncTimer);
    autoSyncTimer = null;
  }
  autoSyncCallback = null;
}

function scheduleNext(delayMs) {
  if (autoSyncTimer) clearTimeout(autoSyncTimer);
  autoSyncTimer = setTimeout(runAutoSyncCycle, delayMs);
}

async function runAutoSyncCycle() {
  autoSyncTimer = null;

  // Don't run if already syncing (e.g. resyncActivity in progress)
  if (isSyncing.value) {
    scheduleNext(SYNC_INTERVAL);
    return;
  }

  try {
    const state = await getSyncState();

    if (!state.backfill_complete) {
      // Initial backfill — interleaved list+detail
      // Pass callback so dashboard refreshes after each page+detail cycle
      await startBackfill(autoSyncCallback);
    } else {
      // Incremental — check for new activities, resume pending details
      await incrementalSync();
    }

    // Notify UI to reload
    if (autoSyncCallback) autoSyncCallback();

    // Decide next interval
    const pending = await getActivitiesWithoutEfforts();

    if (pending.length > 0 && !isRateLimited()) {
      // More work to do and we have budget — continue soon
      scheduleNext(BACKFILL_PAUSE);
    } else if (isRateLimited()) {
      // Rate limited — wait for 15-min window to reset
      scheduleNext(RATE_LIMIT_COOLDOWN);
    } else {
      // Fully synced — check periodically for new activities
      scheduleNext(SYNC_INTERVAL);
    }
  } catch (err) {
    console.error("Auto-sync error:", err);
    if (autoSyncCallback) autoSyncCallback();

    if (err instanceof RateLimitError) {
      scheduleNext(RATE_LIMIT_COOLDOWN);
    } else {
      // Back off on unexpected errors
      scheduleNext(SYNC_INTERVAL);
    }
  }
}

/**
 * Resync a single activity from Strava.
 * Re-fetches detail, updates IndexedDB, replaces segment efforts, returns updated activity.
 */
export async function resyncActivity(activityId) {
  const existing = await getActivity(activityId);
  if (!existing) throw new Error("Activity not found in local database");

  const full = await stravaFetch(
    `/activities/${activityId}?include_all_efforts=true`
  );

  const efforts = (full.segment_efforts || []).map((e) => ({
    id: e.id,
    name: e.name,
    segment: {
      id: e.segment.id,
      name: e.segment.name,
      distance: e.segment.distance,
      average_grade: e.segment.average_grade,
      elevation_high: e.segment.elevation_high,
      elevation_low: e.segment.elevation_low,
      climb_category: e.segment.climb_category,
    },
    elapsed_time: e.elapsed_time,
    moving_time: e.moving_time,
    start_date: e.start_date,
    start_date_local: e.start_date_local,
    pr_rank: e.pr_rank || null,
    achievements: e.achievements || [],
    average_watts: e.average_watts || null,
    device_watts: e.device_watts || false,
    average_heartrate: e.average_heartrate || null,
    max_heartrate: e.max_heartrate || null,
  }));

  const updated = {
    ...existing,
    name: full.name,
    sport_type: full.sport_type,
    distance: full.distance,
    moving_time: full.moving_time,
    elapsed_time: full.elapsed_time,
    total_elevation_gain: full.total_elevation_gain,
    average_speed: full.average_speed,
    max_speed: full.max_speed,
    average_watts: full.average_watts || null,
    max_watts: full.max_watts || null,
    weighted_average_watts: full.weighted_average_watts || null,
    device_watts: full.device_watts || false,
    kilojoules: full.kilojoules || null,
    trainer: full.trainer || false,
    has_heartrate: full.has_heartrate || false,
    average_heartrate: full.average_heartrate || null,
    max_heartrate: full.max_heartrate || null,
    start_latlng: full.start_latlng || existing.start_latlng || null,
    athlete_count: full.athlete_count || existing.athlete_count || 1,
    has_efforts: true,
    segment_efforts: efforts,
  };

  await putActivity(updated);

  // Remove old efforts from segments store, then re-append
  await removeEffortsForActivity(activityId);
  for (const effort of efforts) {
    await appendEffort(effort.segment.id, effort.segment, {
      effort_id: effort.id,
      activity_id: activityId,
      elapsed_time: effort.elapsed_time,
      moving_time: effort.moving_time,
      start_date: effort.start_date,
      start_date_local: effort.start_date_local,
      pr_rank: effort.pr_rank,
      average_watts: effort.average_watts,
      device_watts: effort.device_watts,
      average_heartrate: effort.average_heartrate,
      max_heartrate: effort.max_heartrate,
    });
  }

  return updated;
}
