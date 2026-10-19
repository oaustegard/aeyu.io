/**
 * Ride heatmap (#301): every synced track as a density map, filtered live by
 * date, ride type, bike and average speed.
 */

import { html } from "htm/preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { getAllActivities, getSyncState } from "../db.js";
import { backfillMapData } from "../sync.js";
import { isDemo } from "../demo.js";
import { navigate } from "../app.js";
import { unitSystem, setUnitPreference, loadUnitPreference } from "../units.js";
import { buildHeatmapData, fitBounds, matchesFilter, NO_GEAR, MAX_SLOTS } from "../heatmap.js";
import { webgpuAvailable, createWebGPURenderer, createCanvasRenderer } from "../heatmap-render.js";
import { StickyHeader } from "./StickyHeader.js";

const TYPE_LABELS = {
  Ride: "Road", GravelRide: "Gravel", MountainBikeRide: "MTB",
  EBikeRide: "E-bike", EMountainBikeRide: "E-MTB", VirtualRide: "Virtual", Velomobile: "Velomobile",
};
const ALL = 0xffffffff;

function dayToISO(day) {
  return new Date(day * 86400000).toISOString().slice(0, 10);
}

function speedFactor() {
  return unitSystem.value === "imperial" ? 2.23694 : 3.6;
}

function Chip({ on, label, onClick, title }) {
  return html`<button
    onClick=${onClick}
    title=${title || label}
    class="px-2 py-1 rounded-full text-xs"
    style="font-family: var(--font-body); border: 1px solid ${on ? "var(--strava)" : "rgba(255,255,255,0.2)"}; background: ${on ? "rgba(252,76,2,0.2)" : "transparent"}; color: ${on ? "#fff" : "rgba(255,255,255,0.55)"};"
  >${label}</button>`;
}

export function Heatmap() {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const rendererRef = useRef(null);
  const viewRef = useRef(null);
  const frameRef = useRef(0);
  const [data, setData] = useState(null);
  const [gearNames, setGearNames] = useState({});
  const [missing, setMissing] = useState(0);
  const [backfill, setBackfill] = useState(null);
  const [engine, setEngine] = useState(null);
  const [filter, setFilter] = useState(null);
  const [style, setStyle] = useState({ lineWidth: 1.5, gain: 0.3 });
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 640);
  const [units, setUnits] = useState(unitSystem.value);
  const [force2d, setForce2d] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playDay, setPlayDay] = useState(null);
  const [duration, setDuration] = useState(20);
  const animRef = useRef(null);
  const rafRef = useRef(0);
  const playingRef = useRef(false);
  const durationRef = useRef(duration);
  playingRef.current = playing;
  durationRef.current = duration;
  const dataRef = useRef(null);
  dataRef.current = data;

  async function load() {
    if (window.dismissLoadingOverlay) window.dismissLoadingOverlay();
    setUnits(await loadUnitPreference());
    const acts = await getAllActivities();
    const state = await getSyncState();
    setGearNames(Object.fromEntries((state.gears || []).map((g) => [g.id, g.name])));
    setMissing(acts.filter((a) => a.summary_polyline === undefined).length);
    const d = buildHeatmapData(acts);
    const virtualSlot = d.types.indexOf("VirtualRide");
    setFilter({
      dayMin: d.dayRange[0], dayMax: d.dayRange[1],
      speedMin: 0, speedMax: Infinity,
      typeMask: virtualSlot >= 0 ? (ALL & ~(1 << virtualSlot)) >>> 0 : ALL,
      gearMask: ALL,
    });
    // More rides overlap more, so start dimmer; the Intensity slider adjusts
    setStyle((s) => ({ ...s, gain: Math.min(0.5, Math.max(0.03, 2 / Math.sqrt(Math.max(1, d.meta.length)))) }));
    viewRef.current = null;
    setData(d);
  }

  useEffect(() => { load(); }, []);

  // Renderer lifecycle: one GPU upload per dataset
  useEffect(() => {
    if (!data || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      let r = null;
      if (!force2d && webgpuAvailable()) {
        try { r = await createWebGPURenderer(canvasRef.current, data); }
        catch (e) {
          // A canvas that handed out a webgpu context can't give a 2d one; remount it
          console.warn("WebGPU init failed, using Canvas2D:", e);
          if (!cancelled) setForce2d(true);
          return;
        }
      }
      if (cancelled) { if (r) r.destroy(); return; }
      if (!r) r = createCanvasRenderer(canvasRef.current, data);
      rendererRef.current = r;
      setEngine(r.kind);
      resize();
    })();
    return () => {
      cancelled = true;
      if (rendererRef.current) rendererRef.current.destroy();
      rendererRef.current = null;
    };
  }, [data, force2d]);

  function draw() {
    if (frameRef.current) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const r = rendererRef.current, c = canvasRef.current;
      if (!r || !c || !filterRef.current) return;
      if (!viewRef.current) fit();
      renderNow();
    });
  }

  function renderNow() {
    const r = rendererRef.current;
    if (!r || !viewRef.current || !filterRef.current) return;
    const t0 = performance.now();
    r.render(viewRef.current, filterRef.current, { lineWidth: styleRef.current.lineWidth * devicePixelRatio, gain: styleRef.current.gain }, animRef.current);
    const d = dataRef.current;
    window.__heatmap = { engine: r.kind, segments: d.segCount, activities: d.meta.length, frameMs: performance.now() - t0, playhead: animRef.current?.playhead ?? null };
  }

  // Playback: the playhead sweeps the filtered date range in `duration` seconds.
  // Each ride takes ~0.8 s to draw in and glows for a few seconds after.
  function animParams(playhead) {
    const f = filterRef.current;
    const daysPerSec = Math.max(1, f.dayMax - f.dayMin) / durationRef.current;
    return { playhead, drawDays: daysPerSec * 0.8, trailDays: daysPerSec * 1.5 };
  }

  function play() {
    const f = filterRef.current;
    const a = animRef.current;
    const start = a && a.playhead < f.dayMax ? a.playhead : f.dayMin;
    animRef.current = animParams(start);
    playingRef.current = true;
    setPlaying(true);
    let last = performance.now(), lastUi = 0;
    const tick = (now) => {
      if (!playingRef.current) return;
      const cur = animRef.current;
      const daysPerSec = cur.drawDays / 0.8;
      const next = animParams(cur.playhead + ((now - last) / 1000) * daysPerSec);
      last = now;
      animRef.current = next;
      renderNow();
      if (now - lastUi > 100) { setPlayDay(next.playhead); lastUi = now; }
      // Run past the end until the last ride has drawn and stopped glowing
      if (next.playhead > filterRef.current.dayMax + next.drawDays + 3 * next.trailDays) {
        playingRef.current = false;
        setPlaying(false);
        setPlayDay(filterRef.current.dayMax);
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  function pause() {
    playingRef.current = false;
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
  }

  function stopPlayback() {
    pause();
    animRef.current = null;
    setPlayDay(null);
    draw();
  }

  function scrub(day) {
    pause();
    animRef.current = animParams(day);
    setPlayDay(day);
    draw();
  }

  const filterRef = useRef(filter);
  const styleRef = useRef(style);
  filterRef.current = filter;
  styleRef.current = style;
  useEffect(() => { draw(); }, [filter, style, engine]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  function fit() {
    const c = canvasRef.current;
    const d = dataRef.current;
    const b = d && filterRef.current && fitBounds(d.meta, filterRef.current);
    if (!b || !c) { viewRef.current = { cx: 0, cy: 0, scale: 1 }; return; }
    const bw = Math.max(b[2] - b[0], 1e-5), bh = Math.max(b[3] - b[1], 1e-5);
    viewRef.current = {
      cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2,
      scale: 0.9 * Math.min(c.width / bw, c.height / bh),
    };
  }

  function resize() {
    const c = canvasRef.current, w = wrapRef.current;
    if (!c || !w) return;
    const dpr = devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(w.clientWidth * dpr));
    c.height = Math.max(1, Math.round(w.clientHeight * dpr));
    draw();
  }

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(resize);
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, [data]);

  function zoomAt(px, py, factor) {
    const v = viewRef.current, c = canvasRef.current;
    if (!v || !c) return;
    const mx = (px - c.width / 2) / v.scale + v.cx;
    const my = (py - c.height / 2) / v.scale + v.cy;
    v.scale *= factor;
    v.cx = mx - (px - c.width / 2) / v.scale;
    v.cy = my - (py - c.height / 2) / v.scale;
    draw();
  }

  function attachGestures(c) {
    if (c.__gestures) return;
    c.__gestures = true;
    const pointers = new Map();
    let pinch = null;
    const local = (e) => {
      const r = c.getBoundingClientRect();
      return [(e.clientX - r.left) * devicePixelRatio, (e.clientY - r.top) * devicePixelRatio];
    };
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, local(e));
    });
    c.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId) || !viewRef.current) return;
      const prev = pointers.get(e.pointerId);
      const cur = local(e);
      pointers.set(e.pointerId, cur);
      if (pointers.size === 1) {
        viewRef.current.cx -= (cur[0] - prev[0]) / viewRef.current.scale;
        viewRef.current.cy -= (cur[1] - prev[1]) / viewRef.current.scale;
        draw();
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) zoomAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, dist / pinch);
        pinch = dist;
      }
    });
    const up = (e) => { pointers.delete(e.pointerId); pinch = null; };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const [x, y] = local(e);
      zoomAt(x, y, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    c.addEventListener("dblclick", (e) => { const [x, y] = local(e); zoomAt(x, y, 2); });
  }

  useEffect(() => { if (canvasRef.current) attachGestures(canvasRef.current); }, [data !== null, force2d]);

  async function runBackfill() {
    setBackfill({ patched: 0 });
    try {
      const res = await backfillMapData((p) => setBackfill(p));
      setBackfill(res.complete ? null : { error: "Strava rate limit reached — try again in 15 minutes." });
      await load();
    } catch (e) {
      setBackfill({ error: e.message });
    }
  }

  const header = html`<${StickyHeader}
    onBack=${() => navigate(isDemo.value ? "/demo" : "/dashboard")}
    backLabel="Dashboard"
    contextLabel="Heatmap"
    unitSystem=${units}
    onUnitToggle=${async () => {
      await setUnitPreference(unitSystem.value === "metric" ? "imperial" : "metric");
      setUnits(unitSystem.value);
    }}
  />`;

  if (!data || !filter) {
    return html`<div class="min-h-screen" style="background: var(--bg);">${header}
      <p class="text-center py-16" style="color: var(--text-secondary);">Loading tracks…</p></div>`;
  }

  const shown = data.meta.filter((m) => matchesFilter(m, filter)).length;
  const years = [];
  for (let y = +dayToISO(data.dayRange[1]).slice(0, 4); y >= +dayToISO(data.dayRange[0]).slice(0, 4); y--) years.push(y);
  const yearRange = (y) => [Date.UTC(y, 0, 1) / 86400000, Date.UTC(y, 11, 31) / 86400000];
  const sf = speedFactor();
  const spMax = Math.ceil(data.speedRange[1] * sf);
  const unit = units === "imperial" ? "mph" : "km/h";
  const toggleBit = (key, slot) => setFilter({ ...filter, [key]: (filter[key] ^ (1 << slot)) >>> 0 });
  const label = "font-family: var(--font-body); color: rgba(255,255,255,0.6);";

  return html`
    <div class="flex flex-col" style="height: 100vh; height: 100dvh; background: #12110f;">
      ${header}
      <div ref=${wrapRef} class="relative flex-1" style="min-height: 0; overflow: hidden;">
        <canvas key=${force2d ? "c2d" : "gpu"} ref=${canvasRef} style="width: 100%; height: 100%; display: block; touch-action: none; cursor: grab;" />

        ${data.meta.length === 0 && html`
          <div class="absolute inset-0 flex items-center justify-center px-6 text-center" style="color: rgba(255,255,255,0.7); font-family: var(--font-body);">
            ${missing > 0 ? "Your rides were synced before the heatmap existed — load their routes to draw them." : "No GPS tracks yet. Outdoor rides appear here once synced."}
          </div>`}

        ${data.meta.length > 0 && html`
          <div class="absolute left-3 right-3 bottom-3 flex items-center gap-3 rounded-xl px-3 py-2"
            style="background: rgba(18,17,15,0.85); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,0.1); max-width: 720px; margin: 0 auto;">
            <button aria-label=${playing ? "Pause" : "Play"} onClick=${() => (playing ? pause() : play())}
              class="flex items-center justify-center rounded-full flex-shrink-0"
              style="width: 36px; height: 36px; background: var(--strava); color: white; border: none;">
              ${playing
                ? html`<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><rect x="2" y="1" width="3.5" height="12" rx="1"/><rect x="8.5" y="1" width="3.5" height="12" rx="1"/></svg>`
                : html`<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor"><path d="M3 1.5v11a.5.5 0 00.77.42l8.5-5.5a.5.5 0 000-.84l-8.5-5.5A.5.5 0 003 1.5z"/></svg>`}
            </button>
            <input type="range" class="flex-1" aria-label="Playback position" style="accent-color: var(--strava); min-width: 0;"
              min=${filter.dayMin} max=${filter.dayMax}
              value=${playDay == null ? filter.dayMax : Math.min(playDay, filter.dayMax)}
              onInput=${(e) => scrub(+e.target.value)} />
            <span data-testid="playday" class="text-xs flex-shrink-0" style="font-family: var(--font-mono); color: rgba(255,255,255,0.8); min-width: 5.5rem; text-align: right;">
              ${playDay == null ? "All time" : dayToISO(Math.floor(Math.min(playDay, filter.dayMax)))}
            </span>
            <button class="text-xs flex-shrink-0" title="Playback length" style="font-family: var(--font-mono); color: rgba(255,255,255,0.6);"
              onClick=${() => setDuration(duration === 10 ? 20 : duration === 20 ? 40 : 10)}>${duration}s</button>
            ${playDay != null && html`<button class="text-xs flex-shrink-0" aria-label="Show all" title="Back to the full map"
              style="color: rgba(255,255,255,0.6);" onClick=${stopPlayback}>✕</button>`}
          </div>`}

        <div class="absolute left-3 right-3 sm:right-auto top-3" style="max-width: 340px;">
          <div class="rounded-xl p-3" style="background: rgba(18,17,15,0.85); backdrop-filter: blur(6px); border: 1px solid rgba(255,255,255,0.1);">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs" style="font-family: var(--font-mono); color: rgba(255,255,255,0.8);">
                ${shown} of ${data.meta.length} rides${engine ? html` · <span data-testid="engine">${engine === "webgpu" ? "WebGPU" : "Canvas2D"}</span>` : ""}
              </span>
              <div class="flex gap-2">
                <button class="text-xs" style=${label} onClick=${() => { viewRef.current = null; draw(); }}>Fit</button>
                <button class="text-xs" style=${label} onClick=${() => setPanelOpen(!panelOpen)}>${panelOpen ? "Hide" : "Filters"}</button>
              </div>
            </div>

            ${missing > 0 && !isDemo.value && html`
              <div class="mt-2 text-xs" style=${label}>
                ${backfill?.error ? html`<p style="color: #fca5a5;">${backfill.error}</p>` : ""}
                ${backfill && !backfill.error
                  ? html`<p>Loading routes… ${backfill.patched} done</p>`
                  : html`<button onClick=${runBackfill} class="mt-1 px-2 py-1 rounded" style="background: var(--strava); color: white;">
                      Load routes for ${missing} rides</button>`}
              </div>`}

            ${engine === "canvas2d" && html`<p class="mt-2 text-xs" style=${label}>
              WebGPU isn't available in this browser, so this is the slower Canvas2D renderer.</p>`}

            ${panelOpen && html`
              <div class="mt-3 flex flex-col gap-3">
                <div>
                  <p class="text-xs mb-1" style=${label}>${dayToISO(filter.dayMin)} → ${dayToISO(filter.dayMax)}</p>
                  <div class="flex flex-wrap gap-1 mb-2">
                    <${Chip} label="All" on=${filter.dayMin <= data.dayRange[0] && filter.dayMax >= data.dayRange[1]}
                      onClick=${() => setFilter({ ...filter, dayMin: data.dayRange[0], dayMax: data.dayRange[1] })} />
                    ${years.map((y) => {
                      const [a, b] = yearRange(y);
                      return html`<${Chip} label=${String(y)} on=${filter.dayMin === Math.max(a, data.dayRange[0]) && filter.dayMax === Math.min(b, data.dayRange[1])}
                        onClick=${() => setFilter({ ...filter, dayMin: Math.max(a, data.dayRange[0]), dayMax: Math.min(b, data.dayRange[1]) })} />`;
                    })}
                  </div>
                  <input type="range" class="w-full" style="accent-color: var(--strava);" aria-label="From date" min=${data.dayRange[0]} max=${data.dayRange[1]} value=${filter.dayMin}
                    onInput=${(e) => setFilter({ ...filter, dayMin: Math.min(+e.target.value, filter.dayMax) })} />
                  <input type="range" class="w-full" style="accent-color: var(--strava);" aria-label="To date" min=${data.dayRange[0]} max=${data.dayRange[1]} value=${filter.dayMax}
                    onInput=${(e) => setFilter({ ...filter, dayMax: Math.max(+e.target.value, filter.dayMin) })} />
                </div>

                ${data.types.length > 1 && html`<div>
                  <p class="text-xs mb-1" style=${label}>Type</p>
                  <div class="flex flex-wrap gap-1">
                    ${data.types.map((t, i) => html`<${Chip} label=${TYPE_LABELS[t] || t} on=${(filter.typeMask >>> i) & 1} onClick=${() => toggleBit("typeMask", i)} />`)}
                  </div>
                </div>`}

                ${data.gears.length > 1 && html`<div>
                  <p class="text-xs mb-1" style=${label}>Bike</p>
                  <div class="flex flex-wrap gap-1">
                    ${data.gears.slice(0, MAX_SLOTS).map((g, i) => html`<${Chip}
                      label=${g === NO_GEAR ? "No bike" : gearNames[g] || g}
                      on=${(filter.gearMask >>> i) & 1} onClick=${() => toggleBit("gearMask", i)} />`)}
                  </div>
                </div>`}

                <div>
                  <p class="text-xs mb-1" style=${label}>
                    Avg speed ${(filter.speedMin * sf).toFixed(0)}–${Number.isFinite(filter.speedMax) ? (filter.speedMax * sf).toFixed(0) : spMax} ${unit}
                  </p>
                  <input type="range" class="w-full" style="accent-color: var(--strava);" aria-label="Minimum speed" min="0" max=${spMax} step="1" value=${filter.speedMin * sf}
                    onInput=${(e) => setFilter({ ...filter, speedMin: +e.target.value / sf })} />
                  <input type="range" class="w-full" style="accent-color: var(--strava);" aria-label="Maximum speed" min="0" max=${spMax} step="1"
                    value=${Number.isFinite(filter.speedMax) ? filter.speedMax * sf : spMax}
                    onInput=${(e) => setFilter({ ...filter, speedMax: +e.target.value >= spMax ? Infinity : +e.target.value / sf })} />
                </div>

                <div>
                  <p class="text-xs mb-1" style=${label}>Intensity</p>
                  <input type="range" class="w-full" style="accent-color: var(--strava);" aria-label="Intensity" min="0.05" max="3" step="0.05" value=${style.gain}
                    onInput=${(e) => setStyle({ ...style, gain: +e.target.value })} />
                </div>
              </div>`}
          </div>
        </div>
      </div>
    </div>
  `;
}
