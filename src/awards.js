/**
 * Participation Awards — Awards Engine (MVP: Temporal Windows)
 * Runs entirely client-side against IndexedDB data.
 *
 * Award types:
 *   - Year Best (YB): Fastest effort on a segment this calendar year
 *   - Season First: First effort on a segment this calendar year
 *   - Recent Best: Best time among last 5 attempts (requires 3+ history)
 */

import { getSegment } from "./db.js";

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
    const thisYearEfforts = allEfforts.filter(
      (e) => new Date(e.start_date_local).getFullYear() === currentYear
    );

    // --- Season First ---
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

    // --- Year Best ---
    if (thisYearEfforts.length > 1) {
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

    // --- Recent Best ---
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
