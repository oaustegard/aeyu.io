/**
 * Critical Power model — CP and W' from the power curve.
 *
 * The 2-parameter CP model (Monod & Scherrer 1965) treats sustainable cycling
 * as a two-regime system:
 *
 *   Below CP: steady-state VO2, sustainable in principle.
 *   Above CP: VO2 keeps rising toward max; exhaustion is mathematically
 *             inevitable. W' (a finite work reservoir, in joules) depletes
 *             linearly with the power excess above CP.
 *
 * Linear work-time form (preferred for fitting):  W = CP·t + W'
 *   where W_i = P_i · t_i is the work done at the duration-i mean maximal power.
 *
 * Unlike FTP (operationally 95% of 20-min max), CP has direct physiological
 * grounding and predicts time-to-exhaustion above threshold via
 *   t = W' / (P - CP).
 *
 * Reference: PMC7552657 (Critical Power narrative review).
 */

/**
 * Durations (in seconds) considered valid for CP fitting.
 *
 * Lower bound (~3 min): below this, the anaerobic contribution dominates and
 * breaks the linear assumption. Upper bound (~30 min): above this, aerobic
 * fatigue accumulates and curves the W vs t line downward.
 */
export const CP_FIT_DURATIONS = [180, 300, 600, 720, 900, 1200, 1500, 1800];
const MIN_CP_DURATION = 180;
const MAX_CP_DURATION = 1800;

/** Minimum durations required for a fit. Two points → exact 2-parameter solve. */
const MIN_FIT_POINTS = 2;

/** Minimum spread between shortest and longest fit duration (seconds). */
const MIN_DURATION_SPREAD = 300;

/**
 * Estimate Critical Power (CP) and anaerobic work capacity (W') from a
 * power curve via linear regression of W = CP·t + W'.
 *
 * @param {Object} powerCurve — {duration_in_seconds: best_average_watts}
 * @returns {{cp: number, wPrime: number, fitDurations: number[], rSquared: number|null, points: Array<{t:number, p:number, w:number}>}|null}
 *   `cp` in watts, `wPrime` in joules. Returns null if fewer than two
 *   durations fall in the valid CP range or the fit is degenerate.
 */
export function estimateCriticalPower(powerCurve) {
  if (!powerCurve) return null;

  const points = [];
  for (const dur of CP_FIT_DURATIONS) {
    const watts = powerCurve[dur];
    if (!watts || watts <= 0) continue;
    points.push({ t: dur, p: watts, w: watts * dur });
  }

  if (points.length < MIN_FIT_POINTS) return null;

  const spread = points[points.length - 1].t - points[0].t;
  if (spread < MIN_DURATION_SPREAD) return null;

  // Linear regression: W = CP·t + W'  →  slope = CP, intercept = W'
  const n = points.length;
  let sumT = 0, sumW = 0, sumTT = 0, sumTW = 0;
  for (const { t, w } of points) {
    sumT += t;
    sumW += w;
    sumTT += t * t;
    sumTW += t * w;
  }
  const denom = n * sumTT - sumT * sumT;
  if (denom === 0) return null;

  const cp = (n * sumTW - sumT * sumW) / denom;
  const wPrime = (sumW - cp * sumT) / n;

  if (!isFinite(cp) || !isFinite(wPrime) || cp <= 0 || wPrime <= 0) return null;

  // Coefficient of determination for fit quality (only meaningful with ≥3 points).
  let rSquared = null;
  if (n >= 3) {
    const meanW = sumW / n;
    let ssTot = 0, ssRes = 0;
    for (const { t, w } of points) {
      const predicted = cp * t + wPrime;
      ssTot += (w - meanW) ** 2;
      ssRes += (w - predicted) ** 2;
    }
    rSquared = ssTot > 0 ? 1 - ssRes / ssTot : null;
  }

  return {
    cp: Math.round(cp),
    wPrime: Math.round(wPrime),
    fitDurations: points.map((p) => p.t),
    rSquared,
    points,
  };
}

/**
 * Predicted time-to-exhaustion at a constant power above CP.
 * Returns null for powers at or below CP (sustainable indefinitely in model).
 */
export function timeToExhaustion(power, cp, wPrime) {
  if (!power || !cp || !wPrime || power <= cp) return null;
  return wPrime / (power - cp);
}

/**
 * Predicted sustainable power for a given duration.
 *   P(t) = CP + W' / t
 * Returns null for non-positive durations.
 */
export function sustainablePower(seconds, cp, wPrime) {
  if (!seconds || seconds <= 0 || !cp || !wPrime) return null;
  return cp + wPrime / seconds;
}

/**
 * Whether a power curve has enough data in the CP-valid range to fit.
 */
export function canFitCP(powerCurve) {
  if (!powerCurve) return false;
  let count = 0;
  let minT = Infinity, maxT = -Infinity;
  for (const dur of CP_FIT_DURATIONS) {
    if (powerCurve[dur] && powerCurve[dur] > 0) {
      count++;
      if (dur < minT) minT = dur;
      if (dur > maxT) maxT = dur;
    }
  }
  return count >= MIN_FIT_POINTS && (maxT - minT) >= MIN_DURATION_SPREAD;
}
