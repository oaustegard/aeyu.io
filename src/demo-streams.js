/**
 * Plausible streams for demo rides, built from each ride's summary polyline
 * so demo mode can exercise the ride replay. Altitude is a smooth function
 * of position, so rides sharing a road share its hills.
 */

import { decodePolyline } from "./heatmap.js";
import { timeJumps } from "./ride-streams.js";

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
    // Spiky like a real power meter: per-sample noise, surges, and zeros when coasting downhill
    watts = velocity.map((v, i) => {
      if (grade[i] < -0.02 && r() < 0.7) return 0;
      const p = Math.max(0, (78 * 9.81 * v * (grade[i] + 0.005) + 0.5 * 1.2 * 0.32 * v ** 3) / 0.97);
      return p * (0.6 + 0.8 * r()) * (r() < 0.04 ? 2 : 1);
    });
    const mean = watts.reduce((s, w) => s + w, 0) / watts.length || 1;
    watts = watts.map((w) => Math.round((w / mean) * activity.average_watts));
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

/**
 * Per-second power, heart rate, cadence, speed and altitude for a demo power
 * ride (#302), shaped so the fatigue-binned curve has something to show:
 * hard efforts are spread through the ride and fade as work accumulates.
 * Rides over two hours stop once for coffee, which exercises the gap rule.
 */
export function synthesizeRideStreams(activity) {
  if (!activity.device_watts || !activity.average_watts) return null;
  const r = rng(activity.id * 7 + 3);
  const n = activity.moving_time;
  const avg = activity.average_watts;
  const cp = 1.12 * avg;
  const raw = new Float64Array(n);
  let drift = 0;
  for (let i = 0; i < n; i++) {
    drift = drift * 0.995 + (r() - 0.5) * 6;
    raw[i] = Math.max(0, 0.82 * avg + drift + (r() - 0.5) * 50 + (r() < 0.06 ? -0.82 * avg : 0));
  }
  // One effort per ~10 min, its intensity set by the work done before it
  const efforts = [];
  for (let t = 300 + Math.floor(r() * 600); t < n - 30; t += 400 + Math.floor(r() * 500)) {
    const d = [10, 30, 60, 180, 300, 600, 1200][Math.floor(r() * 7)];
    efforts.push([t, Math.min(d, n - t)]);
  }
  let work = 0, e = 0;
  for (let i = 0; i < n; i++) {
    if (e < efforts.length && i === efforts[e][0]) {
      const [t, d] = efforts[e++];
      const fade = Math.max(0.6, 1 - 0.07 * (work / 1e6));
      const target = Math.min(4.5 * cp, cp + (0.22 * cp * 300) / d) * fade * (0.9 + 0.1 * r());
      for (let j = t; j < t + d && j < n; j++) raw[j] = target * (0.92 + 0.16 * r());
    }
    work += raw[i];
  }
  const mean = raw.reduce((s, w) => s + w, 0) / n;
  const k = avg / mean;

  const stopAt = n > 7200 ? Math.floor(n * 0.55) : -1;
  const time = new Uint32Array(n), watts = new Uint16Array(n), heartrate = new Uint8Array(n);
  const cadence = new Uint8Array(n), velocity = new Uint16Array(n), altitude = new Uint16Array(n);
  const maxHr = activity.max_heartrate || 180;
  let hr = 0.55 * maxHr, t = 0;
  for (let i = 0; i < n; i++) {
    if (i === stopAt) t += 900;
    time[i] = t++;
    const w = Math.round(raw[i] * k);
    watts[i] = w;
    const target = Math.min(maxHr, 0.5 * maxHr + (0.4 * maxHr * w) / cp + 0.04 * maxHr * (i / n));
    hr += (target - hr) / 30;
    heartrate[i] = Math.round(hr);
    cadence[i] = w > 0 ? 80 + Math.round(15 * r()) : 0;
    const climb = Math.sin(i / 600);
    velocity[i] = Math.round(100 * Math.max(1.5, Math.cbrt(Math.max(w, 30) / 0.4) - 3 * climb));
    altitude[i] = Math.round(10 * (60 + 120 * (1 - Math.cos(i / 600))));
  }
  return { id: activity.id, n, time_jumps: timeJumps(time), watts, heartrate, cadence, velocity, altitude, altitude_base: 0 };
}
