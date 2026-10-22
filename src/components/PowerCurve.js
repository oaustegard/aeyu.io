import { html } from "htm/preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { getAllActivities, forEachRideStreams, updateSyncState } from "../db.js";
import { backfillRideStreams, isSyncing } from "../sync.js";
import { isDemo } from "../demo.js";
import { navigate } from "../app.js";
import { wattsPerSecond } from "../ride-streams.js";
import { KJ_BINS, DURATIONS, packRides, computeTableCPU, reduceCurves, fitBin } from "../fatigue-curve.js";
import { webgpuAvailable, createFatigueGPU } from "../fatigue-gpu.js";
import { wbalSeries, pickFitRides, fitWbalAsync } from "../wbal.js";
import { StickyHeader } from "./StickyHeader.js";
import { WbalChart, fmtClock } from "./WbalChart.js";

const BIN_COLORS = ["#2B2620", "#B85A28", "#D98B3A", "#E3B04E"];
const BIN_LABELS = KJ_BINS.map((kj) => (kj === 0 ? "Fresh" : `After ${kj.toLocaleString("en-US")} kJ`));
const W = 640, ML = 52, MR = 12, MT = 10, MB = 26;
const CW = W - ML - MR;
const MAX_T = DURATIONS[DURATIONS.length - 1];
// log(t + 10 s): still log-like, but the first seconds don't take a quarter of the width
const X_SHIFT = 10;
const X_SPAN = Math.log((MAX_T + X_SHIFT) / (1 + X_SHIFT));

function fmtDuration(s) {
  if (s < 60) return `${s}s`;
  if (s < 3600) return s % 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 60)}m`;
  const m = Math.round((s % 3600) / 60);
  return m ? `${Math.floor(s / 3600)}h ${m}m` : `${Math.floor(s / 3600)}h`;
}

function nearestDuration(t) {
  let lo = 0, hi = DURATIONS.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (DURATIONS[mid] < t) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.log(t / DURATIONS[lo - 1]) < Math.log(DURATIONS[lo] / t)) lo--;
  return lo;
}

async function computeTable(packed, onProgress) {
  let t0 = performance.now();
  if (webgpuAvailable()) {
    let gpu = null;
    try {
      gpu = await createFatigueGPU();
      if (gpu) {
        const table = await gpu.computeTable(packed);
        gpu.destroy();
        return { table, engine: "WebGPU", ms: performance.now() - t0 };
      }
    } catch (e) {
      console.warn("WebGPU compute failed, using CPU:", e);
      try { gpu?.destroy(); } catch (_) {}
    }
  }
  t0 = performance.now();
  const out = new Uint32Array(packed.count * packed.K * DURATIONS.length);
  let last = performance.now();
  for (let r = 0; r < packed.count; r++) {
    computeTableCPU(packed, DURATIONS, r, r + 1, out);
    if (performance.now() - last > 40) {
      onProgress((r + 1) / packed.count);
      await new Promise((res) => setTimeout(res));
      last = performance.now();
    }
  }
  return { table: out, engine: "CPU", ms: performance.now() - t0 };
}

async function loadAll(onProgress) {
  const acts = await getAllActivities();
  const byId = new Map(acts.map((a) => [a.id, a]));
  const rides = [], meta = [], watts = [];
  await forEachRideStreams((rec) => {
    if (!rec.watts) return;
    const w = wattsPerSecond(rec);
    if (!w) return;
    const a = byId.get(rec.id) || {};
    rides.push({ watts: w });
    watts.push(w);
    meta.push({
      id: rec.id,
      name: a.name || `Ride ${rec.id}`,
      date: (a.start_date_local || "").slice(0, 10),
      indoor: !!a.trainer || a.sport_type === "VirtualRide",
    });
  });
  const powerRides = acts.filter((a) => a.device_watts).length;
  const packed = packRides(rides);
  const res = packed.count ? await computeTable(packed, onProgress) : { table: new Uint32Array(0), engine: null, ms: 0 };
  return { packed, meta, watts, powerRides, ...res };
}

function Chip({ on, label, onClick, color }) {
  return html`<button
    onClick=${onClick}
    class="px-2 py-1 rounded-full text-xs inline-flex items-center gap-1"
    style="font-family: var(--font-body); border: 1px solid ${on ? (color || "var(--accent)") : "var(--border)"}; background: ${on ? "var(--surface)" : "transparent"}; color: ${on ? "var(--text)" : "var(--text-tertiary)"};"
  >${color && html`<span style="width: 8px; height: 8px; border-radius: 50%; background: ${on ? color : "var(--border)"};"></span>`}${label}</button>`;
}

const U_MIN_SPAN = 0.05;
const uOf = (t) => Math.log((t + X_SHIFT) / (1 + X_SHIFT)) / X_SPAN;
const tOfU = (u) => Math.max(1, (1 + X_SHIFT) * Math.exp(u * X_SPAN) - X_SHIFT);
const TICK_CANDIDATES = [[1, "1s"], [2, "2s"], [5, "5s"], [10, "10s"], [15, "15s"], [30, "30s"], [60, "1m"], [120, "2m"], [300, "5m"], [600, "10m"], [1200, "20m"], [1800, "30m"], [3600, "1h"], [7200, "2h"], [10800, "3h"], [18000, "5h"]];

function Chart({ curves, visible, meta, full }) {
  const rootRef = useRef(null);
  const prevDi = useRef(null);
  const pointers = useRef(new Map());
  const gesture = useRef({ moved: false, pinch: 0 });
  const winRef = useRef([0, 1]);
  const [win, setWinState] = useState([0, 1]);
  const [hover, setHover] = useState(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const setWin = (w) => { winRef.current = w; setWinState(w); };
  const zoomAt = (uc, factor) => {
    const [a, b] = winRef.current;
    const span = Math.min(1, Math.max(U_MIN_SPAN, (b - a) / factor));
    const a2 = Math.min(1 - span, Math.max(0, uc - ((uc - a) / (b - a)) * span));
    setWin(span >= 1 ? [0, 1] : [a2, a2 + span]);
  };
  const panBy = (du) => {
    const [a, b] = winRef.current;
    const a2 = Math.min(1 - (b - a), Math.max(0, a + du));
    setWin([a2, a2 + (b - a)]);
  };

  // The viewBox scales down on a phone; scale axis text back up to stay legible
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const [u0, u1] = win;
  const zoomed = u1 - u0 < 1;
  const fs = box.w > 0 ? Math.min(20, Math.max(9, (10 * W) / box.w)) : 9;
  const H = full && box.w > 0 && box.h > 0 ? Math.max(220, Math.round((W * box.h) / box.w)) : 320;
  const CH = H - MT - MB;
  const xOf = (t) => ML + ((uOf(t) - u0) / (u1 - u0)) * CW;
  const tOf = (x) => tOfU(u0 + ((x - ML) / CW) * (u1 - u0));

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const [a, b] = winRef.current;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && b - a < 1) {
        panBy((e.deltaX / r.width) * (W / CW) * (b - a));
        return;
      }
      const vx = ((e.clientX - r.left) / r.width) * W;
      const uc = a + (Math.min(Math.max(vx, ML), W - MR) - ML) / CW * (b - a);
      zoomAt(uc, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025)));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const shown = curves.map((c, k) => (visible[k] ? k : -1)).filter((k) => k >= 0);
  let max = 0;
  for (const k of shown) {
    for (let i = 0; i < DURATIONS.length; i++) {
      const u = uOf(DURATIONS[i]);
      if (u >= u0 - 1e-9 && u <= u1 + 1e-9 && curves[k].watts[i] > max) max = curves[k].watts[i];
    }
  }
  const step = max <= 100 ? 20 : max <= 250 ? 50 : max <= 500 ? 100 : max <= 1000 ? 200 : 250;
  const yMax = Math.max(step, Math.ceil(max / step) * step);
  const yOf = (w) => MT + CH - (w / yMax) * CH;
  const yTicks = [];
  for (let v = 0; v <= yMax; v += step) yTicks.push(v);

  // Deep zoom can fall between the named ticks; then step evenly in seconds
  const t0 = tOfU(u0), t1 = tOfU(u1);
  let candidates = TICK_CANDIDATES.filter(([t]) => t >= t0 - 1e-6 && t <= t1 + 1e-6);
  if (candidates.length < 3) {
    const step = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600].find((st) => (t1 - t0) / st <= 5) || 3600;
    candidates = [];
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) candidates.push([t, fmtDuration(t)]);
  }
  const ticks = [];
  let lastX = -Infinity;
  for (const [t, label] of candidates) {
    const u = uOf(t);
    if (u < u0 - 1e-9 || u > u1 + 1e-9) continue;
    const x = xOf(t);
    if (x - lastX < 34 * (fs / 9)) continue;
    ticks.push([t, label, x]);
    lastX = x;
  }

  const paths = shown.map((k) => {
    const c = curves[k];
    let d = "", pen = false;
    for (let i = 0; i < DURATIONS.length; i++) {
      const w = c.watts[i];
      if (w <= 0) { pen = false; continue; }
      d += `${pen ? "L" : "M"}${xOf(DURATIONS[i]).toFixed(1)},${yOf(w).toFixed(1)}`;
      pen = true;
    }
    return [k, d];
  });

  function locate(e) {
    const r = rootRef.current.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W, vy = ((e.clientY - r.top) / r.height) * H;
    if (vx < ML || vx > W - MR) return null;
    const di = nearestDuration(tOf(vx));
    let best = null, bd = Infinity;
    for (const k of shown) {
      const w = curves[k].watts[di];
      if (w <= 0) continue;
      const dist = Math.abs(yOf(w) - vy);
      if (dist < bd) { bd = dist; best = k; }
    }
    return { di, k: best };
  }

  const uAtClientX = (x) => {
    const r = rootRef.current.getBoundingClientRect();
    const vx = ((x - r.left) / r.width) * W;
    return u0 + (Math.min(Math.max(vx, ML), W - MR) - ML) / CW * (u1 - u0);
  };

  const onDown = (e) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current.moved = false;
    if (pointers.current.size === 2) {
      const [p, q] = [...pointers.current.values()];
      gesture.current.pinch = Math.hypot(p.x - q.x, p.y - q.y);
      setHover(null);
      return;
    }
    prevDi.current = hover?.di ?? null;
    if (!zoomed || e.pointerType === "mouse") setHover(locate(e));
  };
  const onMove = (e) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) { setHover(locate(e)); return; }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2) {
      const [p, q] = [...pointers.current.values()];
      const dist = Math.hypot(p.x - q.x, p.y - q.y);
      if (gesture.current.pinch > 0 && dist > 0) zoomAt(uAtClientX((p.x + q.x) / 2), dist / gesture.current.pinch);
      gesture.current.pinch = dist;
      gesture.current.moved = true;
      return;
    }
    if (zoomed) {
      const dx = e.clientX - prev.x;
      if (Math.abs(dx) > 0) {
        const r = rootRef.current.getBoundingClientRect();
        panBy(-((dx / r.width) * (W / CW)) * (u1 - u0));
        gesture.current.moved = true;
      }
      setHover(null);
      return;
    }
    setHover(locate(e));
  };
  const onUp = (e) => {
    pointers.current.delete(e.pointerId);
    gesture.current.pinch = 0;
  };
  const onLeave = (e) => { onUp(e); setHover(null); };
  const onClick = (e) => {
    if (gesture.current.moved) { gesture.current.moved = false; return; }
    const h = locate(e);
    if (!h || h.k == null) return;
    if (e.pointerType === "touch" && prevDi.current !== h.di) return;
    const r = curves[h.k].ride[h.di];
    if (r >= 0) navigate(`/activity?id=${meta[r].id}`);
  };

  const hx = hover ? xOf(DURATIONS[hover.di]) : 0;
  const rows = hover ? shown.map((k) => {
    const w = curves[k].watts[hover.di], r = curves[k].ride[hover.di];
    return { k, w, ride: r >= 0 ? meta[r] : null };
  }) : [];
  const clipId = full ? "power-clip-full" : "power-clip";

  return html`
    <div ref=${rootRef} class="relative" style="touch-action: ${zoomed || full ? "none" : "pan-y"}; ${full ? "flex: 1; min-height: 0;" : ""}">
      <svg data-testid="power-chart" viewBox="0 0 ${W} ${H}"
        style="${full ? "position: absolute; inset: 0; height: 100%;" : "height: auto;"} width: 100%; display: block; cursor: ${zoomed ? "grab" : hover?.k != null ? "pointer" : "default"};"
        onPointerMove=${onMove} onPointerDown=${onDown} onPointerUp=${onUp} onPointerCancel=${onUp} onPointerLeave=${onLeave} onClick=${onClick}>
        <defs><clipPath id=${clipId}><rect x=${ML} y=${MT} width=${CW} height=${CH} /></clipPath></defs>
        ${yTicks.map((v) => html`
          <line x1=${ML} y1=${yOf(v)} x2=${W - MR} y2=${yOf(v)} stroke="var(--border)" stroke-width="0.5" stroke-dasharray=${v ? "3,3" : ""} />
          <text x=${ML - 5} y=${yOf(v) + fs / 3} text-anchor="end" style="font-size: ${fs}px; fill: var(--text-tertiary); font-family: var(--font-mono);">${v}</text>`)}
        ${ticks.map(([t, label, x]) => html`
          <line x1=${x} y1=${MT} x2=${x} y2=${MT + CH} stroke="var(--border-light)" stroke-width="0.5" />
          <text x=${x} y=${H - 8} text-anchor="middle" style="font-size: ${fs}px; fill: var(--text-tertiary); font-family: var(--font-mono);">${label}</text>`)}
        <text x="4" y=${H - 8} style="font-size: ${fs}px; fill: var(--text-tertiary); font-family: var(--font-mono);">W</text>
        <g clip-path="url(#${clipId})">
          ${paths.map(([k, d]) => html`<path d=${d} fill="none" stroke=${BIN_COLORS[k]} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />`)}
        </g>
        ${hover && html`
          <line x1=${hx} y1=${MT} x2=${hx} y2=${MT + CH} stroke="var(--text-tertiary)" stroke-width="0.75" />
          ${rows.filter((r) => r.w > 0).map((r) => html`<circle cx=${hx} cy=${yOf(r.w)} r=${r.k === hover.k ? 4 : 3} fill=${BIN_COLORS[r.k]} stroke="var(--surface)" stroke-width="1" />`)}`}
      </svg>
      ${zoomed && html`<button data-testid="power-reset-zoom" onClick=${() => setWin([0, 1])} class="absolute px-2 py-1 rounded-full text-xs"
        style="left: ${((ML + 6) / W) * 100}%; top: ${(MT / H) * 100}%; margin-top: 4px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-family: var(--font-body);">Reset zoom</button>`}
      ${hover && html`
        <div data-testid="power-tooltip" class="absolute rounded-lg px-2 py-1.5 pointer-events-none"
          style="top: ${(MT / H) * 100}%; margin-top: 4px; right: ${(MR / W) * 100}%; margin-right: 4px; background: var(--surface); border: 1px solid var(--border); box-shadow: 0 2px 8px rgba(26,22,16,0.12); font-family: var(--font-body); font-size: 0.7rem; color: var(--text); max-width: 220px;">
          <div style="font-family: var(--font-mono); color: var(--text-secondary);">${fmtDuration(DURATIONS[hover.di])}</div>
          ${rows.map((r) => html`
            <div style="margin-top: 2px; ${r.k === hover.k ? "font-weight: 600;" : ""}">
              <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${BIN_COLORS[r.k]}; margin-right: 4px;"></span>${BIN_LABELS[r.k]}:${" "}
              ${r.w > 0 ? html`<span style="font-family: var(--font-mono);">${Math.round(r.w)} W</span>` : "—"}
              ${r.ride && html`<div style="color: var(--text-tertiary); margin-left: 12px; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${r.ride.name} · ${r.ride.date}</div>`}
            </div>`)}
        </div>`}
    </div>`;
}

export function PowerCurve() {
  const [data, setData] = useState(null);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [indoor, setIndoor] = useState(true);
  const [outdoor, setOutdoor] = useState(true);
  const [visible, setVisible] = useState(KJ_BINS.map(() => true));
  const [full, setFull] = useState(false);
  const loadId = useRef(0);

  async function load() {
    const id = ++loadId.current;
    setProgress(0);
    try {
      const d = await loadAll((p) => { if (id === loadId.current) setProgress(p); });
      if (id !== loadId.current) return;
      setData(d);
      setProgress(null);
    } catch (e) {
      console.error("Power curve failed:", e);
      setError(e.message);
      setProgress(null);
    } finally {
      if (window.dismissLoadingOverlay) window.dismissLoadingOverlay();
    }
  }

  useEffect(() => { load(); }, []);

  async function download() {
    setDownloading(true);
    try { await backfillRideStreams(); await load(); }
    catch (e) { setError(e.message); }
    finally { setDownloading(false); }
  }

  const years = useMemo(() => {
    if (!data) return [];
    const set = new Set(data.meta.map((m) => m.date.slice(0, 4)).filter(Boolean));
    return [...set].sort().reverse();
  }, [data]);

  const result = useMemo(() => {
    if (!data || !data.packed.count) return null;
    const mask = new Uint8Array(data.packed.count);
    let included = 0;
    data.meta.forEach((m, i) => {
      if (from && m.date < from) return;
      if (to && m.date > to) return;
      if (m.indoor ? !indoor : !outdoor) return;
      mask[i] = 1;
      included++;
    });
    const curves = reduceCurves(data.table, data.packed, mask);
    const fits = curves.map((c) => fitBin(c));
    return { curves, fits, included, mask };
  }, [data, from, to, indoor, outdoor]);

  useEffect(() => {
    if (data) window.__power = { engine: data.engine, ms: data.ms, rides: data.packed.count, cp: result?.fits.map((f) => f && { cp: f.cp, wPrime: f.wPrime, rSquared: f.rSquared }) };
  }, [data, result]);

  // CSS full screen, not the Fullscreen API: iPhone Safari only grants that to video
  useEffect(() => {
    if (!full) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => { if (e.key === "Escape") setFull(false); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [full]);

  const [wfit, setWfit] = useState(null);
  const [wPending, setWPending] = useState(false);
  const unfiltered = !from && !to && indoor && outdoor;
  const cpGuess = result?.fits[0]?.cp || 250;
  useEffect(() => {
    if (!data || !result) return;
    let stale = false;
    setWPending(true);
    const timer = setTimeout(async () => {
      const idx = pickFitRides(data.table, data.packed, DURATIONS, result.mask);
      const fit = idx.length ? await fitWbalAsync(idx.map((i) => data.watts[i]), cpGuess) : null;
      if (stale) return;
      setWPending(false);
      if (!fit) { setWfit(null); return; }
      setWfit({ ...fit, idx });
      if (unfiltered) {
        updateSyncState({ wbal_fit: { cp: fit.cp, wPrime: fit.wPrime, rides: idx.length, at: new Date().toISOString() } })
          .catch((e) => console.warn("Couldn't save W′ balance fit:", e));
      }
    }, 250);
    return () => { stale = true; clearTimeout(timer); };
  }, [data, result, cpGuess, unfiltered]);

  const wbal = useMemo(() => {
    if (!wfit) return null;
    let k = 0;
    wfit.perRide.forEach((p, i) => { if (p.minBalance < wfit.perRide[k].minBalance) k = i; });
    const ri = wfit.idx[k];
    const w = data.watts[ri];
    const below = wfit.perRide.filter((p) => p.minBalance < -0.05 * wfit.wPrime).length;
    return { ri, at: wfit.perRide[k].at, series: wbalSeries(w, wfit.cp, wfit.wPrime), below };
  }, [wfit, data]);

  useEffect(() => {
    if (window.__power) window.__power.wbal = wfit && !wPending ? { cp: wfit.cp, wPrime: wfit.wPrime, rides: wfit.idx.length } : null;
  }, [wfit, wPending]);

  const header = html`<${StickyHeader} onBack=${() => navigate(isDemo.value ? "/demo" : "/dashboard")} backLabel="Dashboard" contextLabel="Power curve" />`;
  const card = "rounded-xl p-4";
  const cardStyle = "background: var(--surface); border: 1px solid var(--border);";
  const muted = "font-family: var(--font-body); font-size: 0.8rem; color: var(--text-secondary);";

  if (!data) {
    return html`<div class="min-h-screen" style="background: var(--bg);">${header}
      <p class="text-center py-16" style=${muted}>
        ${error ? `Couldn't load streams: ${error}` : progress ? `Computing… ${Math.round(progress * 100)}%` : "Loading rides…"}
      </p></div>`;
  }

  const stored = data.packed.count;
  const missing = Math.max(0, data.powerRides - stored);
  const syncing = isSyncing.value;
  const fresh = result?.fits[0];
  const th = "text-right py-1.5 px-2";

  return html`
    <div class="min-h-screen" style="background: var(--bg);">
      ${header}
      <div class="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-4">
        <div>
          <h1 style="font-family: var(--font-display); font-size: 1.75rem; color: var(--text);">Fatigue power curve</h1>
          <p style=${muted}>Your best average power at every duration, split by how much work you had already done in the ride.</p>
        </div>

        <div class=${card} style=${cardStyle}>
          <p data-testid="power-status" style="font-family: var(--font-body); font-size: 0.85rem; color: var(--text);">
            ${stored} of ${data.powerRides} power rides have full streams stored
          </p>
          ${missing > 0 && html`
            <p class="mt-1" style=${muted}>
              The rest download during sync, one Strava request per ride, paced by the rate limit.
            </p>
            ${!isDemo.value && html`<button onClick=${download} disabled=${syncing || downloading}
              class="mt-2 px-3 py-1.5 rounded-lg text-xs"
              style="background: var(--strava); color: white; border: none; opacity: ${syncing || downloading ? 0.5 : 1}; font-family: var(--font-body);">
              ${downloading ? "Downloading…" : "Download now"}</button>`}`}
        </div>

        ${!result && html`<p class="text-center py-10" style=${muted}>No ride streams yet. Power rides appear here once their streams are stored.</p>`}

        ${result && html`
          <div class=${card + (full ? " flex flex-col" : "")}
            style=${full
              ? "position: fixed; inset: 0; z-index: 70; border-radius: 0; background: var(--surface); padding: calc(env(safe-area-inset-top) + 0.75rem) calc(env(safe-area-inset-right) + 0.75rem) calc(env(safe-area-inset-bottom) + 0.75rem) calc(env(safe-area-inset-left) + 0.75rem);"
              : cardStyle}>
            <div class="flex justify-end mb-1">
              <button data-testid="power-fullscreen" aria-label=${full ? "Exit full screen" : "Full screen"} title=${full ? "Exit full screen" : "Full screen"}
                onClick=${() => setFull(!full)} style="color: var(--text-secondary); background: none; border: none; padding: 4px; display: flex;">
                ${full
                  ? html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`
                  : html`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`}
              </button>
            </div>
            <div class="flex flex-col gap-3 mb-3">
              <div class="flex flex-wrap gap-1">
                ${KJ_BINS.map((_, k) => html`<${Chip} label=${BIN_LABELS[k]} color=${BIN_COLORS[k]} on=${visible[k]}
                  onClick=${() => setVisible(visible.map((v, i) => (i === k ? !v : v)))} />`)}
              </div>
              <div class="flex flex-wrap items-center gap-1">
                <${Chip} label="All" on=${!from && !to} onClick=${() => { setFrom(""); setTo(""); }} />
                ${years.map((y) => html`<${Chip} label=${y} on=${from === `${y}-01-01` && to === `${y}-12-31`}
                  onClick=${() => { setFrom(`${y}-01-01`); setTo(`${y}-12-31`); }} />`)}
                <input type="date" aria-label="From date" value=${from} onInput=${(e) => setFrom(e.target.value)}
                  class="text-xs rounded px-1 py-0.5" style="border: 1px solid var(--border); font-family: var(--font-mono); color: var(--text); background: var(--surface);" />
                <span style=${muted}>→</span>
                <input type="date" aria-label="To date" value=${to} onInput=${(e) => setTo(e.target.value)}
                  class="text-xs rounded px-1 py-0.5" style="border: 1px solid var(--border); font-family: var(--font-mono); color: var(--text); background: var(--surface);" />
              </div>
              <div class="flex flex-wrap gap-1">
                <${Chip} label="Outdoor" on=${outdoor} onClick=${() => setOutdoor(!outdoor)} />
                <${Chip} label="Indoor" on=${indoor} onClick=${() => setIndoor(!indoor)} />
              </div>
            </div>
            <${Chart} full=${full} curves=${result.curves} visible=${visible} meta=${data.meta} />
          </div>

          <div class=${card} style=${cardStyle}>
            <table class="w-full" data-testid="power-cp" style="font-family: var(--font-body); font-size: 0.8rem; color: var(--text);">
              <thead><tr style="color: var(--text-tertiary); font-size: 0.7rem;">
                <th class="text-left py-1.5 px-2 font-medium"></th>
                <th class=${th + " font-medium"}>CP (W)</th>
                <th class=${th + " font-medium"}>W′ (kJ)</th>
                <th class=${th + " font-medium"}>R²</th>
                <th class=${th + " font-medium"}>vs Fresh</th>
              </tr></thead>
              <tbody>
                ${KJ_BINS.map((_, k) => {
                  if (!visible[k]) return null;
                  const f = result.fits[k];
                  const delta = f && fresh && k > 0 ? ((f.cp - fresh.cp) / fresh.cp) * 100 : null;
                  return html`<tr style="border-top: 1px solid var(--border-light);">
                    <td class="text-left py-1.5 px-2"><span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${BIN_COLORS[k]}; margin-right: 6px;"></span>${BIN_LABELS[k]}</td>
                    <td class=${th} style="font-family: var(--font-mono);">${f ? f.cp : "—"}</td>
                    <td class=${th} style="font-family: var(--font-mono);">${f ? (f.wPrime / 1000).toFixed(1) : "—"}</td>
                    <td class=${th} style="font-family: var(--font-mono);">${f?.rSquared != null ? f.rSquared.toFixed(3) : "—"}</td>
                    <td class=${th} style="font-family: var(--font-mono);">${delta != null ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%` : "—"}</td>
                  </tr>`;
                })}
              </tbody>
            </table>
            <p class="mt-2" data-testid="power-included" style="font-family: var(--font-body); font-size: 0.7rem; color: var(--text-tertiary);">
              Fitted from the 3–30 min bests of ${result.included} of ${stored} rides in the current filter.
            </p>
          </div>

          <div class=${card} style=${cardStyle} data-testid="wbal-card">
            <h2 style="font-family: var(--font-body); font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.5rem;">W′ balance fit</h2>
            <p style=${muted}>Replays whole rides second by second and picks the CP and W′ at which your hardest rides drain W′ to about zero without going below.</p>
            ${wPending && html`<p class="mt-2" data-testid="wbal-pending" style=${muted}>Fitting…</p>`}
            ${!wPending && !wfit && html`<p class="mt-2" style=${muted}>Not enough rides in this filter to fit.</p>`}
            ${!wPending && wfit && wbal && html`
              <div class="mt-3" style="font-family: var(--font-body); font-size: 0.8rem; color: var(--text);">
                <div class="flex flex-wrap" style="gap: 0.25rem 1.5rem;">
                  <span>CP <b data-testid="wbal-cp" style="font-family: var(--font-mono);">${wfit.cp}</b> W <span style="color: var(--text-tertiary);">(MMP ${fresh ? fresh.cp : "—"})</span></span>
                  <span>W′ <b data-testid="wbal-wprime" style="font-family: var(--font-mono);">${(wfit.wPrime / 1000).toFixed(1)}</b> kJ <span style="color: var(--text-tertiary);">(MMP ${fresh ? (fresh.wPrime / 1000).toFixed(1) : "—"})</span></span>
                </div>
                <p class="mt-2" style=${muted}>
                  The ride that sets it:${" "}
                  <a data-testid="wbal-ride" href=${`/activity?id=${data.meta[wbal.ri].id}`}
                    onClick=${(e) => { e.preventDefault(); navigate(`/activity?id=${data.meta[wbal.ri].id}`); }}
                    style="color: var(--accent); text-decoration: underline;">${data.meta[wbal.ri].name}</a>
                  ${" "}· ${data.meta[wbal.ri].date} · W′ bottoms out ${fmtClock(wbal.at)} in.
                </p>
                <div class="mt-2"><${WbalChart} series=${wbal.series} wPrime=${wfit.wPrime} at=${wbal.at} testid="wbal-chart" /></div>
                ${wbal.below > 0 && html`<p class="mt-2" style=${muted}>${wbal.below} ${wbal.below === 1 ? "ride goes" : "rides go"} below zero; their efforts exceed this model.</p>`}
              </div>`}
          </div>`}
      </div>
    </div>`;
}
