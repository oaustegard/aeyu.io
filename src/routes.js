/**
 * Route Detection via Segment Fingerprinting (#59)
 *
 * Two-gate matching: distance gate (±30%) then Jaccard similarity.
 * Containment was removed for activity→route matching — it's one-directional
 * and caused short rides to match long routes when they shared a subset of
 * segments.
 *
 * Strava-saved routes are matched to discovered clusters post-hoc using
 * containment (Strava segments ⊆ cluster segments) + distance gate.
 * The Strava API only returns a subset of a route's segments (~25 of 50+),
 * so Jaccard fails when seeding directly. Containment is safe here because
 * the Strava route is always the smaller set and we're checking if it fits
 * inside a larger organic cluster — the opposite of the problematic direction.
 *
 * All route fingerprints are frozen after initial formation.
 * Discovered routes use the segments from the first activity that seeds them.
 */

const DISTANCE_TOLERANCE = 0.30;
const JACCARD_THRESHOLD = 0.50;
const MIN_SEGMENTS_FOR_ROUTE = 2;
const STRAVA_CONTAINMENT_THRESHOLD = 0.70;

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
 * What fraction of set `small` is contained in set `large`?
 * Returns intersection / |small|.
 */
function containment(small, large) {
  if (small.size === 0) return 0;
  let intersection = 0;
  for (const item of small) {
    if (large.has(item)) intersection++;
  }
  return intersection / small.size;
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
  if (!routeDistance || !activityDistance) {
    console.warn('[routes] missing distance data — skipping match', { activityDistance, routeDistance });
    return false;
  }
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
 * Phase 1: Organic clustering — group activities by segment overlap
 * Phase 2: Adopt Strava names — match saved routes to clusters via containment
 * Phase 3: Finalize names and filter
 *
 * @param {Array} activities — All activities (must have segment_efforts populated)
 * @param {Array} [stravaRoutes=[]] — Strava-saved routes with { name, segments, distance, strava_id }
 * @returns {Array<{ id, segments, activityIds, name, distance, strava_route_name, strava_id, frequency }>}
 */
export function detectRoutes(activities, stravaRoutes = []) {
  // --- Phase 1: Organic clustering (no Strava seeding) ---
  const routes = [];

  const sorted = [...activities].sort((a, b) =>
    (a.start_date_local || "").localeCompare(b.start_date_local || "")
  );

  for (const activity of sorted) {
    if (activity.sport_type === 'VirtualRide') continue;
    const ids = segmentIds(activity);
    if (ids.size === 0) continue;

    let matched = null;
    let bestScore = 0;

    for (const route of routes) {
      const routeDistance = medianDistance(route.distances);

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
    } else {
      const name = activity.name || "";
      const names = new Map();
      names.set(name, 1);
      routes.push({
        segments: new Set(ids),
        distance: activity.distance || 0,
        distances: [activity.distance || 0],
        activityIds: [activity.id],
        names,
        strava_id: null,
        strava_name: null,
      });
    }
  }

  // --- Phase 2: Adopt Strava route names via containment ---
  // The Strava API returns only a subset of a route's segments, so Jaccard
  // between the partial Strava set and the full organic cluster fails.
  // Instead: check if the Strava route's (partial) segments are mostly
  // contained within a cluster's (full) segment set + distance gate.
  for (const sr of stravaRoutes) {
    if (!sr.segments || sr.segments.length === 0) continue;
    const stravaSegs = new Set(sr.segments);

    let bestCluster = null;
    let bestContainment = 0;

    for (const route of routes) {
      if (route.strava_id) continue; // already claimed by another Strava route

      const routeDistance = medianDistance(route.distances);
      if (sr.distance && !distanceMatch(sr.distance, routeDistance)) continue;

      const c = containment(stravaSegs, route.segments);
      if (c >= STRAVA_CONTAINMENT_THRESHOLD && c > bestContainment) {
        bestContainment = c;
        bestCluster = route;
      }
    }

    if (bestCluster) {
      bestCluster.strava_id = sr.strava_id || sr.id || null;
      bestCluster.strava_name = sr.name || null;
    }
  }

  // --- Phase 3: Finalize ---
  const meaningful = routes.filter((r) => r.activityIds.length >= 2);

  return meaningful.map((r, i) => {
    // Prefer Strava name when available, fall back to most common activity name
    let bestName;
    if (r.strava_name) {
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
      distance: medianDistance(r.distances),
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
  if (activity.sport_type === 'VirtualRide') return null;
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
