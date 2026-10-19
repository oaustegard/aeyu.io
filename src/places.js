/**
 * Place labels for the heatmap. Places come from GeoNames (populated places
 * of 5,000+, CC BY 4.0) pre-split into 10°×10° tiles under /geo/cities/, so
 * only the tiles a rider's tracks touch are fetched, from this origin.
 * A place is labelled only if some ride passes near it.
 */

import { matchesFilter } from "./heatmap.js";

const NEAR_M = 2500;
const EARTH_M = 40075016;

export function unproject(x, y) {
  const lng = x * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
  return [lat, lng];
}

function project(lat, lng) {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

/** Tile keys ("lat_lng" of the south-west corner) covering every track bbox. */
export function tilesForTracks(meta, origin) {
  const keys = new Set();
  for (const m of meta) {
    const [latA, lngA] = unproject(m.bbox[0] + origin[0], m.bbox[3] + origin[1]);
    const [latB, lngB] = unproject(m.bbox[2] + origin[0], m.bbox[1] + origin[1]);
    for (let la = Math.floor(latA / 10) * 10; la <= Math.floor(latB / 10) * 10; la += 10) {
      for (let ln = Math.floor(lngA / 10) * 10; ln <= Math.floor(lngB / 10) * 10; ln += 10) {
        keys.add(`${la}_${ln}`);
      }
    }
  }
  return [...keys];
}

/**
 * Keep places within NEAR_M of a ride's bounding box, each with the indices
 * of the rides near it so filters and playback can count them per frame.
 * @param {Array} rows  [name, lat, lng, population] from the tiles
 */
export function placesNearTracks(rows, meta, origin) {
  const out = [];
  for (const [name, lat, lng, pop] of rows) {
    const [px, py] = project(lat, lng);
    const x = px - origin[0], y = py - origin[1];
    const margin = NEAR_M / (EARTH_M * Math.cos((lat * Math.PI) / 180));
    const rides = [];
    meta.forEach((m, i) => {
      if (x >= m.bbox[0] - margin && x <= m.bbox[2] + margin && y >= m.bbox[1] - margin && y <= m.bbox[3] + margin) rides.push(i);
    });
    if (rides.length) out.push({ name, x, y, pop, rides });
  }
  return out;
}

export async function loadPlaces(meta, origin, fetchFn = fetch) {
  const rows = [];
  await Promise.all(tilesForTracks(meta, origin).map(async (k) => {
    try {
      const r = await fetchFn(`/geo/cities/${k}.json`);
      if (r.ok) rows.push(...(await r.json()));
    } catch (e) {
      console.warn(`Place tile ${k} failed:`, e.message);
    }
  }));
  return placesNearTracks(rows, meta, origin);
}

/** Rides near each place that pass the filter (and, in playback, have happened). */
export function placeCounts(places, meta, filter, playhead = null) {
  return places.map((p) => {
    let c = 0;
    for (const i of p.rides) {
      const m = meta[i];
      if (playhead != null && m.day > playhead) continue;
      if (matchesFilter(m, filter)) c++;
    }
    return c;
  });
}

/**
 * Greedy label placement: most-ridden (then most populous) first, skipping
 * any label that would overlap one already placed. Zooming in frees room,
 * so smaller places appear on their own.
 */
export function layoutLabels(places, counts, view, width, height, measure, { max = 40, pad = 0, reserved = [] } = {}) {
  const order = places
    .map((p, i) => ({ p, c: counts[i] }))
    .filter((e) => e.c > 0)
    .map((e) => ({ ...e, sx: width / 2 + (e.p.x - view.cx) * view.scale, sy: height / 2 + (e.p.y - view.cy) * view.scale }))
    .filter((e) => e.sx >= 4 && e.sx <= width - 4 && e.sy >= 4 && e.sy <= height - 4)
    .sort((a, b) => Math.log2(b.c + 1) * 2 + Math.log10(b.p.pop + 10) - (Math.log2(a.c + 1) * 2 + Math.log10(a.p.pop + 10)));
  // Reserved boxes (UI panels over the map) count as already placed
  const placed = reserved.map((box) => ({ box }));
  const out = [];
  for (const e of order) {
    if (out.length >= max) break;
    const [w, h] = measure(e.p.name);
    const box = [e.sx - 4, e.sy - h / 2 - 2, e.sx + 2 * h + w, e.sy + h / 2 + 2];
    if (box[0] < 0 || box[2] > width || box[1] < 0 || box[3] > height) continue;
    // Padding keeps labels apart so a phone screen isn't wall-to-wall names
    if (placed.some((q) => box[0] - pad < q.box[2] && q.box[0] < box[2] + pad && box[1] - pad < q.box[3] && q.box[1] < box[3] + pad)) continue;
    const l = { ...e, box };
    placed.push(l);
    out.push(l);
  }
  return out;
}
