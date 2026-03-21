/**
 * Route Detection via Segment Fingerprinting (#59)
 *
 * Two-gate matching: distance gate (±30%) then Jaccard similarity.
 * Containment was removed — it's one-directional and caused short rides
 * to match long routes when they shared a subset of segments.
 *
 * Strava-seeded routes keep their segment fingerprint fixed.
 * Discovered routes grow by union (capped at 1.3x initial size).
 */

const DISTANCE_TOLERANCE = 0.30;
const JACCARD_THRESHOLD = 0.50;
const MIN_SEGMENTS_FOR_ROUTE = 2;
const MAX_SEGMENT_GROWTH = 1.3;

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function medianDistance(distances) {
  if (!distances || distances.length === 0) return 0;
  const sorted = [...distances].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function distanceMatch(activityDistance, routeDistance) {
  if (!routeDistance || !activityDistance) return true;
  const ratio = activityDistance / routeDistance;
  return ratio >= (1 - DISTANCE_TOLERANCE) && ratio <= (1 + DISTANCE_TOLERANCE);
}

function segmentIds(activity) {
  if (!activity.segment_efforts || activity.segment_efforts.length < MIN_SEGMENTS_FOR_ROUTE) {
    return new Set();
  }
  return new Set(activity.segment_efforts.map((e) => e.segment.id));
}

/**
 * Detect routes from activities by clustering on segment fingerprints.
 *
 * Phase 1: Seed from Strava-saved routes (fixed fingerprints, known distance)
 * Phase 2: Assign activities via distance gate + Jaccard similarity
 * Phase 3: Finalize names and filter
 *
 * @param {Array} activities — All activities (must have segment_efforts populated)
 * @param {Array} [stravaRoutes=[]] — Strava-saved routes with { name, segments, distance, strava_id }
 * @returns {Array<{ id, segments, activityIds, name, distance, strava_route_name, strava_id, frequency }>}
 */
export function detectRoutes(activities, stravaRoutes = []) {
  const routes = [];
  for (const sr of stravaRoutes) {
    if (!sr.segments || sr.segments.length === 0) continue;
    routes.push({
      segments: new Set(sr.segments),
      initialSize: sr.segments.length,
      distance: sr.distance || 0,
      distances: [],
      activityIds: [],
      names: new Map(),
      isStravaSeeded: true,
      strava_id: sr.strava_id || sr.id || null,
      strava_name: sr.name || null,
    });
  }

  const sorted = [...activities].sort((a, b) =>
    (a.start_date_local || "").localeCompare(b.start_date_local || "")
  );

  for (const activity of sorted) {
    const ids = segmentIds(activity);
    if (ids.size === 0) continue;

    let matched = null;
    let bestScore = 0;

    for (const route of routes) {
      const routeDistance = route.isStravaSeeded
        ? route.distance
        : medianDistance(route.distances);

      if (!distanceMatch(activity.distance, routeDistance)) continue;

      const j = jaccard(ids, route.segments);
      if (j >= JACCARD_THRESHOLD && j > bestScore) {
        bestScore = j;
        matched = route;
      }
    }

    if (matched) {
      matched.activityIds.push(activity.id);
      matched.distances.push(activity.distance);
      const name = activity.name || "";
      matched.names.set(name, (matched.names.get(name) || 0) + 1);
      if (!matched.isStravaSeeded && matched.segments.size < matched.initialSize * MAX_SEGMENT_GROWTH) {
        for (const id of ids) matched.segments.add(id);
      }
    } else {
      const name = activity.name || "";
      const names = new Map();
      names.set(name, 1);
      routes.push({
        segments: new Set(ids),
        initialSize: ids.size,
        distance: activity.distance || 0,
        distances: [activity.distance || 0],
        activityIds: [activity.id],
        names,
        isStravaSeeded: false,
        strava_id: null,
        strava_name: null,
      });
    }
  }

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
      distance: r.isStravaSeeded ? r.distance : medianDistance(r.distances),
      strava_route_name: r.strava_name || null,
      strava_id: r.strava_id,
      frequency: r.activityIds.length,
    };
  });
}

/**
 * Find the route that an activity belongs to.
 * Uses distance gate + Jaccard similarity.
 */
export function findRouteForActivity(activity, routes) {
  const ids = segmentIds(activity);
  if (ids.size === 0) return null;

  let best = null;
  let bestScore = 0;

  for (const route of routes) {
    const routeSet = new Set(route.segments);
    if (!distanceMatch(activity.distance, route.distance || 0)) continue;

    const j = jaccard(ids, routeSet);
    if (j >= JACCARD_THRESHOLD && j > bestScore) {
      bestScore = j;
      best = route;
    }
  }

  return best;
}
