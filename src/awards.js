/**
 * Participation Awards — Awards Engine
 * Runs entirely client-side against IndexedDB data.
 *
 * Award types:
 *   - Year Best (YB): Fastest effort on a segment this calendar year
 *   - Season First: First effort on a segment this calendar year
 *   - Recent Best: Best time among last 5 attempts (requires 3+ history)
 *   - Beat Median: Faster than your median time on this segment
 *   - Top Quartile: In the top 25% of your own history
 *   - Consistency (Metronome): Low variance across recent efforts (CV < 0.05)
 *
 * Data quality rules:
 *   - Minimum effort threshold: comparative awards (Year Best, Recent Best,
 *     Beat Median, Top Quartile) require ≥3 total efforts. Season First exempt.
 *   - Calendar gate: Year Best suppressed before March 1.
 *   - High-variance filter: segments with CV > 0.5 (≥5 efforts) are
 *     traffic-dominated — all awards suppressed except Season First.
 */

import { getSegment } from "./db.js";

/** Minimum total efforts on a segment before comparative awards apply */
const MIN_EFFORTS_FOR_AWARDS = 3;

/** Month (1-indexed) before which Year Best awards are suppressed */
const YEAR_BEST_CALENDAR_GATE_MONTH = 3; // March

/** CV above this threshold suppresses awards (traffic-dominated segments) */
const HIGH_VARIANCE_CV_THRESHOLD = 0.5;

/** Minimum efforts before CV filtering kicks in */
const MIN_EFFORTS_FOR_CV = 5;

/** CV below this threshold earns a Consistency award */
const CONSISTENCY_CV_THRESHOLD = 0.05;

/** Minimum recent efforts to evaluate consistency */
const CONSISTENCY_MIN_EFFORTS = 5;

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Compute mean of an array of numbers */
function mean(values) {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Compute standard deviation of an array of numbers */
function stdev(values) {
  const m = mean(values);
  const variance = values.reduce((sum, v) => sum + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Coefficient of variation (stdev / mean) */
function cv(values) {
  const m = mean(values);
  if (m === 0) return 0;
  return stdev(values) / m;
}

/** Compute percentile rank (0-100) — what percentage of values is >= this value (lower time = better) */
function percentileRank(values, value) {
  const worse = values.filter((v) => v > value).length;
  return Math.round((worse / values.length) * 100);
}

/** Compute the median of a sorted array of numbers */
function median(sortedValues) {
  const n = sortedValues.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 0 ? (sortedValues[mid - 1] + sortedValues[mid]) / 2 : sortedValues[mid];
}

/**
 * Compute awards for a single activity's segment efforts.
 * @param {Object} activity — Activity with segment_efforts populated
 * @returns {Array} — Array of award objects
 */
export async function computeAwards(activity) {
  if (!activity.segment_efforts || activity.segment_efforts.length === 0) {
    return [];
  }

  const currentYear = new Date(activity.start_date_local).getFullYear();
  const awards = [];

  for (const effort of activity.segment_efforts) {
    const segment = await getSegment(effort.segment.id);
    if (!segment || !segment.efforts || segment.efforts.length === 0) continue;

    const allEfforts = segment.efforts;
    const allTimes = allEfforts.map((e) => e.elapsed_time);
    const thisYearEfforts = allEfforts.filter(
      (e) => new Date(e.start_date_local).getFullYear() === currentYear
    );

    // --- High-variance filter (#38) ---
    // Segments with CV > 0.5 and ≥5 efforts are traffic-dominated.
    // Only Season First passes through; all other awards are suppressed.
    const isHighVariance =
      allEfforts.length >= MIN_EFFORTS_FOR_CV &&
      cv(allTimes) > HIGH_VARIANCE_CV_THRESHOLD;

    // --- Season First (exempt from CV filter) ---
    if (thisYearEfforts.length === 1) {
      const previousEfforts = allEfforts
        .filter(
          (e) => new Date(e.start_date_local).getFullYear() < currentYear
        )
        .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local));

      awards.push({
        type: "season_first",
        segment: segment.name,
        segment_id: segment.id,
        time: effort.elapsed_time,
        comparison: previousEfforts.length > 0 ? previousEfforts[0] : null,
        delta: null,
        message: previousEfforts.length > 0
          ? `First ride on ${segment.name} this year! Last rode it ${formatDate(previousEfforts[0].start_date_local)}`
          : `First ride on ${segment.name} this year!`,
      });
      continue; // Season first — no other awards possible
    }

    // All remaining awards are suppressed on high-variance segments
    if (isHighVariance) continue;

    // --- Year Best ---
    const activityDate = new Date(activity.start_date_local);
    const afterCalendarGate = (activityDate.getMonth() + 1) >= YEAR_BEST_CALENDAR_GATE_MONTH;
    if (thisYearEfforts.length > 1 && allEfforts.length >= MIN_EFFORTS_FOR_AWARDS && afterCalendarGate) {
      const bestThisYear = Math.min(
        ...thisYearEfforts.map((e) => e.elapsed_time)
      );

      if (effort.elapsed_time === bestThisYear) {
        const otherEfforts = thisYearEfforts
          .filter((e) => e.effort_id !== effort.id)
          .sort((a, b) => a.elapsed_time - b.elapsed_time);
        const previousBest = otherEfforts.length > 0 ? otherEfforts[0] : null;

        awards.push({
          type: "year_best",
          segment: segment.name,
          segment_id: segment.id,
          time: effort.elapsed_time,
          comparison: previousBest,
          delta: previousBest
            ? previousBest.elapsed_time - effort.elapsed_time
            : null,
          message: previousBest
            ? `Year Best on ${segment.name}! ${formatTime(effort.elapsed_time)} (previous: ${formatTime(previousBest.elapsed_time)} on ${formatDate(previousBest.start_date_local)})`
            : `Year Best on ${segment.name}! ${formatTime(effort.elapsed_time)}`,
        });
      }
    }

    // --- Recent Best (inherently requires ≥3 efforts via last5 check) ---
    const sortedByDate = [...allEfforts].sort(
      (a, b) => b.start_date_local.localeCompare(a.start_date_local)
    );
    const last5 = sortedByDate.slice(0, 5);

    if (last5.length >= 3) {
      const bestOfLast5 = Math.min(...last5.map((e) => e.elapsed_time));

      if (effort.elapsed_time === bestOfLast5) {
        awards.push({
          type: "recent_best",
          segment: segment.name,
          segment_id: segment.id,
          time: effort.elapsed_time,
          comparison: null,
          delta: null,
          message: `Best of your last ${last5.length} on ${segment.name}! ${formatTime(effort.elapsed_time)}`,
        });
      }
    }

    // --- Beat Median (#29) ---
    if (allEfforts.length >= MIN_EFFORTS_FOR_AWARDS) {
      const sortedTimes = [...allTimes].sort((a, b) => a - b);
      const med = median(sortedTimes);

      if (effort.elapsed_time < med) {
        const pctile = percentileRank(allTimes, effort.elapsed_time);
        awards.push({
          type: "beat_median",
          segment: segment.name,
          segment_id: segment.id,
          time: effort.elapsed_time,
          comparison: null,
          delta: Math.round(med - effort.elapsed_time),
          message: `Beat your median on ${segment.name}! ${formatTime(effort.elapsed_time)} — ${formatTime(Math.round(med - effort.elapsed_time))} under median (top ${100 - pctile}% of ${allEfforts.length} efforts)`,
        });
      }
    }

    // --- Top Quartile (#29) ---
    if (allEfforts.length >= MIN_EFFORTS_FOR_AWARDS) {
      const sortedTimes = [...allTimes].sort((a, b) => a - b);
      const q1Index = Math.floor(sortedTimes.length * 0.25);
      const q1Threshold = sortedTimes[q1Index];

      if (effort.elapsed_time <= q1Threshold) {
        const rank = sortedTimes.filter((t) => t < effort.elapsed_time).length + 1;
        awards.push({
          type: "top_quartile",
          segment: segment.name,
          segment_id: segment.id,
          time: effort.elapsed_time,
          comparison: null,
          delta: null,
          message: `Top quartile on ${segment.name}! #${rank} of ${allEfforts.length} efforts — ${formatTime(effort.elapsed_time)}`,
        });
      }
    }

    // --- Consistency / Metronome (#39) ---
    if (last5.length >= CONSISTENCY_MIN_EFFORTS) {
      const recentTimes = last5.map((e) => e.elapsed_time);
      const recentCV = cv(recentTimes);
      const spread = Math.max(...recentTimes) - Math.min(...recentTimes);

      if (recentCV <= CONSISTENCY_CV_THRESHOLD) {
        awards.push({
          type: "consistency",
          segment: segment.name,
          segment_id: segment.id,
          time: effort.elapsed_time,
          comparison: null,
          delta: null,
          message: `Metronome on ${segment.name}! ${spread}s spread across last ${last5.length} efforts (CV: ${(recentCV * 100).toFixed(1)}%)`,
        });
      }
    }
  }

  return awards;
}

/**
 * Compute awards for multiple activities.
 * @param {Array} activities — Activities with segment_efforts populated
 * @returns {Map} — Map of activity.id → awards array
 */
export async function computeAwardsForActivities(activities) {
  const result = new Map();
  for (const activity of activities) {
    const awards = await computeAwards(activity);
    if (awards.length > 0) {
      result.set(activity.id, awards);
    }
  }
  return result;
}
