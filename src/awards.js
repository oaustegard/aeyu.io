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
 *   - Top 10%: In the top 10% of your own history
 *     (Superseding: Top 10% > Top Quartile > Beat Median — only highest awarded)
 *   - Consistency (Metronome): Low variance across recent efforts (CV < 0.03, min 8 efforts)
 *   - Monthly Best: Fastest effort on a segment this calendar month (#36)
 *   - Improvement Streak: 3+ consecutive faster times ending now (#36)
 *   - Comeback: Beat median after 3+ sub-median efforts in a row (#36)
 *   - Milestone: Round-number attempt count on a segment (#36)
 *   - Best Month Ever: Fastest effort on segment in this calendar month across all years (#27)
 *   - Closing In: Within 5% of all-time PR on a segment (#28)
 *   - Anniversary: Rode this segment on same date N years ago (#30)
 *   - YTD Best Time: Fastest time by this date across all years
 *   - YTD Best Power: Highest power by this date across all years
 *
 * Comeback Mode awards (computed when a reset event is active, #60):
 *   - Comeback PB: Post-reset personal best on a segment
 *   - Recovery Milestone: Crossed 80/90/95% of pre-injury best on a segment
 *   - You're Back!: Matched or beat pre-injury best (100% recovery)
 *
 * Ride-level awards (computed per-activity, not per-segment):
 *   - Distance Record: Longest ride this year (#36)
 *   - Elevation Record: Most climbing in a ride this year (#36)
 *   - Segment Count: Most segments in a ride this year (#36)
 *   - Endurance Record: Longest moving time this year (#31)
 *   - Comeback Distance/Elevation/Endurance: Post-reset records (#60)
 *
 * Activity-level power awards (Phase 1, #45):
 *   - Season First Power: First power-metered ride of the year
 *   - NP Year Best: Year's highest normalized power (weighted avg watts)
 *   - NP Recent Best: Best NP among last 5 powered rides
 *   - Work Year Best: Highest kilojoules in a single ride this year
 *   - Work Recent Best: Best work output among last 5 powered rides
 *   - Peak Power: Highest max watts recorded this year
 *   - Peak Power Recent: Best peak power among last 5 powered rides
 *
 * Indoor training awards (#46):
 *   - Indoor NP Year Best: Highest NP on trainer rides this year
 *   - Indoor Work Year Best: Most kilojoules in a single indoor session this year
 *   - Trainer Streak: Consecutive weeks with at least one indoor ride
 *   - Indoor vs Outdoor: NP comparison when outdoor ride follows indoor training
 *
 * Power trend & milestone awards (Phase 3, #47):
 *   - Watt Milestone: First ride averaging 100/150/200/250/300/350W
 *   - kJ Milestone: First ride exceeding 500/1000/1500/2000/2500/3000 kJ
 *   - Power Progression: NP trending upward over last 10 rides (linear regression)
 *   - Power Consistency: Low CV in NP across last 10 rides
 *   - FTP Milestone: Estimated FTP (95% of 20-min best) crossing thresholds
 *
 * Power curve awards (Phase 2, #48):
 *   - Curve Year Best: Year's best power at a standard duration (5s/30s/1m/5m/20m/60m)
 *   - Curve All-Time: All-time personal record at a standard duration
 *
 * Streak & consistency awards (#58):
 *   - Weekly Ride Streak: Consecutive weeks with at least one ride (mulligan support)
 *   - Group Ride Consistency: Attendance tracking on recurring group rides
 *   - Streak Danger: Warning when active streak is at risk
 *
 * Data quality rules:
 *   - Minimum effort threshold: comparative awards (Year Best, Recent Best,
 *     Beat Median, Top Quartile, Monthly Best, YTD Best) require ≥3 total efforts.
 *     Season First and Milestone exempt.
 *   - Calendar gate: Year Best suppressed before March 1.
 *   - High-variance filter: segments with CV > 0.5 (≥5 efforts) are
 *     traffic-dominated — all awards suppressed except Season First and Milestone.
 *   - Power awards require device_watts === true (measured, not estimated).
 *   - Indoor awards require trainer === true && device_watts === true.
 *
 * Comeback mode (#60):
 *   When a reset event is active, the engine uses smart fading:
 *   - Recovery zone (>15% slower than pre-injury): suppresses demoralizing
 *     comparative awards; shows comeback-scoped awards instead.
 *   - Transition zone (0-15% slower): shows both normal and comeback awards.
 *   - Recovered (at or better than pre-injury): normal awards + "You're Back!"
 */

import { getSegment, getResetEvent, recordRecoveryMilestone, getUserConfig, getAllActivities, putRoutes, getStravaRoutes } from "./db.js";
import { formatTime, formatDistance } from "./units.js";
import { detectRoutes, findRouteForActivity } from "./routes.js";

/** Minimum total efforts on a segment before comparative awards apply */
const MIN_EFFORTS_FOR_AWARDS = 3;

/** Minimum efforts for statistical awards (beat median, top quartile, top decile) */
const MIN_EFFORTS_FOR_STATISTICAL = 5;

/** Month (1-indexed) before which Year Best awards are suppressed */
const YEAR_BEST_CALENDAR_GATE_MONTH = 3; // March

/** CV above this threshold suppresses awards (traffic-dominated segments) */
const HIGH_VARIANCE_CV_THRESHOLD = 0.5;

/** Minimum efforts before CV filtering kicks in */
const MIN_EFFORTS_FOR_CV = 5;

/** CV below this threshold earns a Consistency award */
const CONSISTENCY_CV_THRESHOLD = 0.03;

/** Minimum recent efforts to evaluate consistency */
const CONSISTENCY_MIN_EFFORTS = 8;

/** Minimum consecutive improving efforts for a streak award */
const STREAK_MIN_LENGTH = 3;

/** Minimum consecutive sub-median efforts before a comeback triggers */
const COMEBACK_MIN_SLUMP = 3;

/** Effort counts that earn a milestone award */
const MILESTONE_COUNTS = [10, 25, 50, 100, 250, 500, 1000];

/** Minimum prior years needed for YTD comparison */
const YTD_MIN_PRIOR_YEARS = 1;

/** Minimum prior indoor rides this year for indoor comparative awards */
const MIN_INDOOR_RIDES_FOR_AWARDS = 3;

/** Minimum consecutive weeks for a trainer streak award */
const TRAINER_STREAK_MIN_WEEKS = 3;

/** Minimum recent indoor rides to compute indoor vs outdoor comparison */
const INDOOR_VS_OUTDOOR_MIN_INDOOR = 3;

/** Minimum powered rides for power trend awards */
const POWER_TREND_MIN_RIDES = 10;

/** R² threshold for power progression trend to trigger award */
const POWER_TREND_R2_THRESHOLD = 0.3;

/** NP Watt milestones */
const WATT_MILESTONES = [100, 150, 200, 250, 300, 350];

/** kJ milestones */
const KJ_MILESTONES = [500, 1000, 1500, 2000, 2500, 3000];

/** FTP milestones (based on 95% of 20-min best power) */
const FTP_MILESTONES = [150, 200, 250, 300, 350, 400];

/** Power curve duration labels for award messages */
const CURVE_DURATION_LABELS = {
  5: "5-second",
  30: "30-second",
  60: "1-minute",
  300: "5-minute",
  1200: "20-minute",
  3600: "60-minute",
};

/** Standard power curve durations */
const POWER_CURVE_DURATIONS = [5, 30, 60, 300, 1200, 3600];

/** Recovery ratio above which normal comparative awards are suppressed */
const RECOVERY_ZONE_THRESHOLD = 1.15;

/** Recovery milestone thresholds (percentage of pre-injury best) */
const RECOVERY_MILESTONES = [80, 90, 95, 100];

/** Award types suppressed during recovery zone (demoralizing comparisons to pre-injury data) */
const SUPPRESSED_IN_RECOVERY = new Set([
  "year_best", "beat_median", "top_quartile", "top_decile",
  "recent_best", "best_month_ever", "ytd_best_time", "ytd_best_power",
  "closing_in",
]);

// ── Award Ranking (#80) ─────────────────────────────────────────────
// Caps per-segment awards to reduce noise when a single segment earns many.

/** Maximum regular awards per segment */
const MAX_AWARDS_PER_SEGMENT = 2;

/** Maximum awards of the same type per activity (controls flood of beat_median, top_quartile, etc.) */
const MAX_AWARDS_PER_TYPE = {
  year_best:          10,
  beat_median:         5,
  top_quartile:        5,
  top_decile:          5,
  consistency:         3,
  closing_in:          3,
  monthly_best:        5,
  recent_best:         5,
  improvement_streak:  5,
  best_month_ever:     5,
  ytd_best_time:       5,
  ytd_best_power:      3,
  anniversary:         3,
  comeback:            3,
};

/** Award types that get a bonus slot (not counted against the cap) */
const COMEBACK_MODE_TYPES = new Set(["comeback_pb", "comeback_full", "recovery_milestone"]);

/** Subsumption rules: higher award removes lower ones on the same segment */
const SUBSUMES = {
  year_best: ["recent_best", "monthly_best", "best_month_ever", "ytd_best_time"],
  ytd_best_time: ["best_month_ever", "monthly_best"],
  best_month_ever: ["monthly_best"],
  comeback_full: ["comeback_pb", "recovery_milestone", "comeback"],
  comeback_pb: ["comeback"],
};

/** Tier ranking (5=highest → 1=lowest) for award priority */
const AWARD_TIER = {
  comeback_full:      5,
  year_best:          4,
  top_decile:         4,
  comeback_pb:        4,
  closing_in:         4,
  ytd_best_time:      3,
  ytd_best_power:     3,
  best_month_ever:    3,
  improvement_streak: 3,
  reference_best:     3,
  consistency:        3,
  recent_best:        2,
  monthly_best:       2,
  top_quartile:       2,
  comeback:           2,
  beat_median:        1,
  anniversary:        1,
  milestone:          1,
  recovery_milestone: 1,
  season_first:       1,
};

/**
 * Rank and cap per-segment awards to reduce noise.
 * Applies subsumption rules, then caps to MAX_AWARDS_PER_SEGMENT regular awards
 * plus one bonus slot for comeback-mode awards.
 * Ride-level awards (segment_id === null) pass through unaffected.
 *
 * @param {Array} awards — Array of award objects from computeAwards
 * @returns {Array} — Filtered/ranked awards
 */
export function rankSegmentAwards(awards) {
  // Separate ride-level awards (no segment) from segment awards
  const rideLevelAwards = awards.filter((a) => !a.segment_id);
  const segmentAwards = awards.filter((a) => a.segment_id);

  if (segmentAwards.length === 0) return awards;

  // Group by segment_id
  const bySegment = new Map();
  for (const award of segmentAwards) {
    if (!bySegment.has(award.segment_id)) {
      bySegment.set(award.segment_id, []);
    }
    bySegment.get(award.segment_id).push(award);
  }

  const ranked = [];
  for (const [, segAwards] of bySegment) {
    // 1. Apply subsumption: remove lower awards that are subsumed by higher ones
    const presentTypes = new Set(segAwards.map((a) => a.type));
    const subsumed = new Set();
    for (const [higher, lowerList] of Object.entries(SUBSUMES)) {
      if (presentTypes.has(higher)) {
        for (const lower of lowerList) {
          subsumed.add(lower);
        }
      }
    }
    const afterSubsumption = segAwards.filter((a) => !subsumed.has(a.type));

    // 2. Separate comeback-mode bonus awards from regular awards
    const comebackAwards = afterSubsumption.filter((a) => COMEBACK_MODE_TYPES.has(a.type));
    const regularAwards = afterSubsumption.filter((a) => !COMEBACK_MODE_TYPES.has(a.type));

    // 3. Sort regular awards by tier (highest first), then cap
    regularAwards.sort((a, b) => (AWARD_TIER[b.type] || 0) - (AWARD_TIER[a.type] || 0));
    const cappedRegular = regularAwards.slice(0, MAX_AWARDS_PER_SEGMENT);

    // 4. Allow at most 1 comeback-mode bonus award (highest tier)
    comebackAwards.sort((a, b) => (AWARD_TIER[b.type] || 0) - (AWARD_TIER[a.type] || 0));
    const bonusComeback = comebackAwards.slice(0, 1);

    ranked.push(...cappedRegular, ...bonusComeback);
  }

  // 5. Tag each award with whether it's the "headline" for its segment.
  // An award is a headline if it's the highest-tier surviving award on its segment.
  // When capping per type, headlines are kept preferentially.
  const segmentTopTier = new Map();
  for (const a of ranked) {
    const tier = AWARD_TIER[a.type] || 0;
    const prev = segmentTopTier.get(a.segment_id) || 0;
    if (tier > prev) segmentTopTier.set(a.segment_id, tier);
  }
  for (const a of ranked) {
    a._isHeadline = (AWARD_TIER[a.type] || 0) === segmentTopTier.get(a.segment_id);
  }

  // 6. Per-activity type caps: limit how many awards of the same type appear.
  // Sort so headlines come first (preferred to survive the cap), then by tier.
  ranked.sort((a, b) => {
    if (a._isHeadline !== b._isHeadline) return a._isHeadline ? -1 : 1;
    return (AWARD_TIER[b.type] || 0) - (AWARD_TIER[a.type] || 0);
  });
  const typeCounts = {};
  const afterTypeCap = ranked.filter((a) => {
    const cap = MAX_AWARDS_PER_TYPE[a.type];
    if (cap === undefined) return true; // no cap for this type
    typeCounts[a.type] = (typeCounts[a.type] || 0) + 1;
    return typeCounts[a.type] <= cap;
  });

  // Clean up internal tags
  for (const a of afterTypeCap) delete a._isHeadline;

  return [...afterTypeCap, ...rideLevelAwards];
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

/** ISO week key (YYYY-Www) for a Date — used for trainer streak calculation */
function isoWeekKey(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // Thursday in current week decides the year
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const yearStart = new Date(d.getFullYear(), 0, 4);
  const weekNo = 1 + Math.round(((d - yearStart) / 86400000 - 3 + ((yearStart.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/** Day of year (0-indexed) for a Date */
function dayOfYear(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date - start) / 86400000);
}

/**
 * Compute YTD comparison for a segment effort.
 * Returns the earliest year the current effort beats (contiguous from most recent),
 * or null if no YTD record.
 *
 * @param {number} currentValue - Current effort value (time in seconds, or watts)
 * @param {Array} allEfforts - All efforts on this segment
 * @param {Date} activityDate - Date of the current activity
 * @param {string} field - "elapsed_time" (lower=better) or "average_watts" (higher=better)
 * @returns {{ sinceYear: number, span: number, rank: number, totalYears: number, pctDelta: number } | null}
 */
function computeYtdComparison(currentValue, allEfforts, activityDate, field) {
  if (currentValue == null) return null;

  const currentYear = activityDate.getFullYear();
  const currentDoy = dayOfYear(activityDate);
  const lowerIsBetter = field === "elapsed_time";

  // Group efforts by year, filtering to YTD window (day-of-year <= current)
  const ytdByYear = {};
  for (const e of allEfforts) {
    const d = new Date(e.start_date_local);
    const year = d.getFullYear();
    const doy = dayOfYear(d);
    if (doy <= currentDoy) {
      const val = e[field];
      if (val != null && val > 0) {
        if (!ytdByYear[year]) ytdByYear[year] = [];
        ytdByYear[year].push(val);
      }
    }
  }

  // Best per year in YTD window
  const bestByYear = {};
  for (const [year, values] of Object.entries(ytdByYear)) {
    bestByYear[year] = lowerIsBetter
      ? Math.min(...values)
      : Math.max(...values);
  }

  // Check current year's best matches this effort
  const currentYearBest = bestByYear[currentYear];
  if (currentYearBest == null) return null;
  if (lowerIsBetter && currentValue > currentYearBest) return null;
  if (!lowerIsBetter && currentValue < currentYearBest) return null;

  // Walk prior years from most recent backward, find contiguous span we beat
  const priorYears = Object.keys(bestByYear)
    .map(Number)
    .filter((y) => y < currentYear)
    .sort((a, b) => b - a); // newest first

  if (priorYears.length < YTD_MIN_PRIOR_YEARS) return null;

  let sinceYear = null;
  for (const year of priorYears) {
    const priorBest = bestByYear[year];
    const beats = lowerIsBetter
      ? currentValue <= priorBest
      : currentValue >= priorBest;
    if (beats) {
      sinceYear = year;
    } else {
      break; // contiguous chain broken
    }
  }

  if (sinceYear == null) return null;

  // Rank among all years' bests and % delta from average
  const allBests = Object.values(bestByYear);
  const totalYears = allBests.length;
  const rank = lowerIsBetter
    ? allBests.filter((v) => v < currentValue).length + 1
    : allBests.filter((v) => v > currentValue).length + 1;
  const avg = allBests.reduce((s, v) => s + v, 0) / allBests.length;
  const pctDelta = avg !== 0
    ? Math.round(Math.abs(currentValue - avg) / avg * 1000) / 10
    : 0;

  return { sinceYear, span: currentYear - sinceYear, rank, totalYears, pctDelta };
}


/**
 * Resolve a reference point to a cutoff date or effort count.
 * @param {Object} refPoint - Reference point config
 * @returns {{ type: "date", date: Date, label: string } | { type: "count", count: number, label: string }}
 */
function resolveReferencePoint(refPoint) {
  if (refPoint.type === "since_date") {
    return { type: "date", date: new Date(refPoint.date), label: refPoint.label };
  }
  if (refPoint.type === "last_n") {
    return { type: "count", count: refPoint.count, label: refPoint.label };
  }
  if (refPoint.type === "since_age") {
    const birthday = new Date(refPoint.birthday);
    const ageDate = new Date(birthday);
    ageDate.setFullYear(ageDate.getFullYear() + refPoint.age);
    return { type: "date", date: ageDate, label: refPoint.label };
  }
  return null;
}

/**
 * Compute reference_best awards for a segment effort against user-defined reference points.
 * @param {Object} effort - Current segment effort
 * @param {Array} allEfforts - All efforts on this segment
 * @param {Object} segment - Segment data
 * @param {Array} referencePoints - User-defined reference points
 * @returns {Array} - Awards for this effort
 */
function computeReferenceAwards(effort, allEfforts, segment, referencePoints) {
  const awards = [];
  for (const refPoint of referencePoints) {
    const resolved = resolveReferencePoint(refPoint);
    if (!resolved) continue;

    let windowEfforts;
    if (resolved.type === "date") {
      windowEfforts = allEfforts.filter(
        (e) => new Date(e.start_date_local) >= resolved.date
      );
    } else {
      // Last N efforts by date (most recent N)
      const sorted = [...allEfforts].sort(
        (a, b) => b.start_date_local.localeCompare(a.start_date_local)
      );
      windowEfforts = sorted.slice(0, resolved.count);
    }

    // Need at least 2 efforts in the window to make comparison meaningful
    if (windowEfforts.length < 2) continue;

    const bestInWindow = Math.min(...windowEfforts.map((e) => e.elapsed_time));
    if (effort.elapsed_time === bestInWindow) {
      const others = windowEfforts
        .filter((e) => e.effort_id !== effort.id)
        .sort((a, b) => a.elapsed_time - b.elapsed_time);
      const previousBest = others.length > 0 ? others[0] : null;

      awards.push({
        type: "reference_best",
        segment: segment.name,
        segment_id: segment.id,
        time: effort.elapsed_time,
        power: effort.average_watts || null,
        comparison: previousBest,
        delta: previousBest ? previousBest.elapsed_time - effort.elapsed_time : null,
        reference_label: resolved.label,
        message: previousBest
          ? `Best ${resolved.label} on ${segment.name}! ${formatTime(effort.elapsed_time)} (previous: ${formatTime(previousBest.elapsed_time)})`
          : `Best ${resolved.label} on ${segment.name}! ${formatTime(effort.elapsed_time)}`,
      });
    }
  }
  return awards;
}

/**
 * Compute comeback context for a segment effort given an active reset event.
 * @param {Object} effort - Current segment effort
 * @param {Array} allEfforts - All efforts on this segment
 * @param {Object} resetEvent - Active reset event { name, date, sport_types, milestones }
 * @returns {{ preInjuryBest: number|null, recoveryRatio: number|null, inRecoveryZone: boolean, postResetEfforts: Array }}
 */
function computeComebackContext(effort, allEfforts, resetEvent) {
  const resetDate = new Date(resetEvent.date);

  // Split efforts into pre and post reset
  const preResetEfforts = allEfforts.filter(
    (e) => new Date(e.start_date_local) < resetDate
  );
  const postResetEfforts = allEfforts.filter(
    (e) => new Date(e.start_date_local) >= resetDate
  );

  if (preResetEfforts.length === 0) {
    return { preInjuryBest: null, recoveryRatio: null, inRecoveryZone: false, postResetEfforts };
  }

  const preInjuryBest = Math.min(...preResetEfforts.map((e) => e.elapsed_time));
  const recoveryRatio = effort.elapsed_time / preInjuryBest;
  const inRecoveryZone = recoveryRatio > RECOVERY_ZONE_THRESHOLD;

  return { preInjuryBest, recoveryRatio, postResetEfforts, inRecoveryZone };
}


/**
 * Compute awards for a single activity's segment efforts.
 * @param {Object} activity — Activity with segment_efforts populated
 * @param {Object|null} resetEvent — Active reset event, if any
 * @returns {Array} — Array of award objects
 */
export async function computeAwards(activity, resetEvent = null, referencePoints = []) {
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

    // --- Comeback context (#60) ---
    const activityDate_raw = new Date(activity.start_date_local);
    const comebackActive = resetEvent &&
      activityDate_raw >= new Date(resetEvent.date) &&
      (!resetEvent.sport_types || resetEvent.sport_types.includes(activity.sport_type));
    const comebackCtx = comebackActive
      ? computeComebackContext(effort, allEfforts, resetEvent)
      : null;

    // --- Milestone (#36) — exempt from CV filter ---
    if (MILESTONE_COUNTS.includes(allEfforts.length)) {
      awards.push({
        type: "milestone",
        segment: segment.name,
        segment_id: segment.id,
        time: effort.elapsed_time,
        power: effort.average_watts || null,
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
        power: effort.average_watts || null,
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

    const activityDate = new Date(activity.start_date_local);

    // --- Year Best ---
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

        const yearTimes = thisYearEfforts.map((e) => e.elapsed_time);
        const yearAvg = yearTimes.reduce((s, v) => s + v, 0) / yearTimes.length;
        const ybPctDelta = yearAvg !== 0
          ? Math.round(Math.abs(effort.elapsed_time - yearAvg) / yearAvg * 1000) / 10
          : 0;

        awards.push({
          type: "year_best",
          segment: segment.name,
          segment_id: segment.id,
          time: effort.elapsed_time,
          power: effort.average_watts || null,
          comparison: previousBest,
          delta: previousBest
            ? previousBest.elapsed_time - effort.elapsed_time
            : null,
          rank: 1,
          totalInSet: thisYearEfforts.length,
          pctDelta: ybPctDelta,
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
        const recentTimes = last5.map((e) => e.elapsed_time);
        const recentAvg = recentTimes.reduce((s, v) => s + v, 0) / recentTimes.length;
        const rbPctDelta = recentAvg !== 0
          ? Math.round(Math.abs(effort.elapsed_time - recentAvg) / recentAvg * 1000) / 10
          : 0;

        awards.push({
          type: "recent_best",
          segment: segment.name,
          segment_id: segment.id,
          time: effort.elapsed_time,
          power: effort.average_watts || null,
          comparison: null,
          delta: null,
          rank: 1,
          totalInSet: last5.length,
          pctDelta: rbPctDelta,
          message: `Best of your last ${last5.length} on ${segment.name}! ${formatTime(effort.elapsed_time)}`,
        });
      }
    }

    // --- Beat Median / Top Quartile / Top 10% (superseding hierarchy) ---
    // Top 10% supersedes Top Quartile supersedes Beat Median.
    // Only the highest-tier award is granted per segment.
    // Requires more history than basic comparative awards for statistical reliability.
    if (allEfforts.length >= MIN_EFFORTS_FOR_STATISTICAL) {
      const sortedTimes = [...allTimes].sort((a, b) => a - b);
      const med = median(sortedTimes);
      const q1Index = Math.floor(sortedTimes.length * 0.25);
      const q1Threshold = sortedTimes[q1Index];
      const d1Index = Math.floor(sortedTimes.length * 0.10);
      const d1Threshold = sortedTimes[d1Index];
      const pctile = percentileRank(allTimes, effort.elapsed_time);
      const rank = sortedTimes.filter((t) => t < effort.elapsed_time).length + 1;

      if (effort.elapsed_time <= d1Threshold) {
        awards.push({
          type: "top_decile",
          segment: segment.name,
          segment_id: segment.id,
          time: effort.elapsed_time,
          power: effort.average_watts || null,
          comparison: null,
          delta: null,
          message: `Top 10% on ${segment.name}! #${rank} of ${allEfforts.length} efforts — ${formatTime(effort.elapsed_time)}`,
        });
      } else if (effort.elapsed_time <= q1Threshold) {
        awards.push({
          type: "top_quartile",
          segment: segment.name,
          segment_id: segment.id,
          time: effort.elapsed_time,
          power: effort.average_watts || null,
          comparison: null,
          delta: null,
          message: `Top quartile on ${segment.name}! #${rank} of ${allEfforts.length} efforts — ${formatTime(effort.elapsed_time)}`,
        });
      } else if (effort.elapsed_time < med && (med - effort.elapsed_time) / med >= 0.02) {
        awards.push({
          type: "beat_median",
          segment: segment.name,
          segment_id: segment.id,
          time: effort.elapsed_time,
          power: effort.average_watts || null,
          comparison: null,
          delta: Math.round(med - effort.elapsed_time),
          message: `Beat your median on ${segment.name}! ${formatTime(effort.elapsed_time)} — ${formatTime(Math.round(med - effort.elapsed_time))} under median (top ${100 - pctile}% of ${allEfforts.length} efforts)`,
        });
      }
    }

    // --- Consistency / Metronome (#39, tightened #109) ---
    const recentForConsistency = sortedByDate.slice(0, CONSISTENCY_MIN_EFFORTS);
    if (recentForConsistency.length >= CONSISTENCY_MIN_EFFORTS) {
      const recentTimes = recentForConsistency.map((e) => e.elapsed_time);
      const recentCV = cv(recentTimes);
      const spread = Math.max(...recentTimes) - Math.min(...recentTimes);

      if (recentCV <= CONSISTENCY_CV_THRESHOLD) {
        awards.push({
          type: "consistency",
          segment: segment.name,
          segment_id: segment.id,
          time: effort.elapsed_time,
          power: effort.average_watts || null,
          comparison: null,
          delta: null,
          message: `Metronome on ${segment.name}! ${spread}s spread across last ${recentForConsistency.length} efforts (CV: ${(recentCV * 100).toFixed(1)}%)`,
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
        const monthTimes = thisMonthEfforts.map((e) => e.elapsed_time);
        const monthAvg = monthTimes.reduce((s, v) => s + v, 0) / monthTimes.length;
        const mbPctDelta = monthAvg !== 0
          ? Math.round(Math.abs(effort.elapsed_time - monthAvg) / monthAvg * 1000) / 10
          : 0;

        awards.push({
          type: "monthly_best",
          segment: segment.name,
          segment_id: segment.id,
          time: effort.elapsed_time,
          power: effort.average_watts || null,
          comparison: null,
          delta: null,
          rank: 1,
          totalInSet: thisMonthEfforts.length,
          pctDelta: mbPctDelta,
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
          power: effort.average_watts || null,
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
            power: effort.average_watts || null,
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
            const sameMonthTimes = sameMonthEfforts.map((e) => e.elapsed_time);
            const sameMonthAvg = sameMonthTimes.reduce((s, v) => s + v, 0) / sameMonthTimes.length;
            const bmePctDelta = sameMonthAvg !== 0
              ? Math.round(Math.abs(effort.elapsed_time - sameMonthAvg) / sameMonthAvg * 1000) / 10
              : 0;

            awards.push({
              type: "best_month_ever",
              segment: segment.name,
              segment_id: segment.id,
              time: effort.elapsed_time,
              power: effort.average_watts || null,
              comparison: null,
              delta: null,
              rank: 1,
              totalInSet: sameMonthEfforts.length,
              pctDelta: bmePctDelta,
              message: `Best ${monthName} ever on ${segment.name}! ${formatTime(effort.elapsed_time)} — fastest across ${yearsSpanned} years`,
            });
          }
        }
      }
    }

    // --- Closing In on PR (#28) ---
    // Within 5% of all-time best (but not the best itself)
    if (allEfforts.length >= MIN_EFFORTS_FOR_AWARDS) {
      const allTimeBest = Math.min(...allTimes);
      if (effort.elapsed_time > allTimeBest) {
        const gap = (effort.elapsed_time - allTimeBest) / allTimeBest;
        if (gap <= 0.05) {
          const pctLabel = gap <= 0.02 ? "2%" : "5%";
          awards.push({
            type: "closing_in",
            segment: segment.name,
            segment_id: segment.id,
            time: effort.elapsed_time,
            power: effort.average_watts || null,
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
        power: effort.average_watts || null,
        comparison: anniversaryEfforts[0],
        delta: anniversaryEfforts[0].elapsed_time - effort.elapsed_time,
        message: `Anniversary on ${segment.name}! Also rode this segment on this date ${span} year${span > 1 ? "s" : ""} ago`,
      });
    }

    // --- YTD Best Time ---
    // Fastest time on this segment by this date (day-of-year) across all years
    if (allEfforts.length >= MIN_EFFORTS_FOR_AWARDS && afterCalendarGate) {
      const ytdTime = computeYtdComparison(
        effort.elapsed_time, allEfforts, activityDate, "elapsed_time"
      );
      if (ytdTime && ytdTime.span >= 1) {
        const monthDay = activityDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        awards.push({
          type: "ytd_best_time",
          segment: segment.name,
          segment_id: segment.id,
          time: effort.elapsed_time,
          power: effort.average_watts || null,
          comparison: null,
          delta: null,
          rank: ytdTime.rank,
          totalInSet: ytdTime.totalYears,
          pctDelta: ytdTime.pctDelta,
          message: `Fastest by ${monthDay} since ${ytdTime.sinceYear}! ${formatTime(effort.elapsed_time)} on ${segment.name} — best YTD across ${ytdTime.span + 1} years`,
        });
      }
    }

    // --- YTD Best Power ---
    // Highest average watts on this segment by this date across all years
    // Only when power is measured (device_watts)
    if (
      allEfforts.length >= MIN_EFFORTS_FOR_AWARDS &&
      effort.device_watts &&
      effort.average_watts &&
      effort.average_watts > 0
    ) {
      // Filter to efforts with measured power
      const poweredEfforts = allEfforts.filter(
        (e) => e.device_watts && e.average_watts && e.average_watts > 0
      );
      if (poweredEfforts.length >= MIN_EFFORTS_FOR_AWARDS) {
        const ytdPower = computeYtdComparison(
          effort.average_watts, poweredEfforts, activityDate, "average_watts"
        );
        if (ytdPower && ytdPower.span >= 1) {
          const monthDay = activityDate.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          awards.push({
            type: "ytd_best_power",
            segment: segment.name,
            segment_id: segment.id,
            time: effort.elapsed_time,
            power: effort.average_watts,
            comparison: null,
            delta: null,
            rank: ytdPower.rank,
            totalInSet: ytdPower.totalYears,
            pctDelta: ytdPower.pctDelta,
            message: `Best power by ${monthDay} since ${ytdPower.sinceYear}! ${Math.round(effort.average_watts)}W on ${segment.name} — best YTD across ${ytdPower.span + 1} years`,
          });
        }
      }
    }

    // --- Reference Point Awards (user-defined "best since" comparisons) ---
    if (referencePoints.length > 0 && !isHighVariance && allEfforts.length >= MIN_EFFORTS_FOR_AWARDS) {
      const refAwards = computeReferenceAwards(effort, allEfforts, segment, referencePoints);
      awards.push(...refAwards);
    }

    // --- Comeback Awards (#60) ---
    if (comebackCtx && comebackCtx.preInjuryBest != null) {
      const { preInjuryBest, recoveryRatio, postResetEfforts } = comebackCtx;
      const eventName = resetEvent.name || "reset";

      // Comeback PB: post-reset personal best on this segment
      if (postResetEfforts.length >= 2) {
        const bestPostReset = Math.min(...postResetEfforts.map((e) => e.elapsed_time));
        if (effort.elapsed_time === bestPostReset) {
          const prevPostReset = postResetEfforts
            .filter((e) => e.effort_id !== effort.id)
            .sort((a, b) => a.elapsed_time - b.elapsed_time);
          const prevBest = prevPostReset.length > 0 ? prevPostReset[0] : null;
          awards.push({
            type: "comeback_pb",
            segment: segment.name,
            segment_id: segment.id,
            time: effort.elapsed_time,
            power: effort.average_watts || null,
            comparison: prevBest,
            delta: prevBest ? prevBest.elapsed_time - effort.elapsed_time : null,
            message: prevBest
              ? `Best time since ${eventName} on ${segment.name}! ${formatTime(effort.elapsed_time)} (previous: ${formatTime(prevBest.elapsed_time)})`
              : `Best time since ${eventName} on ${segment.name}! ${formatTime(effort.elapsed_time)}`,
          });
        }
      }

      // Recovery Milestone: crossing 80%, 90%, 95%, 100% of pre-injury best
      const recoveryPct = Math.min(100, Math.round((preInjuryBest / effort.elapsed_time) * 100));
      const awarded = (resetEvent.milestones && resetEvent.milestones[segment.id]) || [];
      for (const threshold of RECOVERY_MILESTONES) {
        if (recoveryPct >= threshold && !awarded.includes(threshold)) {
          const label = threshold === 100
            ? `You're back on ${segment.name}! Matched your pre-${eventName} best — ${formatTime(effort.elapsed_time)}`
            : `Back to ${threshold}% on ${segment.name}! ${formatTime(effort.elapsed_time)} — recovering toward your pre-${eventName} best of ${formatTime(preInjuryBest)}`;
          awards.push({
            type: threshold === 100 ? "comeback_full" : "recovery_milestone",
            segment: segment.name,
            segment_id: segment.id,
            time: effort.elapsed_time,
            power: effort.average_watts || null,
            comparison: null,
            delta: effort.elapsed_time - preInjuryBest,
            message: label,
            _milestone_threshold: threshold,
            _milestone_segment_id: segment.id,
          });
        }
      }
    }
  }

  // --- Comeback suppression (#60) ---
  // In recovery zone, suppress demoralizing comparisons to pre-injury data
  if (resetEvent) {
    const resetDate = new Date(resetEvent.date);
    const actDate = new Date(activity.start_date_local);
    const isPostReset = actDate >= resetDate &&
      (!resetEvent.sport_types || resetEvent.sport_types.includes(activity.sport_type));

    if (isPostReset) {
      // Check if ANY segment on this activity is in the recovery zone
      const hasRecoveryZone = awards.some(
        (a) => a.type === "comeback_pb" || a.type === "recovery_milestone" || a.type === "comeback_full"
      );
      if (hasRecoveryZone) {
        // Only suppress if the athlete is still recovering on at least one segment
        // Keep awards for segments where they're fully recovered
        return rankSegmentAwards(awards.filter((a) => {
          if (!SUPPRESSED_IN_RECOVERY.has(a.type)) return true;
          // Check this specific segment's recovery status
          if (!a.segment_id) return true; // ride-level awards pass through
          // Find the comeback context for this segment — if no comeback PB or milestone exists
          // for this segment, the athlete might be fully recovered on it
          const hasRecoveryAward = awards.some(
            (r) => r.segment_id === a.segment_id &&
              (r.type === "recovery_milestone" || r.type === "comeback_full")
          );
          // If there's a "comeback_full" (100%), athlete is back — don't suppress
          const isFullyRecovered = awards.some(
            (r) => r.segment_id === a.segment_id && r.type === "comeback_full"
          );
          if (isFullyRecovered) return true;
          // Suppress comparative awards for segments still in recovery
          return !hasRecoveryAward;
        }));
      }
    }
  }

  return rankSegmentAwards(awards);
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
export function computeRideLevelAwards(activity, allActivities, resetEvent = null) {
  const awards = [];
  const currentYear = new Date(activity.start_date_local).getFullYear();

  // Filter to same sport type and same year, excluding this activity
  const sameTypeThisYear = allActivities.filter(
    (a) =>
      a.sport_type === activity.sport_type &&
      new Date(a.start_date_local).getFullYear() === currentYear &&
      a.id !== activity.id
  );

  // --- Season First Power (exempt from min-activity gate, like season_first) ---
  if (activity.device_watts && activity.weighted_average_watts > 0) {
    const poweredSameTypeThisYear = sameTypeThisYear.filter(
      (a) => a.device_watts && a.weighted_average_watts > 0
    );
    if (poweredSameTypeThisYear.length === 0) {
      const priorYearsPowered = allActivities.filter(
        (a) =>
          a.sport_type === activity.sport_type &&
          a.device_watts &&
          a.weighted_average_watts > 0 &&
          new Date(a.start_date_local).getFullYear() < currentYear
      );
      const label = activity.sport_type === "Ride" ? "ride" : "activity";
      awards.push({
        type: "season_first_power",
        segment: null,
        segment_id: null,
        time: null,
        power: activity.weighted_average_watts,
        comparison: null,
        delta: null,
        message: priorYearsPowered.length > 0
          ? `First power-metered ${label} of the year! Welcome back to the pain cave — ${Math.round(activity.weighted_average_watts)}W NP`
          : `First power-metered ${label} of the year! ${Math.round(activity.weighted_average_watts)}W NP`,
      });
    }
  }

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
        power: null,
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
        power: null,
        comparison: null,
        delta: null,
        message: `Most climbing in a ${activity.sport_type === "Ride" ? "ride" : "activity"} this year! ${formatDistance(activity.total_elevation_gain)} elevation`,
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
        power: null,
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
        power: null,
        comparison: null,
        delta: null,
        message: `Longest ${label} by time this year! ${formatTime(activity.moving_time)} moving time`,
      });
    }
  }

  // ── Activity-Level Power Awards (Phase 1, #45) ──────────────────
  // All require device_watts === true (measured power, not estimated).
  // Compared within same sport_type to respect different power profiles.
  // (Season First Power is computed above, before the min-activity gate.)
  if (activity.device_watts && activity.weighted_average_watts > 0) {
    const poweredSameTypeThisYear = sameTypeThisYear.filter(
      (a) => a.device_watts && a.weighted_average_watts > 0
    );

    // Power awards require 5+ prior powered activities (same threshold as other ride-level)
    if (poweredSameTypeThisYear.length >= 5) {
      const activityDate = new Date(activity.start_date_local);
      const afterCalendarGate = (activityDate.getMonth() + 1) >= YEAR_BEST_CALENDAR_GATE_MONTH;

      // --- NP Year Best ---
      // Year's highest weighted average watts (normalized power)
      if (afterCalendarGate) {
        const maxPriorNP = Math.max(
          ...poweredSameTypeThisYear.map((a) => a.weighted_average_watts)
        );
        if (activity.weighted_average_watts > maxPriorNP) {
          awards.push({
            type: "np_year_best",
            segment: null,
            segment_id: null,
            time: null,
            power: activity.weighted_average_watts,
            comparison: null,
            delta: Math.round(activity.weighted_average_watts - maxPriorNP),
            message: `Year's best Normalized Power! ${Math.round(activity.weighted_average_watts)}W NP — ${Math.round(activity.weighted_average_watts - maxPriorNP)}W above previous best`,
          });
        }
      }

      // --- Work/Energy Year Best ---
      // Highest kilojoules in a single ride this year
      if (afterCalendarGate && activity.kilojoules > 0) {
        const poweredWithKJ = poweredSameTypeThisYear.filter((a) => a.kilojoules > 0);
        if (poweredWithKJ.length >= 5) {
          const maxPriorKJ = Math.max(...poweredWithKJ.map((a) => a.kilojoules));
          if (activity.kilojoules > maxPriorKJ) {
            awards.push({
              type: "work_year_best",
              segment: null,
              segment_id: null,
              time: null,
              power: activity.weighted_average_watts,
              comparison: null,
              delta: Math.round(activity.kilojoules - maxPriorKJ),
              message: `Year's highest work output! ${Math.round(activity.kilojoules)} kJ — ${Math.round(activity.kilojoules - maxPriorKJ)} kJ above previous best`,
            });
          }
        }
      }

      // --- Peak Power Year Best ---
      // Highest max watts recorded this year
      if (afterCalendarGate && activity.max_watts > 0) {
        const poweredWithMax = poweredSameTypeThisYear.filter((a) => a.max_watts > 0);
        if (poweredWithMax.length >= 5) {
          const maxPriorPeak = Math.max(...poweredWithMax.map((a) => a.max_watts));
          if (activity.max_watts > maxPriorPeak) {
            awards.push({
              type: "peak_power",
              segment: null,
              segment_id: null,
              time: null,
              power: activity.max_watts,
              comparison: null,
              delta: activity.max_watts - maxPriorPeak,
              message: `Year's highest peak power! ${activity.max_watts}W — ${activity.max_watts - maxPriorPeak}W above previous best`,
            });
          }
        }
      }
    }

    // --- NP Recent Best ---
    // Best normalized power among last 5 powered rides (same sport type)
    const allPoweredSameType = allActivities
      .filter(
        (a) =>
          a.sport_type === activity.sport_type &&
          a.device_watts &&
          a.weighted_average_watts > 0 &&
          a.id !== activity.id
      )
      .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local));
    const recentPowered = allPoweredSameType.slice(0, 4); // last 4 others + this = 5

    if (recentPowered.length >= 3) {
      const bestRecentNP = Math.max(...recentPowered.map((a) => a.weighted_average_watts));
      if (activity.weighted_average_watts > bestRecentNP) {
        awards.push({
          type: "np_recent_best",
          segment: null,
          segment_id: null,
          time: null,
          power: activity.weighted_average_watts,
          comparison: null,
          delta: Math.round(activity.weighted_average_watts - bestRecentNP),
          message: `Best NP of your last ${recentPowered.length + 1} powered ${activity.sport_type === "Ride" ? "rides" : "activities"}! ${Math.round(activity.weighted_average_watts)}W`,
        });
      }
    }

    // --- Work/Energy Recent Best ---
    if (activity.kilojoules > 0) {
      const recentWithKJ = allPoweredSameType
        .filter((a) => a.kilojoules > 0)
        .slice(0, 4);
      if (recentWithKJ.length >= 3) {
        const bestRecentKJ = Math.max(...recentWithKJ.map((a) => a.kilojoules));
        if (activity.kilojoules > bestRecentKJ) {
          awards.push({
            type: "work_recent_best",
            segment: null,
            segment_id: null,
            time: null,
            power: activity.weighted_average_watts,
            comparison: null,
            delta: Math.round(activity.kilojoules - bestRecentKJ),
            message: `Best work output of your last ${recentWithKJ.length + 1} powered ${activity.sport_type === "Ride" ? "rides" : "activities"}! ${Math.round(activity.kilojoules)} kJ`,
          });
        }
      }
    }

    // --- Peak Power Recent Best ---
    if (activity.max_watts > 0) {
      const recentWithMax = allPoweredSameType
        .filter((a) => a.max_watts > 0)
        .slice(0, 4);
      if (recentWithMax.length >= 3) {
        const bestRecentPeak = Math.max(...recentWithMax.map((a) => a.max_watts));
        if (activity.max_watts > bestRecentPeak) {
          awards.push({
            type: "peak_power_recent",
            segment: null,
            segment_id: null,
            time: null,
            power: activity.max_watts,
            comparison: null,
            delta: activity.max_watts - bestRecentPeak,
            message: `Best peak power of your last ${recentWithMax.length + 1} powered ${activity.sport_type === "Ride" ? "rides" : "activities"}! ${activity.max_watts}W`,
          });
        }
      }
    }
  }

  // ── Indoor Training Awards (#46) ─────────────────────────────────
  // All require trainer === true && device_watts === true.
  // Indoor rides lack segments/KOMs, so these activity-level awards provide
  // recognition for trainer efforts that would otherwise go unnoticed.
  if (activity.trainer && activity.device_watts && activity.weighted_average_watts > 0) {
    const indoorSameTypeThisYear = sameTypeThisYear.filter(
      (a) => a.trainer && a.device_watts && a.weighted_average_watts > 0
    );

    const activityDate = new Date(activity.start_date_local);
    const afterCalendarGate = (activityDate.getMonth() + 1) >= YEAR_BEST_CALENDAR_GATE_MONTH;

    // --- Indoor NP Year Best ---
    // Highest weighted average watts among trainer rides this year
    if (afterCalendarGate && indoorSameTypeThisYear.length >= MIN_INDOOR_RIDES_FOR_AWARDS) {
      const maxPriorIndoorNP = Math.max(
        ...indoorSameTypeThisYear.map((a) => a.weighted_average_watts)
      );
      if (activity.weighted_average_watts > maxPriorIndoorNP) {
        awards.push({
          type: "indoor_np_year_best",
          segment: null,
          segment_id: null,
          time: null,
          power: activity.weighted_average_watts,
          comparison: null,
          delta: Math.round(activity.weighted_average_watts - maxPriorIndoorNP),
          message: `Indoor NP record! ${Math.round(activity.weighted_average_watts)}W — ${Math.round(activity.weighted_average_watts - maxPriorIndoorNP)}W above your previous indoor best this year`,
        });
      }
    }

    // --- Indoor Work Year Best ---
    // Highest kilojoules in a single indoor session this year
    if (afterCalendarGate && activity.kilojoules > 0) {
      const indoorWithKJ = indoorSameTypeThisYear.filter((a) => a.kilojoules > 0);
      if (indoorWithKJ.length >= MIN_INDOOR_RIDES_FOR_AWARDS) {
        const maxPriorIndoorKJ = Math.max(...indoorWithKJ.map((a) => a.kilojoules));
        if (activity.kilojoules > maxPriorIndoorKJ) {
          awards.push({
            type: "indoor_work_year_best",
            segment: null,
            segment_id: null,
            time: null,
            power: activity.weighted_average_watts,
            comparison: null,
            delta: Math.round(activity.kilojoules - maxPriorIndoorKJ),
            message: `Indoor work record! ${Math.round(activity.kilojoules)} kJ — ${Math.round(activity.kilojoules - maxPriorIndoorKJ)} kJ above your previous indoor best this year`,
          });
        }
      }
    }

    // --- Trainer Streak ---
    // Consecutive weeks (ending with this week) with at least one indoor ride
    const allIndoorSameType = allActivities
      .filter(
        (a) =>
          a.sport_type === activity.sport_type &&
          a.trainer &&
          a.device_watts
      )
      .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local));

    if (allIndoorSameType.length >= TRAINER_STREAK_MIN_WEEKS) {
      // Build set of ISO week keys (YYYY-Www) for all indoor rides
      const weeksWithIndoor = new Set();
      for (const a of allIndoorSameType) {
        weeksWithIndoor.add(isoWeekKey(new Date(a.start_date_local)));
      }
      // Walk backwards from current week
      const currentWeek = isoWeekKey(activityDate);
      let streak = 0;
      let checkDate = new Date(activityDate);
      // Align to start of current week (Monday)
      const dayOfWeek = checkDate.getDay() || 7; // Sunday = 7
      checkDate.setDate(checkDate.getDate() - (dayOfWeek - 1));
      while (weeksWithIndoor.has(isoWeekKey(checkDate))) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 7);
      }
      if (streak >= TRAINER_STREAK_MIN_WEEKS) {
        awards.push({
          type: "trainer_streak",
          segment: null,
          segment_id: null,
          time: null,
          power: activity.weighted_average_watts,
          comparison: null,
          delta: null,
          message: `${streak}-week trainer streak! You've been on the trainer every week for ${streak} straight weeks`,
        });
      }
    }
  }

  // --- Indoor vs Outdoor (#46) ---
  // When an outdoor powered ride happens, compare NP against recent indoor average.
  // Helps athletes see how indoor training translates to outdoor performance.
  if (
    !activity.trainer &&
    activity.device_watts &&
    activity.weighted_average_watts > 0
  ) {
    const recentIndoor = allActivities
      .filter(
        (a) =>
          a.sport_type === activity.sport_type &&
          a.trainer &&
          a.device_watts &&
          a.weighted_average_watts > 0 &&
          a.start_date_local < activity.start_date_local
      )
      .sort((a, b) => b.start_date_local.localeCompare(a.start_date_local))
      .slice(0, 5);

    if (recentIndoor.length >= INDOOR_VS_OUTDOOR_MIN_INDOOR) {
      const indoorAvgNP = Math.round(
        recentIndoor.reduce((sum, a) => sum + a.weighted_average_watts, 0) / recentIndoor.length
      );
      const diff = Math.round(activity.weighted_average_watts - indoorAvgNP);
      const pct = Math.round((diff / indoorAvgNP) * 100);
      // Only award if outdoor NP is within 20% of indoor average (meaningful comparison)
      if (Math.abs(pct) <= 20) {
        const absDiff = Math.abs(diff);
        const absPct = Math.abs(pct);
        awards.push({
          type: "indoor_vs_outdoor",
          segment: null,
          segment_id: null,
          time: null,
          power: activity.weighted_average_watts,
          comparison: null,
          delta: diff,
          message: diff >= 0
            ? `Outdoor NP ${absDiff}W above indoor average! ${Math.round(activity.weighted_average_watts)}W vs ${indoorAvgNP}W indoor avg (+${absPct}%) — the training is paying off`
            : `Outdoor NP ${absDiff}W below indoor average — ${Math.round(activity.weighted_average_watts)}W vs ${indoorAvgNP}W indoor avg (${pct}%) — wind and hills change the game`,
        });
      }
    }
  }

  // --- Comeback Ride-Level Records (#60) ---
  if (resetEvent) {
    const resetDate = new Date(resetEvent.date);
    const actDate = new Date(activity.start_date_local);
    const isPostReset = actDate >= resetDate &&
      (!resetEvent.sport_types || resetEvent.sport_types.includes(activity.sport_type));

    if (isPostReset) {
      const eventName = resetEvent.name || "reset";
      const sameTypePostReset = allActivities.filter(
        (a) =>
          a.sport_type === activity.sport_type &&
          new Date(a.start_date_local) >= resetDate &&
          a.id !== activity.id
      );

      // Only need 2 post-reset activities to start comparing (lower bar than normal)
      if (sameTypePostReset.length >= 2) {
        // Comeback Distance Record
        if (activity.distance > 0) {
          const maxPostReset = Math.max(...sameTypePostReset.map((a) => a.distance || 0));
          if (activity.distance > maxPostReset) {
            awards.push({
              type: "comeback_distance",
              segment: null,
              segment_id: null,
              time: null,
              power: null,
              comparison: null,
              delta: null,
              message: `Longest ${activity.sport_type === "Ride" ? "ride" : "activity"} since ${eventName}! ${formatDistance(activity.distance)}`,
            });
          }
        }

        // Comeback Elevation Record
        if (activity.total_elevation_gain > 0) {
          const maxPostReset = Math.max(...sameTypePostReset.map((a) => a.total_elevation_gain || 0));
          if (activity.total_elevation_gain > maxPostReset) {
            awards.push({
              type: "comeback_elevation",
              segment: null,
              segment_id: null,
              time: null,
              power: null,
              comparison: null,
              delta: null,
              message: `Most climbing since ${eventName}! ${formatDistance(activity.total_elevation_gain)} elevation`,
            });
          }
        }

        // Comeback Endurance Record
        if (activity.moving_time > 0) {
          const maxPostReset = Math.max(...sameTypePostReset.map((a) => a.moving_time || 0));
          if (activity.moving_time > maxPostReset) {
            awards.push({
              type: "comeback_endurance",
              segment: null,
              segment_id: null,
              time: null,
              power: null,
              comparison: null,
              delta: null,
              message: `Longest ${activity.sport_type === "Ride" ? "ride" : "activity"} by time since ${eventName}! ${formatTime(activity.moving_time)}`,
            });
          }
        }
      }
    }
  }

  // ── Power Trend & Milestone Awards (Phase 3, #47) ──────────────────

  if (activity.device_watts && activity.weighted_average_watts > 0) {
    // --- Watt Milestone (#47) ---
    // First ride where weighted_average_watts exceeds a threshold
    const allPoweredSameType = allActivities.filter(
      (a) =>
        a.sport_type === activity.sport_type &&
        a.device_watts &&
        a.weighted_average_watts > 0 &&
        a.id !== activity.id &&
        a.start_date_local < activity.start_date_local
    );

    for (const threshold of WATT_MILESTONES) {
      if (activity.weighted_average_watts >= threshold) {
        const anyPrior = allPoweredSameType.some(
          (a) => a.weighted_average_watts >= threshold
        );
        if (!anyPrior) {
          awards.push({
            type: "watt_milestone",
            segment: null,
            segment_id: null,
            time: null,
            power: activity.weighted_average_watts,
            comparison: null,
            delta: null,
            message: `First ride averaging ${threshold}W! Welcome to the ${threshold}W club`,
          });
          break; // Only award the highest milestone crossed for the first time
        }
      }
    }

    // --- kJ Milestone (#47) ---
    // First ride exceeding energy thresholds
    if (activity.kilojoules > 0) {
      const allPoweredWithKJ = allPoweredSameType.filter((a) => a.kilojoules > 0);
      for (const threshold of KJ_MILESTONES) {
        if (activity.kilojoules >= threshold) {
          const anyPrior = allPoweredWithKJ.some(
            (a) => a.kilojoules >= threshold
          );
          if (!anyPrior) {
            awards.push({
              type: "kj_milestone",
              segment: null,
              segment_id: null,
              time: null,
              power: activity.weighted_average_watts,
              comparison: null,
              delta: null,
              message: `First ${threshold.toLocaleString()} kJ ride — that's a massive effort!`,
            });
            break;
          }
        }
      }
    }

    // --- Power Progression (#47) ---
    // NP trending upward over last N rides (linear regression)
    const recentPowered = allActivities
      .filter(
        (a) =>
          a.sport_type === activity.sport_type &&
          a.device_watts &&
          a.weighted_average_watts > 0
      )
      .sort((a, b) => a.start_date_local.localeCompare(b.start_date_local));

    // Find this activity's position and take the window ending with it
    const actIdx = recentPowered.findIndex((a) => a.id === activity.id);
    if (actIdx >= POWER_TREND_MIN_RIDES - 1) {
      const window = recentPowered.slice(actIdx - POWER_TREND_MIN_RIDES + 1, actIdx + 1);
      const npValues = window.map((a) => a.weighted_average_watts);
      const { slope, r2 } = linearRegression(npValues);

      if (slope > 0 && r2 >= POWER_TREND_R2_THRESHOLD) {
        const totalGain = Math.round(slope * (POWER_TREND_MIN_RIDES - 1));
        awards.push({
          type: "power_progression",
          segment: null,
          segment_id: null,
          time: null,
          power: activity.weighted_average_watts,
          comparison: null,
          delta: totalGain,
          message: `Power trending up! Your NP has increased ~${totalGain}W over your last ${POWER_TREND_MIN_RIDES} rides`,
        });
      }
    }

    // --- Power Consistency (#47) ---
    // Low coefficient of variation in NP across recent rides
    if (actIdx >= POWER_TREND_MIN_RIDES - 1) {
      const window = recentPowered.slice(actIdx - POWER_TREND_MIN_RIDES + 1, actIdx + 1);
      const npValues = window.map((a) => a.weighted_average_watts);
      const mean = npValues.reduce((s, v) => s + v, 0) / npValues.length;
      const variance = npValues.reduce((s, v) => s + (v - mean) ** 2, 0) / npValues.length;
      const stddev = Math.sqrt(variance);
      const cv = stddev / mean;

      if (cv < CONSISTENCY_CV_THRESHOLD && mean > 0) {
        awards.push({
          type: "power_consistency",
          segment: null,
          segment_id: null,
          time: null,
          power: activity.weighted_average_watts,
          comparison: null,
          delta: null,
          message: `Rock solid: your last ${POWER_TREND_MIN_RIDES} rides averaged ${Math.round(mean)}W ± ${Math.round(stddev)}W. That's remarkably consistent`,
        });
      }
    }

    // --- FTP Milestone (#47) ---
    // When estimated FTP (95% of 20-min best from power_curve) crosses thresholds
    if (activity.power_curve && activity.power_curve[1200]) {
      const currentFTP = Math.round(activity.power_curve[1200] * 0.95);
      const priorWithCurves = allPoweredSameType.filter(
        (a) => a.power_curve && a.power_curve[1200]
      );
      for (const threshold of FTP_MILESTONES) {
        if (currentFTP >= threshold) {
          const anyPrior = priorWithCurves.some(
            (a) => Math.round(a.power_curve[1200] * 0.95) >= threshold
          );
          if (!anyPrior) {
            awards.push({
              type: "ftp_milestone",
              segment: null,
              segment_id: null,
              time: null,
              power: currentFTP,
              comparison: null,
              delta: null,
              message: `Estimated FTP: ${currentFTP}W — you've crossed the ${threshold}W threshold!`,
            });
            break;
          }
        }
      }
    }
  }

  // --- Power Curve Year Best & All-Time Best (#48) ---
  if (activity.power_curve) {
    const activityDate = new Date(activity.start_date_local);
    const afterCalendarGate = (activityDate.getMonth() + 1) >= YEAR_BEST_CALENDAR_GATE_MONTH;

    const allWithCurves = allActivities.filter(
      (a) =>
        a.sport_type === activity.sport_type &&
        a.power_curve &&
        a.id !== activity.id
    );

    const sameYearWithCurves = allWithCurves.filter(
      (a) => new Date(a.start_date_local).getFullYear() === currentYear
    );

    for (const dur of POWER_CURVE_DURATIONS) {
      if (!activity.power_curve[dur]) continue;

      // Year Best at this duration
      if (afterCalendarGate && sameYearWithCurves.length >= 3) {
        const priorBest = Math.max(
          0,
          ...sameYearWithCurves.map((a) => a.power_curve[dur] || 0)
        );
        if (activity.power_curve[dur] > priorBest && priorBest > 0) {
          awards.push({
            type: "curve_year_best",
            segment: null,
            segment_id: null,
            time: null,
            power: activity.power_curve[dur],
            comparison: null,
            delta: activity.power_curve[dur] - priorBest,
            message: `Year Best ${CURVE_DURATION_LABELS[dur]} power: ${activity.power_curve[dur]}W — ${activity.power_curve[dur] - priorBest}W above previous best`,
            curve_duration: dur,
          });
        }
      }

      // All-time best at this duration
      if (allWithCurves.length >= 5) {
        const allTimeBest = Math.max(
          0,
          ...allWithCurves.map((a) => a.power_curve[dur] || 0)
        );
        if (activity.power_curve[dur] > allTimeBest && allTimeBest > 0) {
          awards.push({
            type: "curve_all_time",
            segment: null,
            segment_id: null,
            time: null,
            power: activity.power_curve[dur],
            comparison: null,
            delta: activity.power_curve[dur] - allTimeBest,
            message: `All-time best ${CURVE_DURATION_LABELS[dur]} power: ${activity.power_curve[dur]}W! New personal record`,
            curve_duration: dur,
          });
        }
      }
    }
  }

  return awards;
}

/**
 * Compute awards for multiple activities.
 * Detects routes via segment fingerprinting (#59) and collapses
 * multiple segment-level Season First awards into a single route-level award
 * on the dashboard. Individual segment Season Firsts are preserved in
 * the _collapsed_season_firsts field for the activity detail view.
 *
 * @param {Array} activities — Activities with segment_efforts populated
 * @returns {Map} — Map of activity.id → awards array
 */
export async function computeAwardsForActivities(activities, disabledAwardTypes = null) {
  const resetEvent = await getResetEvent();
  const userConfig = await getUserConfig();
  const referencePoints = userConfig.referencePoints || [];
  const disabled = disabledAwardTypes || new Set(userConfig.disabledAwards || []);
  const result = new Map();

  // Detect routes from ALL activities (not just the recent subset)
  const allActivitiesForRoutes = await getAllActivities();
  const withEfforts = allActivitiesForRoutes.filter((a) => a.has_efforts);
  const stravaRoutes = await getStravaRoutes();
  const routes = detectRoutes(withEfforts, stravaRoutes);

  // Persist detected routes for future use
  if (routes.length > 0) {
    await putRoutes(routes);
  }

  for (const activity of activities) {
    const segmentAwards = await computeAwards(activity, resetEvent, referencePoints);
    const rideAwards = computeRideLevelAwards(activity, activities, resetEvent);
    let allAwards = [...segmentAwards, ...rideAwards];

    // Persist recovery milestones so they're only awarded once
    if (resetEvent) {
      for (const award of allAwards) {
        if (award._milestone_threshold != null && award._milestone_segment_id != null) {
          await recordRecoveryMilestone(award._milestone_segment_id, award._milestone_threshold);
          // Clean up internal fields
          delete award._milestone_threshold;
          delete award._milestone_segment_id;
        }
      }
    }

    // --- Route-level Season First collapse (#59) ---
    // If this activity matches a known route and has 2+ season_first awards,
    // collapse them into a single route_season_first award.
    const seasonFirsts = allAwards.filter((a) => a.type === "season_first");
    if (seasonFirsts.length >= 2) {
      const route = findRouteForActivity(activity, routes);
      if (route) {
        const nonSeasonFirsts = allAwards.filter((a) => a.type !== "season_first");
        const routeAward = {
          type: "route_season_first",
          segment: null,
          segment_id: null,
          time: null,
          power: null,
          comparison: null,
          delta: null,
          route_name: route.name,
          route_frequency: route.frequency,
          collapsed_count: seasonFirsts.length,
          _collapsed_season_firsts: seasonFirsts,
          message: `Season First on ${route.name}! First time this year on this route (${seasonFirsts.length} segments) — ${route.frequency} times total`,
        };
        allAwards = [...nonSeasonFirsts, routeAward];
      }
    }

    // Filter out disabled award types
    if (disabled.size > 0) {
      allAwards = allAwards.filter((a) => {
        if (disabled.has(a.type)) return false;
        // route_season_first is derived from season_first — disable if season_first is disabled
        if (a.type === "route_season_first" && disabled.has("season_first")) return false;
        return true;
      });
    }

    if (allAwards.length > 0) {
      result.set(activity.id, allAwards);
    }
  }
  return result;
}

// ── Streak & Consistency Awards (#58) ──────────────────────────────

/** Weekly streak tier thresholds */
const STREAK_TIERS = [4, 8, 12, 26, 52];

/** Minimum consecutive weeks for a weekly ride streak award */
const WEEKLY_STREAK_MIN = 4;

/**
 * Simple linear regression on an array of values (y values, x = 0..n-1).
 * Returns { slope, intercept, r2 }.
 */
function linearRegression(values) {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] || 0, r2: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
    sumY2 += values[i] * values[i];
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };

  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R² (coefficient of determination)
  const yMean = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (values[i] - yMean) ** 2;
    ssRes += (values[i] - (intercept + slope * i)) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  return { slope, intercept, r2 };
}

/** Haversine distance in km between two [lat, lng] coordinates */
function haversineKm(a, b) {
  if (!a || !b || a.length < 2 || b.length < 2) return Infinity;
  const R = 6371;
  const dLat = (b[0] - a[0]) * Math.PI / 180;
  const dLng = (b[1] - a[1]) * Math.PI / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Compute weekly ride streaks from all activities.
 * Returns { current, longest, mulliganUsed, streakStart, lastRideDate, danger }.
 *
 * Mulligan rule: one missed week is forgiven, but two consecutive misses
 * break the streak. An assisted streak is flagged with mulliganUsed=true.
 *
 * @param {Array} allActivities — All activities sorted by date
 * @returns {Object} Streak data
 */
export function computeWeeklyStreaks(allActivities) {
  // Filter to cycling activities only
  const rides = allActivities
    .filter((a) => a.sport_type === "Ride" || a.sport_type === "VirtualRide")
    .sort((a, b) => a.start_date_local.localeCompare(b.start_date_local));

  if (rides.length === 0) {
    return { current: 0, longest: 0, mulliganUsed: false, streakStart: null, lastRideDate: null, danger: null };
  }

  // Collect unique weeks that have rides
  const rideWeeks = new Set();
  for (const ride of rides) {
    rideWeeks.add(isoWeekKey(ride.start_date_local));
  }

  // Build sorted list of all weeks from first ride to now
  const firstRide = new Date(rides[0].start_date_local);
  const now = new Date();
  const allWeeks = [];
  const d = new Date(firstRide);
  // Move to Monday of first ride's week
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  while (d <= now) {
    allWeeks.push(isoWeekKey(d.toISOString()));
    d.setDate(d.getDate() + 7);
  }

  // Compute streaks with mulligan support
  let currentStreak = 0;
  let currentMulligan = false;
  let currentStart = null;
  let longestStreak = 0;
  let longestMulligan = false;
  let longestStart = null;
  let consecutiveMisses = 0;

  for (let i = 0; i < allWeeks.length; i++) {
    const week = allWeeks[i];
    if (rideWeeks.has(week)) {
      if (currentStreak === 0) {
        currentStart = week;
        currentMulligan = false;
      }
      currentStreak++;
      consecutiveMisses = 0;
    } else {
      consecutiveMisses++;
      if (consecutiveMisses === 1 && currentStreak > 0 && !currentMulligan) {
        // First miss — use mulligan (one per streak)
        currentStreak++;
        currentMulligan = true;
      } else {
        // Two consecutive misses or no active streak — break
        if (currentStreak > longestStreak) {
          longestStreak = currentStreak;
          longestMulligan = currentMulligan;
          longestStart = currentStart;
        }
        currentStreak = 0;
        currentMulligan = false;
        currentStart = null;
        consecutiveMisses = 0;
      }
    }
  }
  if (currentStreak > longestStreak) {
    longestStreak = currentStreak;
    longestMulligan = currentMulligan;
    longestStart = currentStart;
  }

  // Determine danger state for current streak
  const currentWeek = isoWeekKey(now.toISOString());
  const thisWeekHasRide = rideWeeks.has(currentWeek);
  let danger = null;
  if (currentStreak >= WEEKLY_STREAK_MIN && !thisWeekHasRide) {
    danger = currentMulligan
      ? { level: "critical", message: `You used your mulligan last week — ride this week to keep your ${currentStreak}-week streak alive!` }
      : { level: "warning", message: `Your ${currentStreak}-week streak is in danger! Get out there this week.` };
  }

  // Find highest tier reached by current streak
  const tier = STREAK_TIERS.filter((t) => currentStreak >= t).pop() || 0;

  const lastRideDate = rides[rides.length - 1].start_date_local;

  return {
    current: currentStreak,
    longest: longestStreak,
    mulliganUsed: currentMulligan,
    streakStart: currentStart,
    lastRideDate,
    danger,
    tier,
  };
}

/**
 * Detect recurring group rides by clustering activities by:
 *   1. Day of week
 *   2. Similar start time (±90min)
 *   3. Similar start location (within 1km)
 *   4. Route similarity (segment fingerprint via detected routes)
 *
 * @param {Array} allActivities — All activities
 * @param {Array} routes — Detected routes from detectRoutes()
 * @returns {Array} Detected group rides with attendance data
 */
export function detectGroupRides(allActivities, routes = []) {
  const rides = allActivities
    .filter((a) => (a.sport_type === "Ride" || a.sport_type === "VirtualRide") && a.has_efforts)
    .sort((a, b) => a.start_date_local.localeCompare(b.start_date_local));

  if (rides.length < 4) return [];

  // Pre-compute route membership for each activity
  const activityRouteMap = new Map(); // activityId -> route
  if (routes.length > 0) {
    for (const ride of rides) {
      const route = findRouteForActivity(ride, routes);
      if (route) activityRouteMap.set(ride.id, route);
    }
  }

  // Group rides by day-of-week
  const byDow = {};
  for (const ride of rides) {
    const d = new Date(ride.start_date_local);
    const dow = d.getDay(); // 0=Sun..6=Sat
    if (!byDow[dow]) byDow[dow] = [];
    byDow[dow].push(ride);
  }

  const groups = [];

  for (const [dow, dowRides] of Object.entries(byDow)) {
    if (dowRides.length < 3) continue;

    // Phase 1: Cluster by start time and location
    const timeClusters = [];
    for (const ride of dowRides) {
      const rideTime = new Date(ride.start_date_local);
      const minuteOfDay = rideTime.getHours() * 60 + rideTime.getMinutes();
      const latlng = ride.start_latlng || null;

      let matched = false;
      for (const cluster of timeClusters) {
        const timeDiff = Math.abs(cluster.avgMinute - minuteOfDay);
        if (timeDiff > 90) continue;

        if (cluster.latlng && latlng) {
          const dist = haversineKm(cluster.latlng, latlng);
          if (dist > 1) continue;
        }

        cluster.rides.push(ride);
        cluster.avgMinute = Math.round(
          cluster.rides.reduce((sum, r) => {
            const t = new Date(r.start_date_local);
            return sum + t.getHours() * 60 + t.getMinutes();
          }, 0) / cluster.rides.length
        );
        matched = true;
        break;
      }

      if (!matched) {
        timeClusters.push({
          rides: [ride],
          avgMinute: minuteOfDay,
          latlng,
          dow: parseInt(dow),
        });
      }
    }

    // Phase 2: Sub-cluster each time/location cluster by route
    for (const cluster of timeClusters) {
      if (cluster.rides.length < 3) continue;

      const subClusters = splitByRoute(cluster.rides, activityRouteMap);

      for (const sub of subClusters) {
        if (sub.rides.length < 3) continue;

        const subAvgMinute = Math.round(
          sub.rides.reduce((sum, r) => {
            const t = new Date(r.start_date_local);
            return sum + t.getHours() * 60 + t.getMinutes();
          }, 0) / sub.rides.length
        );

        // Name: use route name if this sub-cluster has one, else fall back to activity names
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        let groupName;
        if (sub.route) {
          groupName = sub.route.name;
        } else {
          const nameCounts = {};
          for (const r of sub.rides) {
            const normalized = r.name
              .replace(/\d{1,2}\/\d{1,2}(\/\d{2,4})?/g, "")
              .replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/gi, "")
              .replace(/\b\d{1,4}\b/g, "")
              .trim();
            if (normalized.length > 2) {
              nameCounts[normalized] = (nameCounts[normalized] || 0) + 1;
            }
          }
          const topName = Object.entries(nameCounts).sort((a, b) => b[1] - a[1])[0];
          if (topName && topName[1] >= 2) {
            groupName = topName[0];
          } else {
            const h = Math.floor(subAvgMinute / 60);
            const period = h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
            groupName = `${dayNames[cluster.dow]} ${period} Ride`;
          }
        }

        const groupCount = sub.rides.filter((r) => (r.athlete_count || 1) > 1).length;
        const isGroupRide = groupCount > sub.rides.length * 0.5;

        const rideWeeks = sub.rides.map((r) => isoWeekKey(r.start_date_local));
        const uniqueWeeks = [...new Set(rideWeeks)].sort();

        let attendanceStreak = 0;
        let attendanceMulligan = false;
        if (uniqueWeeks.length >= 2) {
          const now = new Date();
          let misses = 0;

          const weekSet = new Set(uniqueWeeks);
          const checkDate = new Date(now);
          checkDate.setDate(checkDate.getDate() - ((checkDate.getDay() + 6) % 7));

          for (let i = 0; i < 52; i++) {
            const wk = isoWeekKey(checkDate.toISOString());
            if (weekSet.has(wk)) {
              attendanceStreak++;
              misses = 0;
            } else {
              misses++;
              if (misses === 1 && attendanceStreak > 0 && !attendanceMulligan) {
                attendanceStreak++;
                attendanceMulligan = true;
              } else {
                break;
              }
            }
            checkDate.setDate(checkDate.getDate() - 7);
          }
        }

        groups.push({
          name: groupName,
          dow: cluster.dow,
          avgMinute: subAvgMinute,
          totalRides: sub.rides.length,
          isGroupRide,
          attendanceStreak,
          attendanceMulligan,
          lastRideDate: sub.rides[sub.rides.length - 1].start_date_local,
          rides: sub.rides.map((r) => ({ id: r.id, date: r.start_date_local, name: r.name, average_speed: r.average_speed || null, average_watts: r.average_watts || null })),
        });
      }
    }
  }

  // Merge groups that share the same name AND day-of-week (route variants)
  const merged = [];
  const mergeIndex = new Map(); // "name|dow" -> index in merged[]
  for (const g of groups) {
    const key = `${g.name}|${g.dow}`;
    if (mergeIndex.has(key)) {
      const existing = merged[mergeIndex.get(key)];
      existing.rides.push(...g.rides);
      existing.rides.sort((a, b) => a.date.localeCompare(b.date));
      existing.totalRides += g.totalRides;
      existing.attendanceStreak = Math.max(existing.attendanceStreak, g.attendanceStreak);
      existing.attendanceMulligan = existing.attendanceMulligan || g.attendanceMulligan;
      if (g.lastRideDate > existing.lastRideDate) {
        existing.lastRideDate = g.lastRideDate;
      }
      existing.isGroupRide = existing.isGroupRide || g.isGroupRide;
    } else {
      mergeIndex.set(key, merged.length);
      merged.push({ ...g, rides: [...g.rides] });
    }
  }

  // Sort by total rides descending
  merged.sort((a, b) => b.totalRides - a.totalRides);
  return merged;
}

/**
 * Split a set of rides into sub-clusters by route.
 * Rides on the same detected route go together.
 * Rides with no detected route go into a catch-all bucket.
 */
function splitByRoute(rides, activityRouteMap) {
  const byRouteId = new Map(); // routeId -> { route, rides }
  const noRoute = [];

  for (const ride of rides) {
    const route = activityRouteMap.get(ride.id);
    if (route) {
      if (!byRouteId.has(route.id)) {
        byRouteId.set(route.id, { route, rides: [] });
      }
      byRouteId.get(route.id).rides.push(ride);
    } else {
      noRoute.push(ride);
    }
  }

  const result = [];
  for (const { route, rides: routeRides } of byRouteId.values()) {
    result.push({ route, rides: routeRides });
  }
  // No-route rides still form a group if there are enough of them
  if (noRoute.length > 0) {
    result.push({ route: null, rides: noRoute });
  }
  return result;
}

/**
 * Compute all streak and consistency data for the dashboard.
 * Called once from loadDashboard, not per-activity.
 *
 * @param {Array} allActivities — All activities from IndexedDB
 * @returns {Object} { weeklyStreak, groupRides }
 */
export function computeStreakData(allActivities, routes = []) {
  const weeklyStreak = computeWeeklyStreaks(allActivities);
  const groupRides = detectGroupRides(allActivities, routes);
  return { weeklyStreak, groupRides };
}
