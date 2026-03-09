/**
 * Route Detection via Segment Fingerprinting (#59)
 *
 * Groups activities into "routes" by comparing their segment ID sets
 * using Jaccard similarity. Activities sharing ≥70% of their segments
 * are considered the same route.
 *
 * Excludes activities with fewer than 2 segments (too few to fingerprint).
 */

/** Minimum Jaccard similarity to consider two activities the same route */
const JACCARD_THRESHOLD = 0.7;

/** Minimum segments an activity must have to participate in route detection */
const MIN_SEGMENTS_FOR_ROUTE = 2;

/**
 * Compute Jaccard similarity between two sets.
 * J(A,B) = |A ∩ B| / |A ∪ B|
 * @param {Set} a
 * @param {Set} b
 * @returns {number} 0–1
 */
function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Extract segment ID set from an activity.
 * @param {Object} activity
 * @returns {Set<number>} segment IDs
 */
function segmentIds(activity) {
  if (!activity.segment_efforts || activity.segment_efforts.length < MIN_SEGMENTS_FOR_ROUTE) {
    return new Set();
  }
  return new Set(activity.segment_efforts.map((e) => e.segment.id));
}

/**
 * Detect routes from a list of activities by clustering on segment fingerprints.
 *
 * Algorithm: greedy single-pass clustering.
 * For each activity, compare its segment set against existing route fingerprints.
 * If Jaccard ≥ threshold with a route, merge into that route (union the fingerprint).
 * Otherwise, create a new route.
 *
 * @param {Array} activities — All activities (must have segment_efforts populated)
 * @returns {Array<{ id: number, segments: number[], activityIds: number[], name: string, frequency: number }>}
 */
export function detectRoutes(activities) {
  const routes = []; // { segments: Set, activityIds: [], names: Map<string, count> }

  for (const activity of activities) {
    const ids = segmentIds(activity);
    if (ids.size === 0) continue;

    let matched = null;
    let bestSimilarity = 0;

    for (const route of routes) {
      const sim = jaccard(ids, route.segments);
      if (sim >= JACCARD_THRESHOLD && sim > bestSimilarity) {
        bestSimilarity = sim;
        matched = route;
      }
    }

    if (matched) {
      // Merge: add activity, union segments
      matched.activityIds.push(activity.id);
      for (const id of ids) matched.segments.add(id);
      const name = activity.name || "";
      matched.names.set(name, (matched.names.get(name) || 0) + 1);
    } else {
      // New route
      const name = activity.name || "";
      const names = new Map();
      names.set(name, 1);
      routes.push({
        segments: new Set(ids),
        activityIds: [activity.id],
        names,
      });
    }
  }

  // Only keep routes with 2+ activities (a single activity isn't really a "route")
  const meaningful = routes.filter((r) => r.activityIds.length >= 2);

  // Finalize: pick best name, assign IDs
  return meaningful.map((r, i) => {
    // Most frequent activity name becomes route name
    let bestName = "";
    let bestCount = 0;
    for (const [name, count] of r.names) {
      if (count > bestCount) {
        bestCount = count;
        bestName = name;
      }
    }

    return {
      id: i + 1,
      segments: [...r.segments],
      activityIds: r.activityIds,
      name: bestName,
      frequency: r.activityIds.length,
    };
  });
}

/**
 * Find the route that an activity belongs to.
 * @param {Object} activity — Activity with segment_efforts
 * @param {Array} routes — Routes from detectRoutes()
 * @returns {Object|null} — Matching route, or null
 */
export function findRouteForActivity(activity, routes) {
  const ids = segmentIds(activity);
  if (ids.size === 0) return null;

  let best = null;
  let bestSim = 0;

  for (const route of routes) {
    const routeSet = new Set(route.segments);
    const sim = jaccard(ids, routeSet);
    if (sim >= JACCARD_THRESHOLD && sim > bestSim) {
      bestSim = sim;
      best = route;
    }
  }

  return best;
}
