/**
 * Route Detection via Segment Fingerprinting (#59)
 *
 * Two-phase algorithm:
 * 1. Seed routes from Strava-saved routes (fixed fingerprints)
 * 2. Assign activities via hybrid similarity (Jaccard OR containment)
 *
 * Strava-seeded routes keep their segment fingerprint fixed.
 * Discovered routes grow by union (capped at 2x initial size).
 */

/** Minimum Jaccard similarity to consider two activities the same route */
const JACCARD_THRESHOLD = 0.7;

/** Minimum containment to match (fraction of route's segments present in activity) */
const CONTAINMENT_THRESHOLD = 0.8;

/** Minimum segments an activity must have to participate in route detection */
const MIN_SEGMENTS_FOR_ROUTE = 2;

/** Max growth factor for discovered route segment sets */
const MAX_GROWTH_FACTOR = 2;

/**
 * Compute Jaccard similarity between two sets.
 * J(A,B) = |A ∩ B| / |A ∪ B|
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
 * Compute containment of route in activity.
 * What fraction of the route's segments appear in the activity?
 * containment(activity, route) = |A ∩ R| / |R|
 */
function containment(activitySet, routeSet) {
  if (routeSet.size === 0) return 0;
  let intersection = 0;
  for (const item of routeSet) {
    if (activitySet.has(item)) intersection++;
  }
  return intersection / routeSet.size;
}

/**
 * Check if activity matches route using hybrid similarity:
 * match if Jaccard >= threshold OR containment >= threshold.
 * Returns the better of the two scores for ranking.
 */
function hybridSimilarity(activitySet, routeSet) {
  const j = jaccard(activitySet, routeSet);
  const c = containment(activitySet, routeSet);
  const matches = j >= JACCARD_THRESHOLD || c >= CONTAINMENT_THRESHOLD;
  return { matches, score: Math.max(j, c) };
}

/**
 * Extract segment ID set from an activity.
 */
function segmentIds(activity) {
  if (!activity.segment_efforts || activity.segment_efforts.length < MIN_SEGMENTS_FOR_ROUTE) {
    return new Set();
  }
  return new Set(activity.segment_efforts.map((e) => e.segment.id));
}

/**
 * Detect routes from activities by clustering on segment fingerprints.
 *
 * Phase 1: Seed from Strava-saved routes (fixed fingerprints)
 * Phase 2: Assign activities (Strava-seeded first, then discovered)
 * Phase 3: Finalize names and filter
 *
 * @param {Array} activities — All activities (must have segment_efforts populated)
 * @param {Array} [stravaRoutes=[]] — Strava-saved routes with { name, segments: [id,...], strava_id }
 * @returns {Array<{ id: number, segments: number[], activityIds: number[], name: string, strava_route_name: string|null, strava_id: number|null, frequency: number }>}
 */
export function detectRoutes(activities, stravaRoutes = []) {
  // Phase 1: Seed from Strava routes
  const routes = [];
  for (const sr of stravaRoutes) {
    if (!sr.segments || sr.segments.length === 0) continue;
    routes.push({
      segments: new Set(sr.segments),
      initialSize: sr.segments.length,
      activityIds: [],
      names: new Map(),
      isStravaSeeded: true,
      strava_id: sr.strava_id || sr.id || null,
      strava_name: sr.name || null,
    });
  }

  // Phase 2: Assign activities (oldest-first for stable cluster formation)
  const sorted = [...activities].sort((a, b) =>
    (a.start_date_local || "").localeCompare(b.start_date_local || "")
  );

  for (const activity of sorted) {
    const ids = segmentIds(activity);
    if (ids.size === 0) continue;

    let matched = null;
    let bestScore = 0;

    // Check Strava-seeded routes first, then discovered
    for (const route of routes) {
      const { matches, score } = hybridSimilarity(ids, route.segments);
      if (matches && score > bestScore) {
        bestScore = score;
        matched = route;
      }
    }

    if (matched) {
      matched.activityIds.push(activity.id);
      const name = activity.name || "";
      matched.names.set(name, (matched.names.get(name) || 0) + 1);
      // Discovered routes grow by union (capped); Strava-seeded stay fixed
      if (!matched.isStravaSeeded && matched.segments.size < matched.initialSize * MAX_GROWTH_FACTOR) {
        for (const id of ids) matched.segments.add(id);
      }
    } else {
      // New discovered route
      const name = activity.name || "";
      const names = new Map();
      names.set(name, 1);
      routes.push({
        segments: new Set(ids),
        initialSize: ids.size,
        activityIds: [activity.id],
        names,
        isStravaSeeded: false,
        strava_id: null,
        strava_name: null,
      });
    }
  }

  // Phase 3: Filter and finalize
  // Strava-seeded routes: keep with 1+ activities
  // Discovered routes: keep with 2+ activities
  const meaningful = routes.filter((r) =>
    r.isStravaSeeded ? r.activityIds.length >= 1 : r.activityIds.length >= 2
  );

  return meaningful.map((r, i) => {
    let bestName;
    if (r.isStravaSeeded && r.strava_name) {
      bestName = r.strava_name;
    } else {
      bestName = "";
      let bestCount = 0;
      for (const [name, count] of r.names) {
        if (count > bestCount) {
          bestCount = count;
          bestName = name;
        }
      }
    }

    return {
      id: i + 1,
      segments: [...r.segments],
      activityIds: r.activityIds,
      name: bestName,
      strava_route_name: r.strava_name || null,
      strava_id: r.strava_id,
      frequency: r.activityIds.length,
    };
  });
}

/**
 * Find the route that an activity belongs to.
 * Uses hybrid similarity (Jaccard OR containment).
 */
export function findRouteForActivity(activity, routes) {
  const ids = segmentIds(activity);
  if (ids.size === 0) return null;

  let best = null;
  let bestScore = 0;

  for (const route of routes) {
    const routeSet = new Set(route.segments);
    const { matches, score } = hybridSimilarity(ids, routeSet);
    if (matches && score > bestScore) {
      bestScore = score;
      best = route;
    }
  }

  return best;
}
