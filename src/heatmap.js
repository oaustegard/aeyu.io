/**
 * Heatmap data prep (#301): polyline decoding, projection, GPU packing and
 * filter evaluation. No DOM or GPU dependencies so it runs under node:test.
 */

export const NO_GEAR = "__none__";
export const MAX_SLOTS = 32;

export function decodePolyline(str) {
  const points = [];
  let i = 0, lat = 0, lng = 0;
  while (i < str.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20 && i < str.length);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta; else lng += delta;
    }
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

export function encodePolyline(points) {
  let out = "", pLat = 0, pLng = 0;
  const enc = (v) => {
    v = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
    return s + String.fromCharCode(v + 63);
  };
  for (const [la, ln] of points) {
    const lat = Math.round(la * 1e5), lng = Math.round(ln * 1e5);
    out += enc(lat - pLat) + enc(lng - pLng);
    pLat = lat; pLng = lng;
  }
  return out;
}

// Web Mercator in [0,1]² (y down), the same space map tiles use
export function project(lat, lng) {
  const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
  return [(lng + 180) / 360, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

export function dayNumber(isoLocal) {
  return Math.floor(Date.parse(isoLocal.slice(0, 10) + "T00:00:00Z") / 86400000);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))];
}

/**
 * Pack every activity with a track into GPU-ready arrays.
 *
 * Coordinates are stored relative to `origin` so f32 keeps sub-metre
 * precision. Each line segment is one instance: x0 y0 x1 y1 (f32) + the
 * activity index (u32). Per-activity attributes (day, speed, type slot,
 * gear slot) live in a separate buffer the shader indexes, which is what
 * lets filters change without touching the segment buffer.
 */
export function buildHeatmapData(activities) {
  const tracks = [];
  for (const a of activities) {
    if (!a.summary_polyline) continue;
    const pts = decodePolyline(a.summary_polyline);
    if (pts.length < 2) continue;
    tracks.push({ a, pts: pts.map(([la, ln]) => project(la, ln)) });
  }

  const types = [...new Set(tracks.map((t) => t.a.sport_type))].sort().slice(0, MAX_SLOTS);
  const gearCounts = new Map();
  for (const t of tracks) {
    const g = t.a.gear_id || NO_GEAR;
    gearCounts.set(g, (gearCounts.get(g) || 0) + 1);
  }
  // Most-used first; past 31 bikes the rest share the last slot
  const gears = [...gearCounts.entries()].sort((x, y) => y[1] - x[1]).map(([g]) => g);
  const gearSlot = new Map(gears.map((g, i) => [g, Math.min(i, MAX_SLOTS - 1)]));

  let ox = 0, oy = 0, n = 0;
  for (const t of tracks) for (const [x, y] of t.pts) { ox += x; oy += y; n++; }
  const origin = n ? [ox / n, oy / n] : [0.5, 0.5];

  const segCount = tracks.reduce((s, t) => s + t.pts.length - 1, 0);
  const segments = new ArrayBuffer(segCount * 20);
  const segF = new Float32Array(segments);
  const segU = new Uint32Array(segments);
  const attrs = new ArrayBuffer(tracks.length * 16);
  const attrF = new Float32Array(attrs);
  const attrU = new Uint32Array(attrs);
  const meta = [];

  let k = 0;
  tracks.forEach((t, idx) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let j = 0; j < t.pts.length; j++) {
      const x = t.pts[j][0] - origin[0], y = t.pts[j][1] - origin[1];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (j === 0) continue;
      segF[k * 5] = t.pts[j - 1][0] - origin[0];
      segF[k * 5 + 1] = t.pts[j - 1][1] - origin[1];
      segF[k * 5 + 2] = x;
      segF[k * 5 + 3] = y;
      segU[k * 5 + 4] = idx;
      k++;
    }
    const day = dayNumber(t.a.start_date_local || t.a.start_date);
    const speed = t.a.average_speed || 0;
    const typeSlot = types.indexOf(t.a.sport_type);
    const gSlot = gearSlot.get(t.a.gear_id || NO_GEAR);
    attrF[idx * 4] = day;
    attrF[idx * 4 + 1] = speed;
    attrU[idx * 4 + 2] = typeSlot < 0 ? MAX_SLOTS - 1 : typeSlot;
    attrU[idx * 4 + 3] = gSlot;
    meta.push({
      id: t.a.id, day, speed, typeSlot, gearSlot: gSlot,
      bbox: [minX, minY, maxX, maxY],
      virtual: t.a.sport_type === "VirtualRide",
    });
  });

  const days = meta.map((m) => m.day);
  const speeds = meta.map((m) => m.speed);
  return {
    origin, segments, segCount, attrs, meta, types, gears,
    dayRange: [Math.min(...days), Math.max(...days)],
    speedRange: [Math.min(...speeds), Math.max(...speeds)],
  };
}

export function matchesFilter(m, f) {
  return m.day >= f.dayMin && m.day <= f.dayMax
    && m.speed >= f.speedMin && m.speed <= f.speedMax
    && ((f.typeMask >>> m.typeSlot) & 1) === 1
    && ((f.gearMask >>> m.gearSlot) & 1) === 1;
}

/**
 * Bounds for the visible set, trimmed to the 5th–95th percentile of track
 * centres so one far-off trip doesn't zoom the view out to a continent.
 */
export function fitBounds(meta, f) {
  const shown = meta.filter((m) => matchesFilter(m, f));
  if (shown.length === 0) return null;
  const cx = shown.map((m) => (m.bbox[0] + m.bbox[2]) / 2).sort((a, b) => a - b);
  const cy = shown.map((m) => (m.bbox[1] + m.bbox[3]) / 2).sort((a, b) => a - b);
  const ext = shown.map((m) => Math.max(m.bbox[2] - m.bbox[0], m.bbox[3] - m.bbox[1])).sort((a, b) => a - b);
  const pad = percentile(ext, 0.5) / 2;
  const lo = shown.length >= 20 ? 0.05 : 0, hi = shown.length >= 20 ? 0.95 : 1;
  return [
    percentile(cx, lo) - pad, percentile(cy, lo) - pad,
    percentile(cx, hi) + pad, percentile(cy, hi) + pad,
  ];
}
