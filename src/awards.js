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
 *   - Monthly Best: Fastest effort on a segment this calendar month (#36)
 *   - Improvement Streak: 3+ consecutive faster times ending now (#36)
 *   - Comeback: Beat median after 3+ sub-median efforts in a row (#36)
 *   - Milestone: Round-number attempt count on a segment (#36)
 *   - Best Month Ever: Fastest effort on segment in this calendar month across all years (#27)
 *   - Closing In: Within 10% of all-time PR on a segment (#28)
 *   - Anniversary: Rode this segment on same date N years ago (#30)
 *
 * Ride-level awards (computed per-activity, not per-segment):
 *   - Distance Record: Longest ride this year (#36)
 *   - Elevation Record: Most climbing in a ride this year (#36)
 *   - Segment Count: Most segments in a ride this year (#36)
 *   - Endurance Record: Longest moving time this year (#31)
 *
 * Data quality rules:
 *   - Minimum effort threshold: comparative awards (Year Best, Recent Best,
 *     Beat Median, Top Quartile, Monthly Best) require ≥3 total efforts.
 *     Season First and Milestone exempt.
 *   - Calendar gate: Year Best suppressed before March 1.
 *   - High-variance filter: segments with CV > 0.5 (≥5 efforts) are
 *     traffic-dominated — all awards suppressed except Season First and Milestone.
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

/** Minimum consecutive improving efforts for a streak award */
const STREAK_MIN_LENGTH = 3;

/** Minimum consecutive sub-median efforts before a comeback triggers */
const COMEBACK_MIN_SLUMP = 3;

/** Effort counts that earn a milestone award */
const MILESTONE_COUNTS = [10, 25, 50, 100, 250, 500, 1000];

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

/** Format a number with ordinal suffix (1st, 2nd, 3rd, etc.) */
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
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

    // --- Milestone (#36) — exempt from CV filter ---
    if (MILESTONE_COUNTS.includes(allEfforts.length)) {
      awards.push({
        type: "milestone",
        segment: segment.name,
        segment_id: segment.id,
        time: effort.elapsed_time,
        comparison: null,
        delta: null,
        message: `${ordinal(allEfforts.length)} effort on ${segment.name}!`,
      });
    }

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

    // --- Monthly Best (#36) ---
    const actMonth = activityDate.getMonth();
    const thisMonthEfforts = allEfforts.filter((e) => {
      const d = new Date(e.start_date_local);
      return d.getMonth() === actMonth && d.getFullYear() === currentYear;
    });
    if (thisMonthEfforts.length >= 2 && allEfforts.length >= MIN_EFFORTS_FOR_AWARDS) {
      const bestThisMonth = Math.min(...thisMonthEfforts.map((e) => e.elapsed_time));
      if (effort.elapsed_time === bestThisMonth) {
        const monthName = activityDate.toLocaleDateString("en-US", { month: "long" });
        awards.push({
          type: "monthly_best",
          segment: segment.name,
          segment_id: segment.id,
          time: effort.elapsed_time,
          comparison: null,
          delta: null,
          message: `${monthName} Best on ${segment.name}! ${formatTime(effort.elapsed_time)} — fastest of ${thisMonthEfforts.length} efforts this month`,
        });
      }
    }

    // --- Improvement Streak (#36) ---
    // 3+ consecutive faster times (chronologically) ending with this effort
    if (sortedByDate.length >= STREAK_MIN_LENGTH) {
      let streak = 1;
      for (let i = 0; i < sortedByDate.length - 1; i++) {
        if (sortedByDate[i].elapsed_time < sortedByDate[i + 1].elapsed_time) {
          streak++;
        } else {
          break;
        }
      }
      if (streak >= STREAK_MIN_LENGTH) {
        awards.push({
          type: "improvement_streak",
          segment: segment.name,
          segment_id: segment.id,
          time: effort.elapsed_time,
          comparison: null,
          delta: sortedByDate[streak - 1].elapsed_time - effort.elapsed_time,
          message: `${streak}-effort improvement streak on ${segment.name}! Each ride faster than the last — ${formatTime(effort.elapsed_time)}`,
        });
      }
    }

    // --- Comeback (#36) ---
    // Beat median after 3+ consecutive sub-median efforts
    if (allEfforts.length >= MIN_EFFORTS_FOR_AWARDS) {
      const sortedTimes = [...allTimes].sort((a, b) => a - b);
      const med = median(sortedTimes);
      if (effort.elapsed_time < med && sortedByDate.length > COMEBACK_MIN_SLUMP) {
        // Check if the previous N efforts were all slower than median
        let slumpLength = 0;
        for (let i = 1; i < sortedByDate.length; i++) {
          if (sortedByDate[i].elapsed_time >= med) {
            slumpLength++;
          } else {
            break;
          }
        }
        if (slumpLength >= COMEBACK_MIN_SLUMP) {
          awards.push({
            type: "comeback",
            segment: segment.name,
            segment_id: segment.id,
            time: effort.elapsed_time,
            comparison: null,
            delta: Math.round(med - effort.elapsed_time),
            message: `Comeback on ${segment.name}! Beat your median after ${slumpLength} slower efforts — ${formatTime(effort.elapsed_time)}`,
          });
        }
      }
    }

    // --- Best Month Ever (#27) ---
    // Fastest effort in this calendar month across ALL years
    if (allEfforts.length >= MIN_EFFORTS_FOR_AWARDS) {
      const actMonth = activityDate.getMonth();
      const sameMonthEfforts = allEfforts.filter(
        (e) => new Date(e.start_date_local).getMonth() === actMonth
      );
      if (sameMonthEfforts.length >= 2) {
        const bestEver = Math.min(...sameMonthEfforts.map((e) => e.elapsed_time));
        if (effort.elapsed_time === bestEver) {
          const priorBests = sameMonthEfforts
            .filter((e) => e.effort_id !== effort.id && new Date(e.start_date_local).getFullYear() !== currentYear);
          const hasPriorYears = priorBests.length > 0;
          if (hasPriorYears) {
            const monthName = activityDate.toLocaleDateString("en-US", { month: "long" });
            const yearsSpanned = new Set(sameMonthEfforts.map((e) => new Date(e.start_date_local).getFullYear())).size;
            awards.push({
              type: "best_month_ever",
              segment: segment.name,
              segment_id: segment.id,
              time: effort.elapsed_time,
              comparison: null,
              delta: null,
              message: `Best ${monthName} ever on ${segment.name}! ${formatTime(effort.elapsed_time)} — fastest across ${yearsSpanned} years`,
            });
          }
        }
      }
    }

    // --- Closing In on PR (#28) ---
    // Within 10% of all-time best (but not the best itself)
    if (allEfforts.length >= MIN_EFFORTS_FOR_AWARDS) {
      const allTimeBest = Math.min(...allTimes);
      if (effort.elapsed_time > allTimeBest) {
        const gap = (effort.elapsed_time - allTimeBest) / allTimeBest;
        if (gap <= 0.10) {
          const pctLabel = gap <= 0.05 ? "5%" : "10%";
          awards.push({
            type: "closing_in",
            segment: segment.name,
            segment_id: segment.id,
            time: effort.elapsed_time,
            comparison: null,
            delta: effort.elapsed_time - allTimeBest,
            message: `Within ${pctLabel} of your PR on ${segment.name}! ${formatTime(effort.elapsed_time)} — just ${formatTime(effort.elapsed_time - allTimeBest)} off your best`,
          });
        }
      }
    }

    // --- Anniversary (#30) ---
    // Rode this segment on same month+day in a previous year
    const actMonthDay = `${String(activityDate.getMonth() + 1).padStart(2, "0")}-${String(activityDate.getDate()).padStart(2, "0")}`;
    const anniversaryEfforts = allEfforts.filter((e) => {
      const d = new Date(e.start_date_local);
      if (d.getFullYear() === currentYear) return false;
      const md = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      return md === actMonthDay;
    });
    if (anniversaryEfforts.length > 0) {
      const years = anniversaryEfforts.map((e) => new Date(e.start_date_local).getFullYear()).sort();
      const oldestYear = years[0];
      const span = currentYear - oldestYear;
      awards.push({
        type: "anniversary",
        segment: segment.name,
        segment_id: segment.id,
        time: effort.elapsed_time,
        comparison: anniversaryEfforts[0],
        delta: anniversaryEfforts[0].elapsed_time - effort.elapsed_time,
        message: `Anniversary on ${segment.name}! Also rode this segment on this date ${span} year${span > 1 ? "s" : ""} ago`,
      });
    }
  }

  return awards;
}

/**
 * Compute ride-level awards for an activity by comparing against other activities.
 * These compare the whole ride (distance, elevation, segment count) rather than
 * individual segment efforts.
 *
 * @param {Object} activity — The activity to evaluate
 * @param {Array} allActivities — All activities for comparison (same sport type)
 * @returns {Array} — Array of ride-level award objects
 */
export function computeRideLevelAwards(activity, allActivities) {
  const awards = [];
  const currentYear = new Date(activity.start_date_local).getFullYear();

  // Filter to same sport type and same year, excluding this activity
  const sameTypeThisYear = allActivities.filter(
    (a) =>
      a.sport_type === activity.sport_type &&
      new Date(a.start_date_local).getFullYear() === currentYear &&
      a.id !== activity.id
  );

  // Need at least 5 prior activities this year to make records meaningful
  if (sameTypeThisYear.length < 5) return awards;

  // --- Distance Record (#36) ---
  if (activity.distance > 0) {
    const maxPriorDistance = Math.max(...sameTypeThisYear.map((a) => a.distance || 0));
    if (activity.distance > maxPriorDistance) {
      awards.push({
        type: "distance_record",
        segment: null,
        segment_id: null,
        time: null,
        comparison: null,
        delta: null,
        message: `Longest ${activity.sport_type === "Ride" ? "ride" : "activity"} this year! ${formatDistance(activity.distance)}`,
      });
    }
  }

  // --- Elevation Record (#36) ---
  if (activity.total_elevation_gain > 0) {
    const maxPriorElevation = Math.max(
      ...sameTypeThisYear.map((a) => a.total_elevation_gain || 0)
    );
    if (activity.total_elevation_gain > maxPriorElevation) {
      awards.push({
        type: "elevation_record",
        segment: null,
        segment_id: null,
        time: null,
        comparison: null,
        delta: null,
        message: `Most climbing in a ${activity.sport_type === "Ride" ? "ride" : "activity"} this year! ${Math.round(activity.total_elevation_gain)}m elevation`,
      });
    }
  }

  // --- Segment Count (#36) ---
  const segCount = (activity.segment_efforts || []).length;
  if (segCount > 0) {
    const maxPriorSegments = Math.max(
      ...sameTypeThisYear.map((a) => (a.segment_efforts || []).length)
    );
    if (segCount > maxPriorSegments) {
      awards.push({
        type: "segment_count",
        segment: null,
        segment_id: null,
        time: null,
        comparison: null,
        delta: null,
        message: `Most segments in a single ${activity.sport_type === "Ride" ? "ride" : "activity"} this year! ${segCount} segments`,
      });
    }
  }

  // --- Endurance Record (#31) ---
  if (activity.moving_time > 0) {
    const maxPriorMovingTime = Math.max(...sameTypeThisYear.map((a) => a.moving_time || 0));
    if (activity.moving_time > maxPriorMovingTime) {
      const label = activity.sport_type === "Ride" ? "ride" : "activity";
      awards.push({
        type: "endurance_record",
        segment: null,
        segment_id: null,
        time: null,
        comparison: null,
        delta: null,
        message: `Longest ${label} by time this year! ${formatTime(activity.moving_time)} moving time`,
      });
    }
  }

  return awards;
}

function formatDistance(meters) {
  const km = meters / 1000;
  return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(meters)} m`;
}

/**
 * Compute awards for multiple activities.
 * @param {Array} activities — Activities with segment_efforts populated
 * @returns {Map} — Map of activity.id → awards array
 */
export async function computeAwardsForActivities(activities) {
  const result = new Map();
  for (const activity of activities) {
    const segmentAwards = await computeAwards(activity);
    const rideAwards = computeRideLevelAwards(activity, activities);
    const allAwards = [...segmentAwards, ...rideAwards];
    if (allAwards.length > 0) {
      result.set(activity.id, allAwards);
    }
  }
  return result;
}
