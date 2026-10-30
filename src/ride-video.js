/**
 * Shareable ride replay video. The camera opens on the whole route, drops into
 * a chase view a few minutes wide around the rider (lower tilt, relief and
 * ribbon width scaled up so climbs and power bands read at phone size), then
 * pulls back out to the full route for the last few seconds.
 *
 * The camera path is planned up front for every frame (`planVideo`, pure) and
 * smoothed across frames, so a stop or a switchback doesn't jerk the framing.
 */

import { packRibbon, sampleAt, makeCamera, sliceBounds, sideOnYaw } from "./ride-scene.js";
import { createRideGPURenderer, createRideCanvasRenderer } from "./ride-render.js";
import { encodeVideo } from "./share-video.js";

export const VIDEO_FPS = 30;
export const VIDEO_SECONDS = 30;
export const VIDEO_W = 1080;
export const VIDEO_H = 1350;

// Fractions of the video: zoomed in by IN, riding until RIDE_END, fully back
// out by OUT, then held on the overview
const IN = 0.1, RIDE_END = 0.8, OUT = 0.93;
const SMOOTH_S = 1.5;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;

/** How far into the close-up the camera is at fraction u of the video, 0..1. */
export function zoomWeight(u) {
  return u < RIDE_END ? smoothstep(0, IN, u) : 1 - smoothstep(RIDE_END, OUT, u);
}

/** Stream time shown at fraction u: the ride plays out by RIDE_END, then holds. */
export function clockAt(scene, u) {
  const t0 = scene.t[0];
  return t0 + (scene.duration - t0) * clamp(u / RIDE_END, 0, 1);
}

// Two box-filter passes ≈ a Gaussian; edges clamp so the ends don't drift
function smooth(arr, radius) {
  let a = arr;
  for (let pass = 0; pass < 2; pass++) {
    const out = new Float64Array(a.length);
    for (let i = 0; i < a.length; i++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += a[clamp(i + k, 0, a.length - 1)];
      out[i] = s / (2 * radius + 1);
    }
    a = out;
  }
  return a;
}

/**
 * One camera per frame: { clock, bounds, zScale, yaw, pitch, weight, widthScale }.
 * `bounds` is in z-stretched space, as makeCamera expects with zScale.
 */
export function planVideo(scene, { fps = VIDEO_FPS, seconds = VIDEO_SECONDS } = {}) {
  const total = Math.round(fps * seconds);
  const full = scene.bounds;
  const fullHalf = Math.max(full.maxX - full.minX, full.maxY - full.minY, 1) / 2;
  const span = scene.duration - scene.t[0];
  const behind = Math.max(90, 0.07 * span), ahead = 0.5 * behind;

  const cx = new Float64Array(total), cy = new Float64Array(total), lh = new Float64Array(total);
  const z0 = new Float64Array(total), z1 = new Float64Array(total), zs = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    const clock = clockAt(scene, i / Math.max(1, total - 1));
    const b = sliceBounds(scene, clock - behind, clock + ahead);
    const half = Math.max((b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2, 0.12 * fullHalf);
    cx[i] = (b.minX + b.maxX) / 2;
    cy[i] = (b.minY + b.maxY) / 2;
    lh[i] = Math.log(half);
    z0[i] = b.minZ; z1[i] = b.maxZ;
    // Same rule as the scene's own exaggeration (relief ≈ 20% of extent), for
    // the window instead of the whole ride; capped so flat noise stays flat
    const relief = (b.maxZ - b.minZ) / scene.exaggeration;
    const want = relief > 0 ? Math.min(15, (0.2 * 2 * half) / relief) : scene.exaggeration;
    zs[i] = clamp(want / scene.exaggeration, 1, 2.5);
  }
  const r = Math.max(1, Math.round(SMOOTH_S * fps));
  const [scx, scy, slh, sz0, sz1, szs] = [cx, cy, lh, z0, z1, zs].map((a) => smooth(a, r));

  const baseYaw = sideOnYaw(scene);
  const fcx = (full.minX + full.maxX) / 2, fcy = (full.minY + full.maxY) / 2;
  const fhx = (full.maxX - full.minX) / 2, fhy = (full.maxY - full.minY) / 2;
  const frames = [];
  for (let i = 0; i < total; i++) {
    const u = i / Math.max(1, total - 1);
    const w = zoomWeight(u);
    const half = Math.exp(slh[i]);
    // Interpolate size in log space so the zoom moves at an even visual rate
    const hx = Math.exp(lerp(Math.log(Math.max(1, fhx)), Math.log(half), w));
    const hy = Math.exp(lerp(Math.log(Math.max(1, fhy)), Math.log(half), w));
    const x = lerp(fcx, scx[i], w), y = lerp(fcy, scy[i], w);
    const zScale = lerp(1, szs[i], w);
    const bz0 = lerp(0, sz0[i], w), bz1 = lerp(full.maxZ, sz1[i], w);
    frames.push({
      clock: clockAt(scene, u),
      bounds: { minX: x - hx, maxX: x + hx, minY: y - hy, maxY: y + hy, minZ: bz0 * zScale, maxZ: Math.max(bz0 + 1, bz1) * zScale },
      zScale,
      // A slow orbit while riding gives the close-up some parallax
      yaw: baseYaw + 0.5 * (clamp(u / RIDE_END, 0, 1) - 0.5),
      pitch: lerp(1.05, 1.25, w),
      weight: w,
      widthScale: lerp(1, 1.8, w),
      // Dim and then drop the ride far behind the rider, or the route already
      // ridden walls off the close-up. The window widens to the whole ride as
      // the camera pulls out, so the dimming never pops on or off.
      focus: { behind: behind * (1.5 + 40 * (1 - w)), ahead: ahead * (1 + 40 * (1 - w)), context: behind * (1 + 40 * (1 - w)) },
    });
  }
  return frames;
}

function cssVar(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + "…").width > maxW) s = s.slice(0, -1);
  return s + "…";
}

/**
 * Render the 30 s share video.
 *
 * @param {object} scene    from buildRideScene
 * @param {object} activity stored activity (name, start_date, totals)
 * @param {object} fmt      { time, speed, elevation, distance, date, awardLabel } formatters,
 *                          passed in so this module stays free of the units signal
 */
export async function renderRideVideo(scene, activity, fmt, { onProgress } = {}) {
  const W = VIDEO_W, H = VIDEO_H;
  const HEAD = 200, STRIP = 150, FOOT = 60;
  const SY = HEAD, SH = H - HEAD - STRIP - FOOT;
  const fonts = {
    display: cssVar("--font-display", "serif"),
    body: cssVar("--font-body", "sans-serif"),
    mono: cssVar("--font-mono", "monospace"),
  };
  await document.fonts?.ready;

  const frame = document.createElement("canvas");
  frame.width = W; frame.height = H;
  const ctx = frame.getContext("2d");
  const sceneCanvas = document.createElement("canvas");
  sceneCanvas.width = W; sceneCanvas.height = SH;

  const ribbon = packRibbon(scene);
  let r = null;
  try { r = await createRideGPURenderer(sceneCanvas, ribbon); }
  catch (e) { console.warn("[aeyu] WebGPU video renderer failed, using Canvas2D:", e); }
  // A canvas that has handed out a webgpu context can't give a 2d one
  let target = sceneCanvas;
  if (!r) {
    target = document.createElement("canvas");
    target.width = W; target.height = SH;
    r = createRideCanvasRenderer(target, ribbon);
  }

  const plan = planVideo(scene);
  const rate = (scene.duration - scene.t[0]) / (RIDE_END * VIDEO_SECONDS);
  const toastHold = 2.6 * rate;
  const lit = scene.efforts.filter((e) => e.color);
  const minAlt = Math.min(...scene.alt);
  const relief = Math.max(1, Math.max(...scene.alt) - minAlt);

  const b = scene.bounds;
  const gridSpan = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const gridStep = [100, 250, 500, 1000, 2000, 5000, 10000].find((v) => gridSpan / v <= 16) || 20000;

  const dateLine = fmt.date(activity.start_date);
  const statsLine = [
    activity.distance && fmt.distance(activity.distance),
    activity.moving_time && fmt.time(activity.moving_time),
    activity.total_elevation_gain && `${fmt.elevation(activity.total_elevation_gain)} up`,
    scene.hasPower && scene.avgW && `${Math.round(activity.average_watts || scene.avgW)} W avg`,
  ].filter(Boolean).join(" · ");

  function drawHeader() {
    const bg = ctx.createRadialGradient(W / 2, H * 0.3, 0, W / 2, H * 0.3, Math.max(W, H) * 0.85);
    bg.addColorStop(0, "#3B2A1E");
    bg.addColorStop(0.55, "#241912");
    bg.addColorStop(1, "#170F0B");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#FC4C02";
    ctx.fillRect(0, 0, W, 8);
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = "#fff";
    ctx.font = `64px ${fonts.display}`;
    ctx.fillText(fitText(ctx, activity.name || "Ride", W - 96), 48, 92);
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = `28px ${fonts.mono}`;
    ctx.fillText(fitText(ctx, dateLine, W - 96), 48, 140);
    ctx.fillText(fitText(ctx, statsLine, W - 96), 48, 180);
  }

  function drawGrid(cam) {
    const x0 = Math.floor((b.minX - gridSpan * 0.1) / gridStep) * gridStep, x1 = Math.ceil((b.maxX + gridSpan * 0.1) / gridStep) * gridStep;
    const y0 = Math.floor((b.minY - gridSpan * 0.1) / gridStep) * gridStep, y1 = Math.ceil((b.maxY + gridSpan * 0.1) / gridStep) * gridStep;
    ctx.save();
    ctx.beginPath(); ctx.rect(0, SY, W, SH); ctx.clip();
    ctx.translate(0, SY);
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += gridStep) {
      const a = cam.project(x, y0, 0), e = cam.project(x, y1, 0);
      if (a[2] > 0 && e[2] > 0) { ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); }
    }
    for (let y = y0; y <= y1; y += gridStep) {
      const a = cam.project(x0, y, 0), e = cam.project(x1, y, 0);
      if (a[2] > 0 && e[2] > 0) { ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); }
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawRider(cam, p) {
    const top = cam.project(p.x, p.y, p.z), base = cam.project(p.x, p.y, 0);
    if (top[2] <= 0) return;
    ctx.save();
    ctx.translate(0, SY);
    ctx.strokeStyle = "rgba(255,255,255,0.3)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(base[0], base[1]); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.shadowColor = "#fff"; ctx.shadowBlur = 24;
    ctx.beginPath(); ctx.arc(top[0], top[1], 13, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#FC4C02"; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(top[0], top[1], 20, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }

  function drawHud(sample, alpha) {
    if (alpha <= 0) return;
    const lines = [fmt.time(sample.t - scene.t[0]), fmt.speed(sample.v)];
    if (scene.hasPower) lines.push(`${Math.round(sample.w)} W`);
    if (scene.hasAltitude) lines.push(`${sample.g.toFixed(1)}% · ${fmt.elevation(sample.alt)}`);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `34px ${fonts.mono}`;
    const wBox = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 40;
    ctx.fillStyle = "rgba(36,25,18,0.7)";
    roundRect(ctx, 32, SY + 24, wBox, lines.length * 46 + 24, 16); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    lines.forEach((l, k) => ctx.fillText(l, 52, SY + 24 + 46 + k * 46));
    ctx.restore();
  }

  function drawToasts(clock) {
    const live = lit.filter((e) => clock >= e.tB && clock < e.tB + toastHold).slice(-3);
    let y = SY + 24;
    for (const e of live) {
      const age = (clock - e.tB) / toastHold;
      const a = Math.min(1, age * 8, (1 - age) * 6);
      const label = e.awards.map((x) => fmt.awardLabel(x.type)).join(" · ");
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = `600 28px ${fonts.body}`;
      const l1 = fitText(ctx, label, 520);
      const w1 = ctx.measureText(l1).width;
      ctx.font = `26px ${fonts.body}`;
      const l2 = fitText(ctx, e.name, 520);
      const wBox = Math.max(w1, ctx.measureText(l2).width) + 40;
      const x = W - 32 - wBox;
      ctx.fillStyle = "rgba(36,25,18,0.85)";
      roundRect(ctx, x, y, wBox, 96, 16); ctx.fill();
      ctx.strokeStyle = e.color; ctx.lineWidth = 3; ctx.stroke();
      ctx.fillStyle = e.color;
      ctx.font = `600 28px ${fonts.body}`;
      ctx.fillText(l1, x + 20, y + 40);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.font = `26px ${fonts.body}`;
      ctx.fillText(l2, x + 20, y + 76);
      ctx.restore();
      y += 112;
    }
  }

  const stripY = SY + SH + 20, stripH = STRIP - 40;
  const sx = (d) => 48 + (d / Math.max(1, scene.distance)) * (W - 96);
  const sy = (a) => stripY + stripH - ((a - minAlt) / relief) * stripH * 0.9;
  const profile = new Path2D();
  profile.moveTo(sx(scene.d[0]), stripY + stripH);
  const stepK = Math.max(1, Math.floor(scene.n / 600));
  for (let k = 0; k < scene.n; k += stepK) profile.lineTo(sx(scene.d[k]), sy(scene.alt[k]));
  profile.lineTo(sx(scene.d[scene.n - 1]), sy(scene.alt[scene.n - 1]));
  profile.lineTo(sx(scene.d[scene.n - 1]), stripY + stripH);
  profile.closePath();
  const bands = lit.map((e) => [sx(sampleAt(scene, e.tA).d), sx(sampleAt(scene, e.tB).d), e.color]);

  function drawStrip(cursorD, cursorAlpha) {
    ctx.fillStyle = "rgba(252,76,2,0.18)";
    ctx.fill(profile);
    ctx.strokeStyle = "rgba(252,76,2,0.75)"; ctx.lineWidth = 3;
    ctx.stroke(profile);
    for (const [a, z, color] of bands) {
      ctx.globalAlpha = 0.25; ctx.fillStyle = color;
      ctx.fillRect(a, stripY, Math.max(3, z - a), stripH);
    }
    ctx.globalAlpha = 1;
    if (cursorAlpha > 0) {
      ctx.globalAlpha = cursorAlpha;
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(sx(cursorD), stripY); ctx.lineTo(sx(cursorD), stripY + stripH); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.font = `24px ${fonts.body}`;
    ctx.textAlign = "right";
    ctx.fillText("aeyu.io", W - 48, H - 24);
    ctx.textAlign = "left";
    ctx.fillText("Ribbon colour is power · height is elevation", 48, H - 24);
  }

  async function draw(i) {
    const f = plan[i];
    const cam = makeCamera(f.bounds, W, SH, { yaw: f.yaw, pitch: f.pitch, zScale: f.zScale });
    drawHeader();
    drawGrid(cam);
    r.render(cam, {
      playhead: f.clock, width: 7 * f.widthScale,
      focusA: f.clock - f.focus.behind, focusB: f.clock + f.focus.ahead, context: f.focus.context,
    });
    // drawImage must follow the GPU submit in the same task, before the
    // canvas's current texture is presented and discarded
    ctx.drawImage(target, 0, SY);
    const sample = sampleAt(scene, f.clock);
    const riding = 1 - smoothstep(RIDE_END, RIDE_END + 0.04, i / (plan.length - 1));
    if (riding > 0) drawRider(cam, sample);
    drawHud(sample, riding);
    drawToasts(f.clock);
    drawStrip(sample.d, riding);
  }

  try {
    return await encodeVideo(frame, {
      total: plan.length, fps: VIDEO_FPS, bitrate: 8_000_000, draw, onProgress,
    });
  } finally {
    r.destroy();
  }
}
