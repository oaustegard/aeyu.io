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
const PAGE_SIZE = 200;

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

// --- Phase 1: Activity List Backfill ---

async function fetchActivityList() {
  const state = await getSyncState();
  let page = state.backfill_complete ? 1 : state.backfill_page;
  let allNew = [];
  let lastActivityDate = state.last_activity_fetch;

  syncProgress.value = {
    ...syncProgress.value,
    phase: "list",
    message: "Fetching activity list...",
  };

  while (true) {
    if (isRateLimited()) {
      await updateSyncState({ backfill_page: page });
      throw new RateLimitError(900);
    }

    const params = new URLSearchParams({
      per_page: String(PAGE_SIZE),
      page: String(page),
    });

    // For incremental sync, only fetch after last known activity
    if (state.backfill_complete && lastActivityDate) {
      params.set(
        "after",
        String(Math.floor(new Date(lastActivityDate).getTime() / 1000))
      );
    } else if (!state.backfill_complete) {
      params.set("after", "0");
    }

    const activities = await stravaFetch(
      `/athlete/activities?${params}`
    );

    if (activities.length === 0) break;

    // Mark as needing detail fetch — include power fields from summary
    const summaries = activities.map((a) => ({
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
      has_efforts: false,
      segment_efforts: [],
    }));

    await putActivities(summaries);
    allNew.push(...summaries);

    syncProgress.value = {
      ...syncProgress.value,
      fetched: syncProgress.value.fetched + activities.length,
      message: `Fetched ${syncProgress.value.fetched + activities.length} activities...`,
    };

    // Track the most recent activity date
    if (activities.length > 0) {
      const newest = activities[0].start_date;
      if (!lastActivityDate || newest > lastActivityDate) {
        lastActivityDate = newest;
      }
    }

    page++;

    if (activities.length < PAGE_SIZE) break;
  }

  await updateSyncState({
    backfill_page: page,
    backfill_complete: true,
    fetched_activities: (await getSyncState()).fetched_activities + allNew.length,
    last_activity_fetch: lastActivityDate,
  });

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
      };

      await putActivity(updated);

      // Denormalize into segments store — include power in effort record
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

// --- Public API ---

/**
 * Start full backfill — list all activities, then fetch details.
 * Resumable: checks has_efforts flag and sync_state on restart.
 */
export async function startBackfill() {
  if (isSyncing.value) return;
  isSyncing.value = true;

  try {
    syncProgress.value = {
      phase: "list",
      fetched: 0,
      total: null,
      detailed: 0,
      detailTotal: null,
      message: "Starting backfill...",
    };

    await fetchActivityList();
    await runPowerMigration();
    const detailed = await fetchActivityDetails();

    const remaining = await getActivitiesWithoutEfforts();

    if (remaining.length === 0) {
      syncProgress.value = {
        ...syncProgress.value,
        phase: "done",
        message: "Backfill complete!",
      };
      await updateSyncState({ last_sync: new Date().toISOString() });
    } else {
      syncProgress.value = {
        ...syncProgress.value,
        phase: "done",
        message: `Paused — ${remaining.length} activities still need details. Re-open to continue.`,
      };
    }

    return detailed;
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
 * Incremental sync — fetch only new activities since last sync.
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

    const newActivities = await fetchActivityList();

    if (newActivities.length > 0) {
      syncProgress.value = {
        ...syncProgress.value,
        message: `Found ${newActivities.length} new activities. Fetching details...`,
      };
      await fetchActivityDetails();
    }

    syncProgress.value = {
      ...syncProgress.value,
      phase: "done",
      message: newActivities.length
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
    });
  }

  return updated;
}
