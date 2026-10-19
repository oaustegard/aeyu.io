/**
 * Ride replay scene: turns Strava streams into a tilted 3D ribbon whose
 * motion is the ride's own pace, width is power and height is altitude.
 * Pure functions — no DOM or GPU — so they run under node:test.
 */

const MAX_POINTS = 4000;
const POWER_SMOOTH_S = 10;

function lowerBound(arr, v, n = arr.length) {
  let lo = 0, hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/**
 * @param {object} streams  record from fetchRideStreams (or demo synthesis)
 * @param {object} activity stored activity (start_date, segment_efforts)
 * @param {Map<number, Array>} awardsBySegment segment_id → awards for this ride
 * @param {object} colors   award type → hex color
 */
export function buildRideScene(streams, activity, awardsBySegment = new Map(), colors = {}) {
  const ll = streams?.latlng;
  if (!ll || ll.length < 2 || !streams.time) return null;
  const stride = Math.max(1, Math.ceil(ll.length / MAX_POINTS));
  const idx = [];
  for (let i = 0; i < ll.length; i += stride) idx.push(i);
  if (idx[idx.length - 1] !== ll.length - 1) idx.push(ll.length - 1);
  const n = idx.length;

  let lat0 = 0, lng0 = 0;
  for (const i of idx) { lat0 += ll[i][0]; lng0 += ll[i][1]; }
  lat0 /= n; lng0 /= n;
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;

  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
  const t = new Float32Array(n), d = new Float32Array(n), alt = new Float32Array(n);
  const v = new Float32Array(n), w = new Float32Array(n), g = new Float32Array(n);
  const hasPower = !!streams.watts && streams.watts.some((p) => p > 0);
  const hasAltitude = !!streams.altitude;

  // Rolling-mean power over the raw stream before downsampling
  let smooth = null;
  if (hasPower) {
    smooth = new Float32Array(ll.length);
    let sum = 0, j = 0;
    for (let i = 0; i < ll.length; i++) {
      sum += streams.watts[i] || 0;
      while (streams.time[i] - streams.time[j] > POWER_SMOOTH_S) sum -= streams.watts[j++] || 0;
      smooth[i] = sum / (i - j + 1);
    }
  }

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  let minA = Infinity, maxA = -Infinity, cum = 0;
  idx.forEach((i, k) => {
    x[k] = (ll[i][1] - lng0) * kx;
    y[k] = (ll[i][0] - lat0) * ky;
    t[k] = streams.time[i];
    if (k > 0) cum += Math.hypot(x[k] - x[k - 1], y[k] - y[k - 1]);
    d[k] = streams.distance ? streams.distance[i] : cum;
    alt[k] = hasAltitude ? streams.altitude[i] : 0;
    v[k] = streams.velocity_smooth ? streams.velocity_smooth[i] : 0;
    w[k] = smooth ? smooth[i] : 0;
    g[k] = streams.grade_smooth ? streams.grade_smooth[i] : 0;
    if (x[k] < minX) minX = x[k]; if (x[k] > maxX) maxX = x[k];
    if (y[k] < minY) minY = y[k]; if (y[k] > maxY) maxY = y[k];
    if (alt[k] < minA) minA = alt[k]; if (alt[k] > maxA) maxA = alt[k];
  });
  if (!streams.velocity_smooth) {
    for (let k = 1; k < n; k++) v[k] = (d[k] - d[k - 1]) / Math.max(1, t[k] - t[k - 1]);
  }

  // Exaggerate relief to ~12% of the route's extent so climbs read as climbs
  const extent = Math.max(maxX - minX, maxY - minY, 1);
  const relief = maxA - minA;
  const exaggeration = relief > 0 ? Math.min(10, Math.max(1, (0.12 * extent) / relief)) : 1;
  for (let k = 0; k < n; k++) z[k] = (alt[k] - minA) * exaggeration;

  let avgW = 0;
  if (hasPower) {
    let s = 0, c = 0;
    for (let k = 0; k < n; k++) if (w[k] > 0) { s += w[k]; c++; }
    avgW = c ? s / c : 0;
  }

  const startMs = Date.parse(activity.start_date);
  const efforts = (activity.segment_efforts || []).map((e) => {
    const tA = (Date.parse(e.start_date) - startMs) / 1000;
    const awards = awardsBySegment.get(e.segment.id) || [];
    return {
      effort_id: e.id, segment_id: e.segment.id, name: e.segment.name,
      tA, tB: tA + e.elapsed_time, elapsed: e.elapsed_time,
      awards, color: awards.length ? colors[awards[0].type] || null : null,
    };
  }).filter((e) => Number.isFinite(e.tA) && e.tB > t[0] && e.tA < t[n - 1]);

  return {
    n, x, y, z, t, d, alt, v, w, g, hasPower, hasAltitude, avgW, exaggeration,
    bounds: { minX, maxX, minY, maxY, minZ: 0, maxZ: relief * exaggeration },
    duration: t[n - 1], distance: d[n - 1], efforts,
  };
}

/** Interpolated state at stream time `time`. */
export function sampleAt(scene, time) {
  const { n, t } = scene;
  if (time <= t[0]) return pick(scene, 0, 0, 0);
  if (time >= t[n - 1]) return pick(scene, n - 2, n - 1, 1);
  const k = lowerBound(t, time, n);
  const f = (time - t[k - 1]) / Math.max(1e-6, t[k] - t[k - 1]);
  return pick(scene, k - 1, k, f);
}

function pick(s, a, b, f) {
  const l = (arr) => arr[a] + (arr[b] - arr[a]) * f;
  return { index: f < 0.5 ? a : b, x: l(s.x), y: l(s.y), z: l(s.z), t: l(s.t), d: l(s.d), alt: l(s.alt), v: l(s.v), w: l(s.w), g: l(s.g) };
}

/** Point at distance `dist` along the ride (metres). */
export function pointAtDistance(scene, dist) {
  const { n, d } = scene;
  if (dist <= d[0]) return pick(scene, 0, 0, 0);
  if (dist >= d[n - 1]) return pick(scene, n - 2, n - 1, 1);
  const k = lowerBound(d, dist, n);
  return pick(scene, k - 1, k, (dist - d[k - 1]) / Math.max(1e-6, d[k] - d[k - 1]));
}

/**
 * Instance data for the ribbon: per segment p0 xyz, p1 xyz, t0, t1, w0, w1
 * (power as 0..1 of twice the ride average) and rgb. Award-earning efforts
 * take their award colour; everything else is the neutral ribbon colour.
 */
export const RIBBON_FLOATS = 13;
export function packRibbon(scene, baseRgb = [0.98, 0.93, 0.86]) {
  const { n, x, y, z, t, w, avgW, hasPower } = scene;
  const out = new Float32Array((n - 1) * RIBBON_FLOATS);
  const rgbs = scene.efforts.filter((e) => e.color).map((e) => ({ e, rgb: hexToRgb(e.color) }));
  const wn = (k) => (hasPower && avgW > 0 ? Math.min(1, w[k] / (2 * avgW)) : 0.35);
  for (let k = 0; k < n - 1; k++) {
    const o = k * RIBBON_FLOATS;
    out[o] = x[k]; out[o + 1] = y[k]; out[o + 2] = z[k];
    out[o + 3] = x[k + 1]; out[o + 4] = y[k + 1]; out[o + 5] = z[k + 1];
    out[o + 6] = t[k]; out[o + 7] = t[k + 1];
    out[o + 8] = wn(k); out[o + 9] = wn(k + 1);
    const hit = rgbs.find(({ e }) => t[k] >= e.tA && t[k] < e.tB);
    const rgb = hit ? hit.rgb : baseRgb;
    out[o + 10] = rgb[0]; out[o + 11] = rgb[1]; out[o + 12] = rgb[2];
  }
  return out;
}

export function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}

/**
 * Ghost race on one segment: every stored effort runs the stretch this ride
 * covered between the effort's start and end. Ghosts are paced like this
 * effort, scaled to their own elapsed time, so climbs slow everyone alike.
 */
export function buildGhostRace(scene, effort, history, maxGhosts = 30) {
  const dA = sampleAt(scene, effort.tA).d;
  const dB = sampleAt(scene, effort.tB).d;
  if (!(dB > dA)) return null;
  const sorted = [...history].sort((a, b) => a.elapsed_time - b.elapsed_time);
  const best = sorted[0];
  const median = sorted[Math.floor((sorted.length - 1) / 2)];
  const recent = [...history].sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""));
  const keep = new Map();
  for (const e of [best, median, ...recent]) {
    if (keep.size >= maxGhosts) break;
    if (e && !keep.has(e.effort_id)) keep.set(e.effort_id, e);
  }
  if (!keep.has(effort.effort_id)) keep.set(effort.effort_id, { effort_id: effort.effort_id, elapsed_time: effort.elapsed, start_date: null });
  const ghosts = [...keep.values()].map((e) => ({
    effort_id: e.effort_id,
    elapsed: e.elapsed_time,
    date: e.start_date_local || e.start_date || null,
    isThis: e.effort_id === effort.effort_id,
    isBest: e === best,
    isMedian: e === median,
  }));
  return {
    effort, dA, dB, ghosts,
    longest: Math.max(...ghosts.map((g) => g.elapsed)),
    /** Distance along the segment (0..dB-dA) for a ghost `clock` seconds in. */
    progress(ghost, clock) {
      if (clock >= ghost.elapsed) return dB - dA;
      const tThis = effort.tA + (Math.max(0, clock) / ghost.elapsed) * effort.elapsed;
      return Math.max(0, sampleAt(scene, tThis).d - dA);
    },
  };
}

/** Live order: further along first; finished ghosts by elapsed time. */
export function standings(race, clock) {
  const len = race.dB - race.dA;
  return race.ghosts
    .map((g) => ({ g, p: race.progress(g, clock), done: clock >= g.elapsed }))
    .sort((a, b) => (a.done && b.done ? a.g.elapsed - b.g.elapsed : b.p - a.p))
    .map((s, i) => ({ ...s, rank: i + 1, frac: s.p / len }));
}

// --- Camera: column-major mat4 for WGSL, depth mapped to 0..1 ---

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = far / (near - far); m[11] = -1; m[14] = (near * far) / (near - far);
  return m;
}

function lookAt(eye, at, up) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const norm = (a) => { const l = Math.hypot(...a) || 1; return a.map((c) => c / l); };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const zA = norm(sub(eye, at)), xA = norm(cross(up, zA)), yA = cross(zA, xA);
  return new Float32Array([
    xA[0], yA[0], zA[0], 0, xA[1], yA[1], zA[1], 0, xA[2], yA[2], zA[2], 0,
    -dot(xA, eye), -dot(yA, eye), -dot(zA, eye), 1,
  ]);
}

function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

function transform(m, p) {
  const cx = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const cy = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const cw = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [cx / cw, cy / cw, cw];
}

/**
 * Tilted perspective camera framing `b` (scene bounds or a segment's).
 * yaw rotates around the vertical axis; pitch is the tilt from straight down.
 */
export function makeCamera(b, width, height, { yaw = 0, pitch = 0.9, zoom = 1 } = {}) {
  const aspect = width / Math.max(1, height);
  const fov = 0.7;
  const at = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2];
  const r = Math.max(b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ, 50) / 2;
  const dir = [-Math.sin(yaw) * Math.sin(pitch), -Math.cos(yaw) * Math.sin(pitch), Math.cos(pitch)];
  const corners = [];
  for (const cx of [b.minX, b.maxX]) for (const cy of [b.minY, b.maxY]) for (const cz of [b.minZ, b.maxZ]) corners.push([cx, cy, cz]);

  const build = (dist) => {
    const eye = at.map((c, i) => c + dir[i] * dist);
    const proj = perspective(fov, aspect, dist * 0.05, dist * 4);
    return mul(proj, lookAt(eye, at, [0, 0, 1]));
  };
  // Start from a sphere fit, then rescale once so the projected corners fill ~85%
  let dist = (r / Math.tan(fov / 2)) * 1.1;
  let vp = build(dist);
  const spread = Math.max(...corners.map((c) => { const p = transform(vp, c); return Math.max(Math.abs(p[0]), Math.abs(p[1])); }));
  if (spread > 0) { dist *= spread / 0.85; vp = build(dist); }
  if (zoom !== 1) { dist /= zoom; vp = build(dist); }

  return {
    viewProj: vp,
    project(px, py, pz) {
      const p = transform(vp, [px, py, pz]);
      return [(p[0] + 1) * 0.5 * width, (1 - p[1]) * 0.5 * height, p[2]];
    },
  };
}

/**
 * Yaw that puts the points' long axis across the screen (principal axis of
 * the x/y spread), with a slight turn so the tilt reads as 3D.
 */
export function sideOnYaw(scene, tA = -Infinity, tB = Infinity) {
  const { n, t, x, y } = scene;
  let mx = 0, my = 0, c = 0;
  for (let k = 0; k < n; k++) if (t[k] >= tA && t[k] <= tB) { mx += x[k]; my += y[k]; c++; }
  if (c < 2) return 0.35;
  mx /= c; my /= c;
  let sxx = 0, syy = 0, sxy = 0;
  for (let k = 0; k < n; k++) {
    if (t[k] < tA || t[k] > tB) continue;
    const dx = x[k] - mx, dy = y[k] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return Math.atan2(Math.cos(theta), Math.sin(theta)) - Math.PI / 2 + 0.35;
}

export function sliceBounds(scene, tA, tB) {
  const { n, t, x, y, z } = scene;
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (let k = 0; k < n; k++) {
    if (t[k] < tA || t[k] > tB) continue;
    b.minX = Math.min(b.minX, x[k]); b.maxX = Math.max(b.maxX, x[k]);
    b.minY = Math.min(b.minY, y[k]); b.maxY = Math.max(b.maxY, y[k]);
    b.minZ = Math.min(b.minZ, z[k]); b.maxZ = Math.max(b.maxZ, z[k]);
  }
  return Number.isFinite(b.minX) ? b : scene.bounds;
}
