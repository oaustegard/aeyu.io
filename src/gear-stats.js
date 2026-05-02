/**
 * Pure aggregation functions for gear-level stats and awards.
 *
 * No IndexedDB dependencies — operates on data passed in. Caller is
 * responsible for fetching activities + gears (typically from the
 * existing IndexedDB stores) and feeding them through.
 *
 * Companion to src/awards.js (segment- and ride-level awards). Gear
 * awards are a separate axis: per-bike totals across the whole history.
 */

const CYCLING_TYPES = new Set([
  'Ride', 'VirtualRide', 'EBikeRide', 'GravelRide', 'MountainBikeRide',
]);

const METERS_PER_MILE = 1609.344;
const SECONDS_PER_HOUR = 3600;

const UNASSIGNED_KEY = '__unassigned__';

/**
 * @typedef {Object} BikeStat
 * @property {string|null} gear_id
 * @property {string} name
 * @property {string|null} brand_name
 * @property {string|null} model_name
 * @property {boolean} retired
 * @property {number} moving_seconds  - sum of moving_time across rides (s)
 * @property {number} distance_meters - sum of distance across rides (m)
 * @property {number} elevation_meters - sum of total_elevation_gain (m)
 * @property {number} rides           - count of cycling activities
 * @property {string|null} first_used - ISO date of earliest ride
 * @property {string|null} last_used  - ISO date of latest ride
 * @property {number} hours           - convenience: moving_seconds / 3600
 * @property {number} miles           - convenience: distance_meters / 1609.344
 */

/**
 * Aggregate cycling activities by gear.
 *
 * Cycling-only: filters out Run, Swim, Walk, etc. by `type`. Activities
 * without a `gear_id` are bucketed under an "Unassigned" pseudo-bike
 * (gear_id: null) so the caller can show users what's slipping through.
 *
 * @param {Array} activities
 * @param {Array} gears
 * @returns {Array<BikeStat>} sorted by moving_seconds desc
 */
export function bikeStats(activities, gears) {
  const gearById = new Map((gears || []).map(g => [g.id, g]));
  const buckets = new Map();

  for (const a of activities || []) {
    if (!CYCLING_TYPES.has(a?.type)) continue;

    const gearId = a.gear_id || null;
    const key = gearId || UNASSIGNED_KEY;

    let b = buckets.get(key);
    if (!b) {
      const g = gearId ? gearById.get(gearId) : null;
      const name = gearId
        ? (g?.name || `Unknown gear ${gearId}`)
        : 'Unassigned';
      b = {
        gear_id: gearId,
        name,
        brand_name: g?.brand_name ?? null,
        model_name: g?.model_name ?? null,
        retired: g?.retired ?? false,
        moving_seconds: 0,
        distance_meters: 0,
        elevation_meters: 0,
        rides: 0,
        first_used: null,
        last_used: null,
      };
      buckets.set(key, b);
    }

    b.moving_seconds   += a.moving_time           || 0;
    b.distance_meters  += a.distance              || 0;
    b.elevation_meters += a.total_elevation_gain  || 0;
    b.rides            += 1;

    const date = a.start_date_local || a.start_date || null;
    if (date) {
      if (!b.first_used || date < b.first_used) b.first_used = date;
      if (!b.last_used  || date > b.last_used)  b.last_used  = date;
    }
  }

  return Array.from(buckets.values())
    .map(b => ({
      ...b,
      hours: b.moving_seconds / SECONDS_PER_HOUR,
      miles: b.distance_meters / METERS_PER_MILE,
    }))
    .sort((x, y) => y.moving_seconds - x.moving_seconds);
}

/**
 * @typedef {Object} GearAward
 * @property {string} type    - one of: gear_workhorse, gear_long_hauler,
 *                              gear_daily_driver, gear_climber
 * @property {string} gear_id
 * @property {string} name
 * @property {number} value   - the metric the award was won on
 */

/**
 * Compute totals-based gear awards from BikeStat array.
 *
 * Currently issued (one award per category, ties broken alphabetically
 * by name):
 *   - gear_workhorse:    most moving_seconds
 *   - gear_long_hauler:  most distance_meters
 *   - gear_daily_driver: most rides
 *   - gear_climber:      most elevation_meters
 *
 * Skipped:
 *   - Categories where the best value is zero (no climber on flat-only
 *     fleet; no workhorse if all bikes have 0 moving time).
 *   - The "Unassigned" pseudo-bike — never wins; it's a data-quality
 *     bucket, not a real piece of gear.
 *
 * @param {Array<BikeStat>} stats
 * @returns {Array<GearAward>}
 */
export function gearAwards(stats) {
  const candidates = (stats || []).filter(b => b.rides > 0 && b.gear_id);
  if (candidates.length === 0) return [];

  const winnerOf = (key) => {
    let best = null;
    for (const b of candidates) {
      if (best === null
          || b[key] > best[key]
          || (b[key] === best[key] && b.name < best.name)) {
        best = b;
      }
    }
    return best;
  };

  const awards = [];
  const issue = (type, key) => {
    const w = winnerOf(key);
    if (w && w[key] > 0) {
      awards.push({ type, gear_id: w.gear_id, name: w.name, value: w[key] });
    }
  };

  issue('gear_workhorse',    'moving_seconds');
  issue('gear_long_hauler',  'distance_meters');
  issue('gear_daily_driver', 'rides');
  issue('gear_climber',      'elevation_meters');

  return awards;
}
