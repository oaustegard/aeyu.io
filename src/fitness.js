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
 * Indicator 2: Aerobic Efficiency (when power + HR data available)
 *   - Measures what that output costs you
 *   - Efficiency Factor: NP/HR per Friel methodology
 *   - Only steady-state rides ≥45 min with power meter and HR
 */

import { getAllSegments, getAllActivities } from "./db.js";

// --- Constants ---

const MIN_EFFORTS_PER_SEGMENT = 3;   // Need at least 3 efforts for meaningful comparison
const MIN_MOVING_TIME = 120;          // 2 min minimum to avoid approach-speed slingshot
const MIN_GRADE_PERCENT = 4;          // Minimum gradient for climb identification
const ROLLING_WINDOW_DAYS = 90;       // Data inclusion window
const TREND_WINDOW_DAYS = 42;         // 6-week trend comparison window
const RECENCY_HALF_LIFE_DAYS = 30;    // Exponential recency weighting half-life
const ROLLING_SCORE_WEEKS = 4;        // Rolling average window for sparkline
const EF_HISTORY_MONTHS = 12;         // Cap EF history display to 12 months
const MIN_EF_MOVING_TIME = 1800;      // 30 min minimum for whole-ride EF
const MAX_VARIABILITY_INDEX = 1.25;   // VI = NP/AP; allow real-world rides with stops and terrain variation

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

    segmentScores.push({
      segmentId: seg.id,
      segmentName: seg.name,
      score: segScore,
      effortCount: validEfforts.length,
      recentCount: recentScored.length,
      averageGrade: seg.average_grade,
      climbCategory: seg.climb_category,
      bestEffort: scored.reduce((best, s) => s.performance > best.performance ? s : best),
      latestEffort: scored.reduce((latest, s) => s.date > latest.date ? s : latest),
    });
  }

  if (segmentScores.length === 0) {
    return { score: null, trend: null, segments: [], hasData: false, reason: "insufficient_efforts" };
  }

  // Composite score: average across qualifying segments (equal weight)
  const compositeScore = segmentScores.reduce((sum, s) => sum + s.score, 0) / segmentScores.length;

  // Build rolling history: 4-week rolling score at weekly intervals for sparkline
  const rollingHistory = buildRollingHistory(climbSegments);

  // Trend: derive from rollingHistory so it describes actual change in the displayed score.
  // Compare latest rolling score to the score TREND_WINDOW_DAYS ago.
  let trend = null;
  if (rollingHistory.length >= 2) {
    const latest = rollingHistory[rollingHistory.length - 1];
    const targetMs = latest.weekEnd - TREND_WINDOW_DAYS * 86400000;
    // Find the rolling history point closest to targetMs
    let closest = rollingHistory[0];
    for (const pt of rollingHistory) {
      if (Math.abs(pt.weekEnd - targetMs) < Math.abs(closest.weekEnd - targetMs)) {
        closest = pt;
      }
    }
    if (closest !== latest) {
      trend = latest.score - closest.score;
    }
  }

  // Count unique climbs
  const climbCount = segmentScores.length;
  const totalEfforts = segmentScores.reduce((sum, s) => sum + s.recentCount, 0);

  return {
    score: Math.round(compositeScore),
    trend,
    segments: segmentScores.sort((a, b) => b.effortCount - a.effortCount),
    rollingHistory,
    climbCount,
    totalEfforts,
    hasData: true,
  };
}

/**
 * Build 4-week rolling performance score at weekly intervals over last 6 months.
 * Returns array of { weekEnd, score } for sparkline display.
 */
function buildRollingHistory(climbSegments) {
  const now = Date.now();
  const sixMonthsMs = 182 * 86400000;
  const fourWeeksMs = ROLLING_SCORE_WEEKS * 7 * 86400000;
  const halfLifeMs = RECENCY_HALF_LIFE_DAYS * 86400000;
  const points = [];

  // Step backwards weekly from now
  for (let weekEnd = now; weekEnd >= now - sixMonthsMs; weekEnd -= 7 * 86400000) {
    const windowStart = weekEnd - fourWeeksMs;
    const segScores = [];

    for (const seg of climbSegments) {
      if (!isClimbSegment(seg)) continue;
      const validEfforts = (seg.efforts || []).filter((e) => e.moving_time >= MIN_MOVING_TIME);
      if (validEfforts.length < MIN_EFFORTS_PER_SEGMENT) continue;

      const scored = validEfforts.map((e) => {
        let performance;
        if (e.device_watts && e.average_watts > 0) {
          performance = e.average_watts;
        } else {
          const vam = calcVAM(seg, e);
          performance = estimateRelativePower(vam, seg.average_grade);
        }
        return { performance, date: new Date(e.start_date).getTime() };
      }).filter((s) => s.performance != null && s.performance > 0);

      if (scored.length < MIN_EFFORTS_PER_SEGMENT) continue;

      const allPerfs = scored.map((s) => s.performance).sort((a, b) => a - b);
      const range = allPerfs[allPerfs.length - 1] - allPerfs[0];
      if (range === 0) continue;

      const windowEfforts = scored.filter((s) => s.date >= windowStart && s.date <= weekEnd);
      if (windowEfforts.length === 0) continue;

      let ws = 0, wt = 0;
      for (const s of windowEfforts) {
        const ageMs = weekEnd - s.date;
        const weight = Math.exp(-Math.LN2 * ageMs / halfLifeMs);
        const percentile = ((s.performance - allPerfs[0]) / range) * 100;
        ws += percentile * weight;
        wt += weight;
      }
      if (wt > 0) segScores.push(ws / wt);
    }

    if (segScores.length > 0) {
      const avg = segScores.reduce((a, b) => a + b, 0) / segScores.length;
      points.push({ weekEnd, score: Math.round(avg) });
    }
  }

  return points.reverse(); // chronological order
}

// --- Aerobic Efficiency Computation ---

/**
 * Compute Aerobic Efficiency from steady-state power rides with HR data.
 *
 * Efficiency Factor (EF) = Normalized Power / avg HR (per Friel/TrainingPeaks).
 * Higher EF = more output per heartbeat = fitter. Only meaningful for:
 *   - Rides with a power meter (speed/HR is not a valid cycling EF metric)
 *   - Steady-state aerobic efforts (low Variability Index)
 *   - Rides long enough that warmup doesn't dominate (≥45 min)
 *
 * Returns: { ef: { current, trend, history }, hasData }
 */
export async function computeAerobicEfficiency() {
  const allActivities = await getAllActivities();

  const CYCLING_TYPES = new Set(["Ride", "VirtualRide", "MountainBikeRide", "GravelRide"]);
  const hasPower = (a) => (a.device_watts || a.sport_type === "VirtualRide") && a.average_watts > 0;

  // Rides with power + HR + minimum duration → full EF calculation
  const eligible = allActivities.filter((a) =>
    a.has_heartrate &&
    a.average_heartrate > 0 &&
    hasPower(a) &&
    a.moving_time >= MIN_EF_MOVING_TIME &&
    CYCLING_TYPES.has(a.sport_type)
  );

  // Rides with power but NO HR → can't compute EF but still represent training
  const powerOnly = allActivities.filter((a) =>
    (!a.has_heartrate || !a.average_heartrate) &&
    hasPower(a) &&
    a.moving_time >= MIN_EF_MOVING_TIME &&
    CYCLING_TYPES.has(a.sport_type)
  );

  if (eligible.length < 3 && powerOnly.length === 0) {
    return { ef: null, hasData: false, reason: eligible.length === 0 ? "no_power_hr_data" : "insufficient_data" };
  }

  const efData = [];
  for (const a of eligible) {
    const np = a.weighted_average_watts || a.average_watts;
    if (!np || np <= 0) continue;

    // Variability Index: NP / AP. Steady rides ≈ 1.0, interval sessions > 1.10
    // Skip highly variable rides — EF is only meaningful for steady-state efforts
    if (a.weighted_average_watts && a.average_watts > 0) {
      const vi = a.weighted_average_watts / a.average_watts;
      if (vi > MAX_VARIABILITY_INDEX) continue;
    }

    efData.push({
      ef: np / a.average_heartrate,
      date: new Date(a.start_date).getTime(),
      activityId: a.id,
      activityName: a.name,
      hasPower: true,
      movingTime: a.moving_time,
      avgHR: a.average_heartrate,
    });
  }

  // Count power-only rides in recent window for display
  const now0 = Date.now();
  const trendMs0 = TREND_WINDOW_DAYS * 86400000;
  const recentPowerOnly = powerOnly.filter((a) => now0 - new Date(a.start_date).getTime() <= trendMs0);
  const recentPowerOnlyNP = recentPowerOnly.length > 0
    ? Math.round(recentPowerOnly.reduce((s, a) => s + (a.weighted_average_watts || a.average_watts), 0) / recentPowerOnly.length)
    : null;

  if (efData.length < 3) {
    // Even without enough EF data, return power-only info if available
    if (recentPowerOnly.length > 0) {
      return {
        ef: null,
        hasData: false,
        reason: "insufficient_ef_data",
        powerOnlyCount: recentPowerOnly.length,
        powerOnlyAvgNP: recentPowerOnlyNP,
      };
    }
    return { ef: null, hasData: false, reason: "insufficient_ef_data" };
  }

  // Sort by date descending (most recent first) so we always prioritize recent rides
  efData.sort((a, b) => b.date - a.date);

  const now = Date.now();
  const trendMs = TREND_WINDOW_DAYS * 86400000;

  // 6-week trend windows instead of 90 days
  const recentEF = efData.filter((d) => now - d.date <= trendMs);
  const olderEF = efData.filter((d) => d.date >= now - trendMs * 2 && d.date < now - trendMs);

  const currentEF = recentEF.length > 0
    ? recentEF.reduce((sum, d) => sum + d.ef, 0) / recentEF.length
    : null;

  // If no recent EF rides but there ARE power-only rides, still show the card
  if (currentEF == null && recentPowerOnly.length > 0) {
    const twelveMonthsMs = EF_HISTORY_MONTHS * 30 * 86400000;
    const cappedData = efData.filter((d) => now - d.date <= twelveMonthsMs);
    const monthlyEF = buildMonthlyHistory(cappedData);
    return {
      ef: {
        current: null,
        trend: null,
        monthlyHistory: monthlyEF,
        recentCount: 0,
        totalCount: efData.length,
        hasPowerData: true,
        powerOnlyCount: recentPowerOnly.length,
        powerOnlyAvgNP: recentPowerOnlyNP,
      },
      hasData: true,
    };
  }
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

  // Cap data to last 12 months for chart display
  const twelveMonthsMs = EF_HISTORY_MONTHS * 30 * 86400000;
  const cappedData = efData.filter((d) => now - d.date <= twelveMonthsMs);

  // Build monthly history as primary chart source (not scatter dots)
  const monthlyEF = buildMonthlyHistory(cappedData);

  return {
    ef: {
      current: currentEF ? +currentEF.toFixed(2) : null,
      trend,
      monthlyHistory: monthlyEF,
      recentCount: recentEF.length,
      totalCount: efData.length,
      hasPowerData: true,
      powerOnlyCount: recentPowerOnly.length,
      powerOnlyAvgNP: recentPowerOnlyNP,
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

  // Determine season from current month
  const currentMonth = new Date().getMonth(); // 0-11
  // Northern hemisphere cycling seasons (the dominant use case)
  let season;
  if (currentMonth >= 2 && currentMonth <= 4) season = "early_season"; // Mar-May
  else if (currentMonth >= 5 && currentMonth <= 8) season = "peak_season"; // Jun-Sep
  else if (currentMonth >= 9 && currentMonth <= 10) season = "late_season"; // Oct-Nov
  else season = "off_season"; // Dec-Feb

  // Build contextual interpretation
  let interpretation = null;
  if (capacity.hasData && efficiency.hasData && capacity.trend != null && efficiency.ef?.trend != null) {
    const capUp = capacity.trend > 2;
    const capDown = capacity.trend < -2;
    const efUp = efficiency.ef.trend > 2;
    const efDown = efficiency.ef.trend < -2;

    if (capUp && efUp) interpretation = "ideal";
    else if (capUp && !efDown) interpretation = "pushing";
    else if (!capDown && efUp) interpretation = "building";
    else if (capUp && efDown) interpretation = "overreaching";
    else if (capDown && efDown) interpretation = "detraining";
    else interpretation = "maintaining";
  }

  return {
    performanceCapacity: capacity,
    aerobicEfficiency: efficiency,
    interpretation,
    season,
  };
}
