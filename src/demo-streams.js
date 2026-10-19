/**
 * Plausible streams for demo rides, built from each ride's summary polyline
 * so demo mode can exercise the ride replay. Altitude is a smooth function
 * of position, so rides sharing a road share its hills.
 */

import { decodePolyline } from "./heatmap.js";

function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

export function synthesizeStreams(activity) {
  if (!activity.summary_polyline) return { id: activity.id, latlng: null };
  const raw = decodePolyline(activity.summary_polyline);
  const lat0 = raw[0][0], kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110540;
  const pts = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const [a, b] = [raw[i - 1], raw[i]];
    const len = Math.hypot((b[1] - a[1]) * kx, (b[0] - a[0]) * ky);
    const steps = Math.max(1, Math.round(len / 25));
    for (let s = 1; s <= steps; s++) pts.push([a[0] + ((b[0] - a[0]) * s) / steps, a[1] + ((b[1] - a[1]) * s) / steps]);
  }

  const altAt = ([la, ln]) => {
    const x = ln * kx, y = la * ky;
    return 60 + 45 * Math.sin(x / 2300) * Math.cos(y / 2900) + 25 * Math.sin(y / 1300 + 1.7) + 10 * Math.sin((x + y) / 700);
  };
  const r = rng(activity.id);
  const dist = [0], altitude = pts.map(altAt), grade = [0];
  for (let i = 1; i < pts.length; i++) {
    const seg = Math.hypot((pts[i][1] - pts[i - 1][1]) * kx, (pts[i][0] - pts[i - 1][0]) * ky);
    dist.push(dist[i - 1] + seg);
    grade.push(seg > 0 ? (altitude[i] - altitude[i - 1]) / seg : 0);
  }
  const scale = (activity.distance || dist[dist.length - 1]) / (dist[dist.length - 1] || 1);
  for (let i = 0; i < dist.length; i++) dist[i] *= scale;

  // Speed falls on climbs and rises on descents, then is scaled so the ride
  // takes its recorded moving time
  let noise = 0;
  const rel = grade.map((g) => {
    noise = noise * 0.9 + (r() - 0.5) * 0.08;
    return Math.min(1.6, Math.max(0.35, 1 - 7 * g + noise));
  });
  let raw_t = 0;
  for (let i = 1; i < dist.length; i++) raw_t += (dist[i] - dist[i - 1]) / rel[i];
  const base = raw_t / (activity.moving_time || raw_t / 8);
  const velocity = rel.map((v) => v * base);
  const time = [0];
  for (let i = 1; i < dist.length; i++) time.push(time[i - 1] + (dist[i] - dist[i - 1]) / velocity[i]);
  const tScale = (activity.elapsed_time || time[time.length - 1]) / (time[time.length - 1] || 1);

  let watts = null;
  if (activity.device_watts && activity.average_watts) {
    watts = velocity.map((v, i) => Math.max(0, (78 * 9.81 * v * (grade[i] + 0.005) + 0.5 * 1.2 * 0.32 * v ** 3) / 0.97));
    const mean = watts.reduce((s, w) => s + w, 0) / watts.length || 1;
    watts = watts.map((w) => Math.round(Math.max(0, (w / mean) * activity.average_watts * (0.85 + 0.3 * r()))));
  }

  return {
    id: activity.id,
    latlng: pts.map(([a, b]) => [+a.toFixed(6), +b.toFixed(6)]),
    time: time.map((t) => Math.round(t * tScale)),
    distance: dist.map((d) => +d.toFixed(1)),
    altitude: altitude.map((a) => +a.toFixed(1)),
    velocity_smooth: velocity.map((v) => +(v / tScale).toFixed(2)),
    watts,
    grade_smooth: grade.map((g) => +(g * 100).toFixed(1)),
  };
}
