/**
 * Form Indicators — Performance Capacity + Aerobic Efficiency (#106)
 *
 * Two complementary form indicators computed entirely from local IndexedDB data.
 * No new API calls required — uses segment efforts and activity data already synced.
 *
 * Indicator 1: Performance Capacity (no HR required)
 *   - Measures what your body can produce on the bike
 *   - Uses climb segment performance (VAM, estimated W/kg) over time
 *   - 0-100 index relative to athlete's own all-time range
 *
 * Indicator 2: Aerobic Efficiency (when HR data available)
 *   - Measures what that output costs you
 *   - Efficiency Factor: power/HR or speed/HR
 *   - Only activates when HR data is present
 */

import { getAllSegments, getAllActivities } from "./db.js";

// --- Constants ---

const MIN_EFFORTS_PER_SEGMENT = 3;   // Need at least 3 efforts for meaningful comparison
const MIN_MOVING_TIME = 120;          // 2 min minimum to avoid approach-speed slingshot
const MIN_GRADE_PERCENT = 4;          // Minimum gradient for climb identification
const ROLLING_WINDOW_DAYS = 90;       // Performance index rolling window
const RECENCY_HALF_LIFE_DAYS = 30;    // Exponential recency weighting half-life

// --- Climb Identification ---

/**
 * Check if a segment qualifies as a climb for Performance Capacity.
 * Climbs >= 4% grade or with a Strava climb category.
 */
function isClimbSegment(segment) {
  if (segment.climb_category > 0) return true;
  if (segment.average_grade >= MIN_GRADE_PERCENT) return true;
  return false;
}

/**
 * Calculate VAM (Vertical Ascent Meters per hour) for a segment effort.
 */
function calcVAM(segment, effort) {
  const elevGain = (segment.elevation_high || 0) - (segment.elevation_low || 0);
  if (elevGain <= 0 || !effort.moving_time || effort.moving_time <= 0) return null;
  return (elevGain * 3600) / effort.moving_time;
}

/**
 * Estimate relative power (W/kg) from VAM using the Ferrari formula.
 * VAM / (200 + 10 * gradient)
 * Allows comparing efforts across different-gradient climbs.
 */
function estimateRelativePower(vam, averageGrade) {
  if (!vam || !averageGrade || averageGrade <= 0) return null;
  return vam / (200 + 10 * averageGrade);
}

// --- Performance Capacity Computation ---

/**
 * Compute Performance Capacity score (0-100) from climb segment history.
 *
 * Algorithm:
 * 1. Filter segments to climbs with >= MIN_EFFORTS_PER_SEGMENT efforts
 * 2. For each qualifying segment, compute estimated W/kg per effort
 *    (or use actual watts if device_watts is true)
 * 3. Rank recent efforts (last 90 days) against all-time history
 * 4. Weight by recency, composite across segments
 * 5. Return 0-100 index relative to athlete's own range
 *
 * Returns: { score, trend, segments: [...], hasData }
 */
export async function computePerformanceCapacity() {
  const allSegments = await getAllSegments();

  // Filter to climb segments with enough history
  const climbSegments = allSegments.filter((seg) => {
    if (!isClimbSegment(seg)) return false;
    if (!seg.efforts || seg.efforts.length < MIN_EFFORTS_PER_SEGMENT) return false;
    return true;
  });

  if (climbSegments.length === 0) {
    return { score: null, trend: null, segments: [], hasData: false, reason: "no_climbs" };
  }

  const now = Date.now();
  const windowMs = ROLLING_WINDOW_DAYS * 86400000;
  const halfLifeMs = RECENCY_HALF_LIFE_DAYS * 86400000;
  const segmentScores = [];

  for (const seg of climbSegments) {
    // Filter efforts with valid moving time
    const validEfforts = seg.efforts.filter(
      (e) => e.moving_time >= MIN_MOVING_TIME
    );
    if (validEfforts.length < MIN_EFFORTS_PER_SEGMENT) continue;

    // Compute performance metric per effort
    const scored = validEfforts.map((e) => {
      const effortDate = new Date(e.start_date).getTime();
      let performance;

      // Prefer actual power from power meter
      if (e.device_watts && e.average_watts > 0) {
        performance = e.average_watts;
      } else {
        // Estimate from VAM
        const vam = calcVAM(seg, e);
        performance = estimateRelativePower(vam, seg.average_grade);
      }

      return { performance, date: effortDate, effort: e };
    }).filter((s) => s.performance != null && s.performance > 0);

    if (scored.length < MIN_EFFORTS_PER_SEGMENT) continue;

    // Sort by performance to compute percentiles
    const allPerfs = scored.map((s) => s.performance).sort((a, b) => a - b);
    const minPerf = allPerfs[0];
    const maxPerf = allPerfs[allPerfs.length - 1];
    const range = maxPerf - minPerf;

    if (range === 0) continue; // No variation

    // Recent efforts (within rolling window)
    const recentScored = scored.filter((s) => now - s.date <= windowMs);
    if (recentScored.length === 0) continue;

    // Compute recency-weighted percentile for recent efforts
    let weightedSum = 0;
    let weightSum = 0;

    for (const s of recentScored) {
      const ageMs = now - s.date;
      const weight = Math.exp(-Math.LN2 * ageMs / halfLifeMs);
      const percentile = ((s.performance - minPerf) / range) * 100;
      weightedSum += percentile * weight;
      weightSum += weight;
    }

    const segScore = weightSum > 0 ? weightedSum / weightSum : 0;

    // Also compute older window for trend
    const olderWindowStart = now - windowMs * 2;
    const olderScored = scored.filter(
      (s) => s.date >= olderWindowStart && s.date < now - windowMs
    );

    let olderScore = null;
    if (olderScored.length > 0) {
      let olderWeightedSum = 0;
      let olderWeightSum = 0;
      for (const s of olderScored) {
        const ageMs = now - windowMs - s.date; // age relative to older window end
        const weight = Math.exp(-Math.LN2 * ageMs / halfLifeMs);
        const percentile = ((s.performance - minPerf) / range) * 100;
        olderWeightedSum += percentile * weight;
        olderWeightSum += weight;
      }
      olderScore = olderWeightSum > 0 ? olderWeightedSum / olderWeightSum : null;
    }

    segmentScores.push({
      segmentId: seg.id,
      segmentName: seg.name,
      score: segScore,
      olderScore,
      effortCount: validEfforts.length,
      recentCount: recentScored.length,
      averageGrade: seg.average_grade,
      climbCategory: seg.climb_category,
      // Best and latest effort for display
      bestEffort: scored.reduce((best, s) => s.performance > best.performance ? s : best),
      latestEffort: scored.reduce((latest, s) => s.date > latest.date ? s : latest),
    });
  }

  if (segmentScores.length === 0) {
    return { score: null, trend: null, segments: [], hasData: false, reason: "insufficient_efforts" };
  }

  // Composite score: average across qualifying segments (equal weight)
  const compositeScore = segmentScores.reduce((sum, s) => sum + s.score, 0) / segmentScores.length;

  // Trend: compare current composite to older composite
  const segmentsWithTrend = segmentScores.filter((s) => s.olderScore != null);
  let trend = null;
  if (segmentsWithTrend.length > 0) {
    const currentAvg = segmentsWithTrend.reduce((s, seg) => s + seg.score, 0) / segmentsWithTrend.length;
    const olderAvg = segmentsWithTrend.reduce((s, seg) => s + seg.olderScore, 0) / segmentsWithTrend.length;
    trend = currentAvg - olderAvg; // Positive = improving
  }

  return {
    score: Math.round(compositeScore),
    trend,
    segments: segmentScores.sort((a, b) => b.effortCount - a.effortCount),
    hasData: true,
  };
}

// --- Aerobic Efficiency Computation ---

/**
 * Compute Aerobic Efficiency metrics from activity data.
 *
 * Efficiency Factor (EF) = power / HR or adjusted speed / HR
 * Higher EF = more output per heartbeat = fitter.
 *
 * Only activates when HR data is present. Returns null metrics gracefully
 * when no HR data exists — no nagging.
 *
 * Returns: { ef: { current, trend, history }, hasData }
 */
export async function computeAerobicEfficiency() {
  const allActivities = await getAllActivities();

  // Filter to cycling activities with HR data
  const withHR = allActivities.filter((a) =>
    a.has_heartrate &&
    a.average_heartrate > 0 &&
    a.has_efforts &&
    (a.sport_type === "Ride" || a.sport_type === "VirtualRide" || a.sport_type === "MountainBikeRide")
  );

  if (withHR.length < 3) {
    return { ef: null, hasData: false, reason: withHR.length === 0 ? "no_hr_data" : "insufficient_hr_data" };
  }

  // Compute EF per activity — power-based and speed-based separately
  const powerEF = [];
  const speedEF = [];

  for (const a of withHR) {
    const date = new Date(a.start_date).getTime();
    const base = { date, activityId: a.id, activityName: a.name, movingTime: a.moving_time, avgHR: a.average_heartrate };

    if (a.device_watts && a.weighted_average_watts > 0) {
      powerEF.push({ ...base, ef: a.weighted_average_watts / a.average_heartrate, hasPower: true });
    } else if (a.device_watts && a.average_watts > 0) {
      powerEF.push({ ...base, ef: a.average_watts / a.average_heartrate, hasPower: true });
    } else if (a.average_speed > 0) {
      // Speed-based EF (less accurate, terrain-dependent) — only used when no power data exists
      const elevFactor = a.total_elevation_gain > 0
        ? 1 + (a.total_elevation_gain / (a.distance || 1)) * 10
        : 1;
      speedEF.push({ ...base, ef: (a.average_speed * elevFactor) / a.average_heartrate, hasPower: false });
    }
  }

  // Use power-based EF exclusively if enough data; otherwise fall back to speed-based only.
  // Never mix — they are different units and scales.
  const efData = powerEF.length >= 3 ? powerEF : speedEF;

  if (efData.length < 3) {
    return { ef: null, hasData: false, reason: "insufficient_ef_data" };
  }

  // Sort by date
  efData.sort((a, b) => a.date - b.date);

  const now = Date.now();
  const windowMs = ROLLING_WINDOW_DAYS * 86400000;

  // Current window EF (last 90 days)
  const recentEF = efData.filter((d) => now - d.date <= windowMs);
  const olderEF = efData.filter((d) => d.date >= now - windowMs * 2 && d.date < now - windowMs);

  const currentEF = recentEF.length > 0
    ? recentEF.reduce((sum, d) => sum + d.ef, 0) / recentEF.length
    : null;

  // If no recent rides, don't claim we have data — the card would show stale/empty info
  if (currentEF == null) {
    return { ef: null, hasData: false, reason: "no_recent_data" };
  }

  const olderEFAvg = olderEF.length > 0
    ? olderEF.reduce((sum, d) => sum + d.ef, 0) / olderEF.length
    : null;

  let trend = null;
  if (currentEF != null && olderEFAvg != null) {
    trend = ((currentEF - olderEFAvg) / olderEFAvg) * 100; // Percentage change
  }

  // Build monthly history for chart
  const monthlyEF = buildMonthlyHistory(efData);

  return {
    ef: {
      current: currentEF ? +currentEF.toFixed(2) : null,
      trend,
      history: efData.slice(-50), // Last 50 data points for chart
      monthlyHistory: monthlyEF,
      recentCount: recentEF.length,
      totalCount: efData.length,
      hasPowerData: efData.length > 0 && efData[0].hasPower,
    },
    hasData: true,
  };
}

/**
 * Build monthly averages from EF data for trend display.
 */
function buildMonthlyHistory(efData) {
  const months = {};
  for (const d of efData) {
    const date = new Date(d.date);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    if (!months[key]) months[key] = { sum: 0, count: 0 };
    months[key].sum += d.ef;
    months[key].count++;
  }
  return Object.entries(months)
    .map(([month, { sum, count }]) => ({
      month,
      ef: +(sum / count).toFixed(2),
      count,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// --- Combined Form Summary ---

/**
 * Compute all form indicators and return a combined summary.
 * This is the main entry point for the Dashboard UI.
 */
export async function computeFitnessSummary() {
  const [capacity, efficiency] = await Promise.all([
    computePerformanceCapacity(),
    computeAerobicEfficiency(),
  ]);

  // Interpret the combination
  let interpretation = null;
  if (capacity.hasData && efficiency.hasData && capacity.trend != null && efficiency.ef?.trend != null) {
    const capUp = capacity.trend > 2;
    const capDown = capacity.trend < -2;
    const efUp = efficiency.ef.trend > 2;
    const efDown = efficiency.ef.trend < -2;

    if (capUp && efUp) interpretation = "ideal";           // Stronger AND more efficient
    else if (capUp && !efDown) interpretation = "pushing";  // Stronger but not more economical
    else if (!capDown && efUp) interpretation = "building";  // Base building — economy improving
    else if (capUp && efDown) interpretation = "overreaching"; // Output up but cost up more
    else if (capDown && efDown) interpretation = "detraining"; // Both declining
    else interpretation = "maintaining";
  }

  return {
    performanceCapacity: capacity,
    aerobicEfficiency: efficiency,
    interpretation,
  };
}
