/**
 * Power Curve — Stream fetching and duration-based power bests (#48)
 *
 * Fetches second-by-second power data via the Strava Streams API and computes
 * best average power over standard durations (the "power curve").
 *
 * Standard durations:
 *   5s   — peak sprint
 *   30s  — sprint endurance
 *   60s  — anaerobic capacity
 *   300s — VO2max proxy (5 min)
 *   1200s — FTP proxy (20 min, subtract 5% for estimated FTP)
 *   3600s — sustained threshold (60 min)
 *
 * Power curve data is stored on the activity object as `power_curve`.
 * Only available for activities with device_watts === true.
 */

import { STRAVA_API_BASE } from "./config.js";
import { getValidToken } from "./auth.js";
import { getActivity, putActivity, getAllActivities } from "./db.js";
import { signal } from "@preact/signals";

/** Standard power curve durations in seconds */
export const POWER_CURVE_DURATIONS = [5, 30, 60, 300, 1200, 3600];

/** Human-readable labels for each duration */
export const DURATION_LABELS = {
  5: "5s",
  30: "30s",
  60: "1min",
  300: "5min",
  1200: "20min",
  3600: "60min",
};

/** Sync progress for power curve fetching */
export const powerCurveProgress = signal({
  phase: "idle", // idle | fetching | done | error
  current: 0,
  total: 0,
  message: "",
});

/**
 * Compute best average power for each standard duration using a sliding window.
 * Returns { 5: number, 30: number, 60: number, 300: number, 1200: number, 3600: number }
 * or null if watts array is too short for any computation.
 *
 * @param {number[]} watts — Per-second power values
 * @returns {Object|null} Power curve bests
 */
export function computePowerCurve(watts) {
  if (!watts || watts.length < 5) return null;

  const curve = {};
  // Build prefix sum for efficient sliding window
  const prefixSum = new Float64Array(watts.length + 1);
  for (let i = 0; i < watts.length; i++) {
    prefixSum[i + 1] = prefixSum[i] + watts[i];
  }

  for (const duration of POWER_CURVE_DURATIONS) {
    if (watts.length < duration) continue;
    let maxAvg = 0;
    for (let i = 0; i <= watts.length - duration; i++) {
      const avg = (prefixSum[i + duration] - prefixSum[i]) / duration;
      if (avg > maxAvg) maxAvg = avg;
    }
    curve[duration] = Math.round(maxAvg);
  }

  return Object.keys(curve).length > 0 ? curve : null;
}

/**
 * Estimate FTP from 20-minute best power (95% of 20-min best).
 * @param {Object} powerCurve — Power curve object
 * @returns {number|null} Estimated FTP in watts
 */
export function estimateFTP(powerCurve) {
  if (!powerCurve || !powerCurve[1200]) return null;
  return Math.round(powerCurve[1200] * 0.95);
}

/**
 * Fetch power stream for a single activity from Strava API.
 * Returns array of per-second watts, or null if unavailable.
 *
 * @param {number} activityId — Strava activity ID
 * @returns {number[]|null} Watts array
 */
async function fetchPowerStream(activityId) {
  const token = await getValidToken();
  const url = `${STRAVA_API_BASE}/activities/${activityId}/streams?keys=watts,time&key_by_type=true`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 404 || response.status === 403) {
    // No streams available for this activity
    return null;
  }

  if (response.status === 429) {
    const retryAfter = parseInt(response.headers.get("Retry-After") || "900");
    throw new RateLimitError(retryAfter);
  }

  if (!response.ok) {
    throw new Error(`Strava Streams API error: ${response.status}`);
  }

  const data = await response.json();

  // Streams API returns { watts: { data: [...] }, time: { data: [...] } }
  if (!data.watts || !data.watts.data) return null;

  return data.watts.data;
}

class RateLimitError extends Error {
  constructor(retryAfter) {
    super(`Rate limited. Retry after ${retryAfter}s`);
    this.retryAfter = retryAfter;
  }
}

/**
 * Fetch power stream and compute power curve for a single activity.
 * Stores the result on the activity object in IndexedDB.
 * No-ops if the activity already has a power_curve or lacks device_watts.
 *
 * @param {number} activityId — Activity ID
 * @returns {Object|null} Power curve, or null if unavailable
 */
export async function fetchAndComputePowerCurve(activityId) {
  const activity = await getActivity(activityId);
  if (!activity) return null;

  // Already computed
  if (activity.power_curve !== undefined) return activity.power_curve;

  // No power meter
  if (!activity.device_watts) {
    await putActivity({ ...activity, power_curve: null });
    return null;
  }

  try {
    const watts = await fetchPowerStream(activityId);
    const curve = watts ? computePowerCurve(watts) : null;
    await putActivity({ ...activity, power_curve: curve });
    return curve;
  } catch (err) {
    if (err instanceof RateLimitError) throw err;
    console.warn(`Failed to fetch power stream for activity ${activityId}:`, err);
    // Mark as attempted but failed — store null so we don't retry
    await putActivity({ ...activity, power_curve: null });
    return null;
  }
}

/**
 * Get all activities that need power curve computation.
 * These are activities with device_watts === true but no power_curve field.
 *
 * @returns {Array} Activities needing power curves
 */
export async function getActivitiesNeedingPowerCurves() {
  const all = await getAllActivities();
  return all.filter(
    (a) => a.device_watts && a.has_efforts && !("power_curve" in a)
  );
}

/**
 * Get all-time best power curve across all activities.
 * @returns {Object} { 5: number, 30: number, ... } all-time bests per duration
 */
export async function getAllTimeBestCurve() {
  const all = await getAllActivities();
  const best = {};

  for (const a of all) {
    if (!a.power_curve) continue;
    for (const dur of POWER_CURVE_DURATIONS) {
      if (a.power_curve[dur] && (!best[dur] || a.power_curve[dur] > best[dur])) {
        best[dur] = a.power_curve[dur];
      }
    }
  }

  return best;
}
