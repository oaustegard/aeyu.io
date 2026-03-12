/**
 * Power Curve — duration-based power bests (#48)
 *
 * Computes best average power over standard durations (the "power curve")
 * from per-second power data fetched by the sync engine.
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

import { getAllActivities } from "./db.js";

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

/**
 * Compute best average power for each standard duration using a sliding window.
 * @param {number[]} watts — Per-second power values
 * @returns {Object|null} Power curve bests
 */
export function computePowerCurve(watts) {
  if (!watts || watts.length < 5) return null;

  const curve = {};
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
