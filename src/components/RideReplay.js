/**
 * Ride replay: the ride as a tilted 3D ribbon that draws itself at the ride's
 * own pace (speed is motion), widens with power and rises with altitude.
 * Award-earning segments light up as the rider finishes them. Each segment
 * with history can also be raced against every past effort as ghosts.
 */

import { html } from "htm/preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { getStreams, putStreams, getSegment } from "../db.js";
import { fetchRideStreams } from "../sync.js";
import { isDemo } from "../demo.js";
import { AWARD_LABELS, awardScore } from "../award-config.js";
import { formatSpeed, formatElevation, formatTime, formatDate } from "../units.js";
import {
  buildRideScene, packRibbon, sampleAt, pointAtDistance, makeCamera,
  sliceBounds, buildGhostRace, standings, sideOnYaw, crowdDensity,
} from "../ride-scene.js";
import { createRideGPURenderer, createRideCanvasRenderer } from "../ride-render.js";

const DOT_COLORS = Object.fromEntries(Object.entries(AWARD_LABELS).map(([k, v]) => [k, v.dot]));
const GOLD = "#F2B544", LAVENDER = "#B9A6E8", GHOST = "rgba(255,255,255,0.45)";
const ghostColor = (g) => (g.isThis ? "#ffffff" : g.isBest ? GOLD : g.isMedian ? LAVENDER : GHOST);
const ghostText = (g) => (g.isThis ? "#fff" : g.isBest ? GOLD : g.isMedian || g.isP25 ? LAVENDER : "rgba(255,255,255,0.6)");
const muted = "font-family: var(--font-body); color: rgba(255,255,255,0.6);";

// The effect re-runs when awards finish loading; share one Strava request
const inflight = new Map();
function loadStreams(id) {
  if (!inflight.has(id)) {
    inflight.set(id, (async () => {
      let rec = await getStreams(id);
      if (!rec && !isDemo.value) {
        rec = await fetchRideStreams(id);
        await putStreams(rec);
      }
      return rec;
    })().finally(() => inflight.delete(id)));
  }
  return inflight.get(id);
}

function ghostLabel(g) {
  if (g.isThis) return "Today";
  if (g.isP25) return "P25";
  if (g.isMedian) return "Median";
  return g.date ? formatDate(g.date) : "Earlier";
}

export function RideReplay({ activity, awards }) {
  const wrapRef = useRef(null);
  const gridRef = useRef(null);
  const mainRef = useRef(null);
  const overlayRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const raceRef = useRef(null);
  const clockRef = useRef(null);
  const playingRef = useRef(false);
  const rafRef = useRef(0);
  const viewRef = useRef({ yaw: 0.35, pitch: 1.1, zoom: 1 });
  const firedRef = useRef(new Set());

  const [status, setStatus] = useState("loading");
  const [scene, setScene] = useState(null);
  const [engine, setEngine] = useState(null);
  const [force2d, setForce2d] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [tick, setTick] = useState(0);
  const [replaySeconds, setReplaySeconds] = useState(30);
  const [race, setRace] = useState(null);
  const [histories, setHistories] = useState(new Map());
  const [toasts, setToasts] = useState([]);
  const [fullscreen, setFullscreen] = useState(false);

  // CSS full screen, not the Fullscreen API: iPhone Safari only grants that to video
  useEffect(() => {
    if (!fullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [fullscreen]);
  const secondsRef = useRef(replaySeconds);
  secondsRef.current = replaySeconds;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setStatus("loading");
      if (activity.summary_polyline === null) { setStatus("none"); return; }
      let rec;
      try { rec = await loadStreams(activity.id); }
      catch (e) {
        if (!cancelled) setStatus(e.retryAfter ? "ratelimit" : "error");
        return;
      }
      if (cancelled) return;
      const bySeg = new Map();
      for (const a of awards || []) {
        if (a.segment_id == null) continue;
        if (!bySeg.has(a.segment_id)) bySeg.set(a.segment_id, []);
        bySeg.get(a.segment_id).push(a);
      }
      const s = rec && buildRideScene(rec, activity, bySeg, DOT_COLORS, awardScore);
      if (!s) { setStatus("none"); return; }
      sceneRef.current = s;
      viewRef.current = { yaw: sideOnYaw(s), pitch: 1.1, zoom: 1 };
      setScene(s);
      setStatus("ready");
      const h = new Map();
      for (const e of s.efforts) {
        const seg = await getSegment(e.segment_id);
        if (seg && seg.efforts && seg.efforts.length >= 2) h.set(e.effort_id, seg.efforts);
      }
      if (!cancelled) setHistories(h);
    })();
    return () => { cancelled = true; };
  }, [activity.id, awards]);

  useEffect(() => {
    if (!scene || !mainRef.current) return;
    let cancelled = false;
    (async () => {
      const ribbon = packRibbon(scene);
      let r = null;
      if (!force2d) {
        try { r = await createRideGPURenderer(mainRef.current, ribbon); }
        catch (e) {
          console.warn("WebGPU replay init failed, using Canvas2D:", e);
          if (!cancelled) setForce2d(true);
          return;
        }
      }
      if (cancelled) { if (r) r.destroy(); return; }
      if (!r) r = createRideCanvasRenderer(mainRef.current, ribbon);
      rendererRef.current = r;
      setEngine(r.kind);
      resize();
    })();
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
      if (rendererRef.current) rendererRef.current.destroy();
      rendererRef.current = null;
    };
  }, [scene, force2d]);

  function resize() {
    const w = wrapRef.current;
    if (!w) return;
    const dpr = devicePixelRatio || 1;
    for (const c of [gridRef.current, mainRef.current, overlayRef.current]) {
      if (!c) continue;
      c.width = Math.max(1, Math.round(w.clientWidth * dpr));
      c.height = Math.max(1, Math.round(w.clientHeight * dpr));
    }
    renderFrame();
  }

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [status]);

  function camera() {
    const s = sceneRef.current, c = mainRef.current;
    const rc = raceRef.current;
    const b = rc ? sliceBounds(s, rc.effort.tA, rc.effort.tB) : s.bounds;
    return makeCamera({ ...b, minZ: 0 }, c.width, c.height, viewRef.current);
  }

  function drawGrid(cam) {
    const c = gridRef.current, s = sceneRef.current;
    const ctx = c.getContext("2d");
    ctx.clearRect(0, 0, c.width, c.height);
    const b = s.bounds;
    const span = Math.max(b.maxX - b.minX, b.maxY - b.minY);
    const step = [100, 250, 500, 1000, 2000, 5000, 10000].find((v) => span / v <= 16) || 20000;
    const x0 = Math.floor((b.minX - span * 0.1) / step) * step, x1 = Math.ceil((b.maxX + span * 0.1) / step) * step;
    const y0 = Math.floor((b.minY - span * 0.1) / step) * step, y1 = Math.ceil((b.maxY + span * 0.1) / step) * step;
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = devicePixelRatio || 1;
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) {
      const a = cam.project(x, y0, 0), e = cam.project(x, y1, 0);
      if (a[2] > 0 && e[2] > 0) { ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); }
    }
    for (let y = y0; y <= y1; y += step) {
      const a = cam.project(x0, y, 0), e = cam.project(x1, y, 0);
      if (a[2] > 0 && e[2] > 0) { ctx.moveTo(a[0], a[1]); ctx.lineTo(e[0], e[1]); }
    }
    ctx.stroke();
  }

  function dot(ctx, cam, p, color, radius, ring) {
    const top = cam.project(p.x, p.y, p.z);
    const base = cam.project(p.x, p.y, 0);
    const dpr = devicePixelRatio || 1;
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.moveTo(top[0], top[1]); ctx.lineTo(base[0], base[1]); ctx.stroke();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 10 * dpr;
    ctx.beginPath(); ctx.arc(top[0], top[1], radius * dpr, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    if (ring) {
      ctx.strokeStyle = ring; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(top[0], top[1], (radius + 3) * dpr, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // Soft sprite stamped along the road; 'lighter' makes overlaps add up
  const spriteRef = useRef(null);
  function sprite() {
    if (spriteRef.current) return spriteRef.current;
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,240,225,1)");
    grad.addColorStop(0.5, "rgba(255,240,225,0.35)");
    grad.addColorStop(1, "rgba(255,240,225,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return (spriteRef.current = c);
  }

  function drawCrowd(ctx, cam, s, rc, clock) {
    const { d, a, riding } = crowdDensity(rc, clock);
    if (!riding) return;
    const img = sprite();
    const pts = Array.from(d, (dist) => {
      const p = pointAtDistance(s, rc.dA + dist);
      return cam.project(p.x, p.y, p.z);
    });
    const dpr = devicePixelRatio || 1;
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    for (let b = 0; b < pts.length; b++) {
      if (a[b] < 0.01 || pts[b][2] <= 0) continue;
      const nb = pts[Math.min(pts.length - 1, b + 1)], pb = pts[Math.max(0, b - 1)];
      const step = Math.hypot(nb[0] - pb[0], nb[1] - pb[1]) / 2;
      const r = Math.max(16 * dpr, 2.5 * step);
      ctx.globalAlpha = a[b] * 0.12;
      ctx.drawImage(img, pts[b][0] - r, pts[b][1] - r, 2 * r, 2 * r);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prevOp;
  }

  function renderFrame() {
    const s = sceneRef.current, r = rendererRef.current, c = mainRef.current;
    if (!s || !r || !c || c.width < 2) return;
    const cam = camera();
    const dpr = devicePixelRatio || 1;
    const rc = raceRef.current;
    const clock = clockRef.current;
    drawGrid(cam);
    r.render(cam, rc
      ? { playhead: 1e12, widthBase: 2.5 * dpr, widthGain: 7 * dpr, focusA: rc.effort.tA, focusB: rc.effort.tB, context: Math.max(15, 0.25 * rc.effort.elapsed) }
      : { playhead: clock == null ? 1e12 : clock, widthBase: 1.5 * dpr, widthGain: 5 * dpr });

    const o = overlayRef.current, ctx = o.getContext("2d");
    ctx.clearRect(0, 0, o.width, o.height);
    if (rc && clock != null) {
      drawCrowd(ctx, cam, s, rc, clock);
      for (const g of rc.ghosts.filter((g) => g.marked && !g.isThis).reverse()) {
        dot(ctx, cam, pointAtDistance(s, rc.dA + rc.progress(g, clock)), ghostColor(g),
          g.isBest || g.isMedian ? 5 : 3.5, g.isP25 ? LAVENDER : null);
      }
      const me = rc.ghosts.find((g) => g.isThis);
      dot(ctx, cam, pointAtDistance(s, rc.dA + rc.progress(me, clock)), "#ffffff", 6, "#FC4C02");
    } else if (!rc && clock != null) {
      dot(ctx, cam, sampleAt(s, clock), "#ffffff", 6, "#FC4C02");
    }
    window.__replay = { engine: r.kind, clock, mode: rc ? "ghost" : "ride", points: s.n };
  }

  function rate() {
    const s = sceneRef.current, rc = raceRef.current;
    return rc ? rc.longest / 15 : s.duration / secondsRef.current;
  }

  function endClock() {
    const rc = raceRef.current;
    return rc ? rc.longest + 1.5 * rate() : sceneRef.current.duration;
  }

  function checkAwards(prev, now) {
    if (raceRef.current) return;
    const fired = firedRef.current;
    const hits = sceneRef.current.efforts.filter((e) => e.color && !fired.has(e.effort_id) && e.tB > prev && e.tB <= now);
    if (!hits.length) return;
    for (const e of hits) fired.add(e.effort_id);
    const items = hits.map((e) => ({ id: e.effort_id, name: e.name, color: e.color, labels: e.awards.map((a) => AWARD_LABELS[a.type]?.label || a.type) }));
    setToasts((t) => [...t, ...items].slice(-3));
    setTimeout(() => setToasts((t) => t.filter((x) => !items.includes(x))), 2600);
  }

  function play() {
    if (!sceneRef.current) return;
    if (clockRef.current == null || clockRef.current >= endClock()) {
      clockRef.current = raceRef.current ? 0 : sceneRef.current.t[0];
      firedRef.current = new Set();
    }
    playingRef.current = true;
    setPlaying(true);
    let last = performance.now(), lastUi = 0;
    const step = (now) => {
      if (!playingRef.current) return;
      const prev = clockRef.current;
      clockRef.current = Math.min(endClock(), prev + ((now - last) / 1000) * rate());
      last = now;
      checkAwards(prev, clockRef.current);
      renderFrame();
      if (now - lastUi > 100) { setTick((x) => x + 1); lastUi = now; }
      if (clockRef.current >= endClock()) { playingRef.current = false; setPlaying(false); setTick((x) => x + 1); return; }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }

  function pause() {
    playingRef.current = false;
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
  }

  function reset() {
    pause();
    clockRef.current = null;
    raceRef.current = null;
    viewRef.current = { yaw: sideOnYaw(sceneRef.current), pitch: 1.1, zoom: 1 };
    setRace(null);
    setToasts([]);
    renderFrame();
    setTick((x) => x + 1);
  }

  function startRace(effort) {
    pause();
    const rc = buildGhostRace(sceneRef.current, effort, histories.get(effort.effort_id) || []);
    if (!rc) return;
    raceRef.current = rc;
    viewRef.current = { yaw: sideOnYaw(sceneRef.current, effort.tA, effort.tB), pitch: 1.05, zoom: 1 };
    setRace(rc);
    wrapRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    clockRef.current = 0;
    renderFrame();
    play();
  }

  function scrubTo(frac) {
    const s = sceneRef.current;
    if (!s) return;
    pause();
    const rc = raceRef.current;
    if (rc) {
      clockRef.current = frac * rc.longest;
    } else {
      const target = frac * s.distance;
      let k = 0;
      while (k < s.n - 1 && s.d[k] < target) k++;
      clockRef.current = s.t[k];
    }
    renderFrame();
    setTick((x) => x + 1);
  }

  useEffect(() => {
    const c = overlayRef.current;
    if (!c) return;
    let drag = null;
    const down = (e) => { drag = { x: e.clientX, y: e.clientY, type: e.pointerType }; c.setPointerCapture(e.pointerId); };
    const move = (e) => {
      if (!drag) return;
      const v = viewRef.current;
      v.yaw += (e.clientX - drag.x) * 0.008;
      if (drag.type === "mouse") v.pitch = Math.min(1.3, Math.max(0.25, v.pitch - (e.clientY - drag.y) * 0.006));
      drag.x = e.clientX; drag.y = e.clientY;
      if (!playingRef.current) renderFrame();
    };
    const up = () => { drag = null; };
    const wheel = (e) => {
      e.preventDefault();
      const v = viewRef.current;
      v.zoom = Math.min(8, Math.max(0.6, v.zoom * Math.exp(-e.deltaY * 0.0015)));
      if (!playingRef.current) renderFrame();
    };
    c.addEventListener("pointerdown", down);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", wheel, { passive: false });
    return () => {
      c.removeEventListener("pointerdown", down);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
      c.removeEventListener("pointercancel", up);
      c.removeEventListener("wheel", wheel);
    };
  }, [status]);

  if (status === "none") return null;
  if (status !== "ready" || !scene) {
    const msg = status === "loading" ? "Loading ride replay…"
      : status === "ratelimit" ? "Strava's rate limit is reached — the replay will load in about 15 minutes."
      : "Couldn't load this ride's GPS data from Strava.";
    return html`<div class="rounded-xl p-4 mb-6 text-xs" style="background: #12110f; ${muted}">${msg}</div>`;
  }

  const clock = clockRef.current;
  const rc = race;
  const sample = !rc && clock != null ? sampleAt(scene, clock) : null;
  const relief = Math.max(1, scene.bounds.maxZ / scene.exaggeration);
  const minAlt = Math.min(...scene.alt);
  const px = (d) => (d / Math.max(1, scene.distance)) * 1000;
  const py = (a) => 95 - ((a - minAlt) / relief) * 85;
  let path = `M0,100`;
  const stepK = Math.max(1, Math.floor(scene.n / 400));
  for (let k = 0; k < scene.n; k += stepK) path += ` L${px(scene.d[k]).toFixed(1)},${py(scene.alt[k]).toFixed(1)}`;
  path += ` L1000,100 Z`;
  let cursorD = null;
  if (sample) cursorD = sample.d;
  else if (rc && clock != null) cursorD = rc.dA + rc.progress(rc.ghosts.find((g) => g.isThis), clock);
  const order = rc && clock != null ? standings(rc, clock) : null;
  const raceable = scene.efforts.filter((e) => histories.has(e.effort_id));
  const progressFrac = rc ? (clock ?? 0) / rc.longest : clock == null ? 1 : (sampleAt(scene, clock).d / scene.distance);

  return html`
    <section class=${fullscreen ? "flex flex-col" : "rounded-xl mb-6 overflow-hidden"}
      style=${fullscreen
        ? "position: fixed; inset: 0; z-index: 70; background: #12110f; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);"
        : "background: #12110f; border: 1px solid var(--border);"}>
      <div class="flex items-center justify-between gap-3 px-4 py-2">
        <h2 style="font-family: var(--font-body); font-size: 0.75rem; font-weight: 600; color: rgba(255,255,255,0.75); text-transform: uppercase; letter-spacing: 0.05em;">
          ${rc ? html`Ghost race · ${rc.effort.name}` : "Ride replay"}
        </h2>
        <div class="flex items-center gap-3">
          <button aria-label=${fullscreen ? "Exit full screen" : "Full screen"} title=${fullscreen ? "Exit full screen" : "Full screen"}
            onClick=${() => setFullscreen(!fullscreen)} style="color: rgba(255,255,255,0.75); background: none; border: none; padding: 4px; display: flex;">
            ${fullscreen
              ? html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/></svg>`
              : html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`}
          </button>
        </div>
      </div>

      <div ref=${wrapRef} class="relative" style=${fullscreen ? "flex: 1; min-height: 0;" : "aspect-ratio: 4 / 3; max-height: 62vh;"}>
        <canvas ref=${gridRef} class="absolute inset-0" style="width: 100%; height: 100%;" />
        <canvas key=${force2d ? "c2d" : "gpu"} ref=${mainRef} class="absolute inset-0" style="width: 100%; height: 100%;" />
        <canvas ref=${overlayRef} class="absolute inset-0" style="width: 100%; height: 100%; touch-action: pan-y; cursor: grab;" />

        ${sample && html`
          <div data-testid="replay-hud" class="absolute left-3 top-3 text-xs rounded-lg px-2 py-1" style="font-family: var(--font-mono); background: rgba(18,17,15,0.7); color: rgba(255,255,255,0.85); pointer-events: none; line-height: 1.5;">
            <div>${formatTime(sample.t)}</div>
            <div>${formatSpeed(sample.v)}</div>
            ${scene.hasPower && html`<div>${Math.round(sample.w)} W</div>`}
            ${scene.hasAltitude && html`<div>${sample.g.toFixed(1)}% · ${formatElevation(sample.alt)}</div>`}
          </div>`}

        ${!rc && clock == null && html`
          <div class="absolute left-3 top-3 text-xs" style="${muted} pointer-events: none; max-width: 60%;">
            Ribbon width is power${scene.hasPower ? "" : " (no power data on this ride)"}; height is elevation. Press play to ride it at its own pace.
          </div>`}

        <div class="absolute right-3 top-3 flex flex-col gap-2 items-end" style="pointer-events: none;">
          ${toasts.map((t) => html`<div class="rounded-lg px-3 py-2 text-xs" style="background: rgba(18,17,15,0.85); border: 1px solid ${t.color || "rgba(255,255,255,0.2)"}; color: #fff; font-family: var(--font-body);">
            <div style="color: ${t.color || "#fff"}; font-weight: 600;">${t.labels.join(" · ")}</div>
            <div style="color: rgba(255,255,255,0.7);">${t.name}</div>
          </div>`)}
        </div>

      </div>

      ${order && html`
        <ol data-testid="leaderboard" class="text-xs px-3 py-2" style="font-family: var(--font-mono); color: rgba(255,255,255,0.8); display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); column-gap: 1rem; row-gap: 2px; border-top: 1px solid rgba(255,255,255,0.08);">
          ${order.filter((s) => s.g.marked).map((s) => html`
            <li class="flex justify-between gap-3" style="color: ${ghostText(s.g)}; font-weight: ${s.g.isThis ? 600 : 400};">
              <span>${s.g.isBest ? "PR" : `${s.rank}.`} ${ghostLabel(s.g)}</span>
              <span>${s.done ? formatTime(s.g.elapsed) : `${Math.round(s.frac * 100)}%`}</span>
            </li>`)}
          <li style="color: rgba(255,255,255,0.4);">${rc.ghosts.length} efforts</li>
        </ol>`}

      <svg viewBox="0 0 1000 100" preserveAspectRatio="none" style="width: 100%; height: 56px; display: block; cursor: pointer; touch-action: none;"
        onPointerDown=${(e) => { const r = e.currentTarget.getBoundingClientRect(); scrubTo(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))); }}>
        <path d=${path} fill="rgba(252,76,2,0.18)" stroke="rgba(252,76,2,0.7)" stroke-width="1.5" vector-effect="non-scaling-stroke" />
        ${scene.efforts.filter((e) => e.color || (rc && e.effort_id === rc.effort.effort_id)).map((e) => {
          const a = px(sampleAt(scene, e.tA).d), b = px(sampleAt(scene, e.tB).d);
          return html`<rect x=${a} y="0" width=${Math.max(2, b - a)} height="100" fill=${e.color || "#ffffff"} opacity="0.22" />`;
        })}
        ${cursorD != null && html`<line x1=${px(cursorD)} x2=${px(cursorD)} y1="0" y2="100" stroke="#fff" stroke-width="2" vector-effect="non-scaling-stroke" />`}
      </svg>

      <div class="flex items-center gap-3 px-3 py-2">
        <button aria-label=${playing ? "Pause replay" : "Play replay"} onClick=${() => (playing ? pause() : play())}
          class="flex items-center justify-center rounded-full flex-shrink-0"
          style="width: 36px; height: 36px; background: var(--strava); color: white; border: none;">
          ${playing
            ? html`<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="1" width="3.5" height="12" rx="1"/><rect x="8.5" y="1" width="3.5" height="12" rx="1"/></svg>`
            : html`<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 1.5v11a.5.5 0 00.77.42l8.5-5.5a.5.5 0 000-.84l-8.5-5.5A.5.5 0 003 1.5z"/></svg>`}
        </button>
        <div class="flex-1 rounded-full" style="height: 4px; background: rgba(255,255,255,0.12);">
          <div class="rounded-full" style="height: 4px; width: ${Math.round(Math.min(1, progressFrac) * 100)}%; background: var(--strava);" />
        </div>
        ${!rc && html`<button class="text-xs flex-shrink-0" title="Replay length" style="font-family: var(--font-mono); color: rgba(255,255,255,0.6);"
          onClick=${() => setReplaySeconds(replaySeconds === 15 ? 30 : replaySeconds === 30 ? 60 : 15)}>${replaySeconds}s</button>`}
        ${(clock != null || rc) && html`<button class="text-xs flex-shrink-0" aria-label="Reset replay" style="color: rgba(255,255,255,0.6);" onClick=${reset}>✕</button>`}
      </div>

      ${raceable.length > 0 && html`
        <div class="px-3 pb-3">
          <p class="text-xs mb-1" style=${muted}>Race your history on a segment</p>
          <div class="flex flex-wrap gap-2" style="max-height: ${fullscreen ? "6.75rem" : "9rem"}; overflow-y: auto; overscroll-behavior: contain;">
            ${raceable.map((e) => html`<button onClick=${() => startRace(e)}
              class="px-2 py-1 rounded-full text-xs"
              style="font-family: var(--font-body); border: 1px solid ${rc && rc.effort.effort_id === e.effort_id ? "var(--strava)" : e.color || "rgba(255,255,255,0.2)"}; color: ${e.color || "rgba(255,255,255,0.75)"}; background: ${rc && rc.effort.effort_id === e.effort_id ? "rgba(252,76,2,0.2)" : "transparent"};">
              ${e.name} · ${histories.get(e.effort_id).length}
            </button>`)}
          </div>
        </div>`}
    </section>
  `;
}
