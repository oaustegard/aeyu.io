import { html } from "htm/preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { getAllActivities, forEachRideStreams } from "../db.js";
import { backfillRideStreams, isSyncing } from "../sync.js";
import { isDemo } from "../demo.js";
import { navigate } from "../app.js";
import { wattsPerSecond } from "../ride-streams.js";
import { KJ_BINS, DURATIONS, packRides, computeTableCPU, reduceCurves, fitBin } from "../fatigue-curve.js";
import { webgpuAvailable, createFatigueGPU } from "../fatigue-gpu.js";
import { StickyHeader } from "./StickyHeader.js";

const BIN_COLORS = ["#2B2620", "#B85A28", "#D98B3A", "#E3B04E"];
const BIN_LABELS = KJ_BINS.map((kj) => (kj === 0 ? "Fresh" : `After ${kj.toLocaleString("en-US")} kJ`));
const TICKS = [[1, "1s"], [5, "5s"], [15, "15s"], [60, "1m"], [300, "5m"], [1200, "20m"], [3600, "1h"], [7200, "2h"], [18000, "5h"]];
const W = 640, H = 320, ML = 52, MR = 12, MT = 10, MB = 26;
const CW = W - ML - MR, CH = H - MT - MB;
const MAX_T = DURATIONS[DURATIONS.length - 1];
const xOf = (t) => ML + (Math.log(t) / Math.log(MAX_T)) * CW;

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
  const rides = [], meta = [];
  await forEachRideStreams((rec) => {
    if (!rec.watts) return;
    const w = wattsPerSecond(rec);
    if (!w) return;
    const a = byId.get(rec.id) || {};
    rides.push({ watts: w });
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
  return { packed, meta, powerRides, ...res };
}

function Chip({ on, label, onClick, color }) {
  return html`<button
    onClick=${onClick}
    class="px-2 py-1 rounded-full text-xs inline-flex items-center gap-1"
    style="font-family: var(--font-body); border: 1px solid ${on ? (color || "var(--accent)") : "var(--border)"}; background: ${on ? "var(--surface)" : "transparent"}; color: ${on ? "var(--text)" : "var(--text-tertiary)"};"
  >${color && html`<span style="width: 8px; height: 8px; border-radius: 50%; background: ${on ? color : "var(--border)"};"></span>`}${label}</button>`;
}

function Chart({ curves, visible, meta }) {
  const svgRef = useRef(null);
  const prevDi = useRef(null);
  const [hover, setHover] = useState(null);
  // The viewBox scales down on a phone; scale axis text back up to stay legible
  const [fs, setFs] = useState(9);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const w = el.getBoundingClientRect().width;
      if (w > 0) setFs(Math.min(20, Math.max(9, (10 * W) / w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shown = curves.map((c, k) => (visible[k] ? k : -1)).filter((k) => k >= 0);
  let max = 0;
  for (const k of shown) for (const w of curves[k].watts) if (w > max) max = w;
  const step = max <= 500 ? 100 : max <= 1000 ? 200 : 250;
  const yMax = Math.max(step, Math.ceil(max / step) * step);
  const yOf = (w) => MT + CH - (w / yMax) * CH;
  const yTicks = [];
  for (let v = 0; v <= yMax; v += step) yTicks.push(v);

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
    const r = svgRef.current.getBoundingClientRect();
    const vx = ((e.clientX - r.left) / r.width) * W, vy = ((e.clientY - r.top) / r.height) * H;
    if (vx < ML || vx > W - MR) return null;
    const di = nearestDuration(Math.exp(((vx - ML) / CW) * Math.log(MAX_T)));
    let best = null, bd = Infinity;
    for (const k of shown) {
      const w = curves[k].watts[di];
      if (w <= 0) continue;
      const dist = Math.abs(yOf(w) - vy);
      if (dist < bd) { bd = dist; best = k; }
    }
    return { di, k: best };
  }

  const onMove = (e) => setHover(locate(e));
  const onDown = (e) => { prevDi.current = hover?.di ?? null; setHover(locate(e)); };
  const onClick = (e) => {
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

  return html`
    <div class="relative" style="touch-action: pan-y;">
      <svg ref=${svgRef} data-testid="power-chart" viewBox="0 0 ${W} ${H}" style="width: 100%; height: auto; display: block; cursor: ${hover?.k != null ? "pointer" : "default"};"
        onPointerMove=${onMove} onPointerDown=${onDown} onPointerLeave=${() => setHover(null)} onClick=${onClick}>
        ${yTicks.map((v) => html`
          <line x1=${ML} y1=${yOf(v)} x2=${W - MR} y2=${yOf(v)} stroke="var(--border)" stroke-width="0.5" stroke-dasharray=${v ? "3,3" : ""} />
          <text x=${ML - 5} y=${yOf(v) + fs / 3} text-anchor="end" style="font-size: ${fs}px; fill: var(--text-tertiary); font-family: var(--font-mono);">${v}</text>`)}
        ${TICKS.map(([t, label]) => html`
          <line x1=${xOf(t)} y1=${MT} x2=${xOf(t)} y2=${MT + CH} stroke="var(--border-light)" stroke-width="0.5" />
          <text x=${xOf(t)} y=${H - 8} text-anchor="middle" style="font-size: ${fs}px; fill: var(--text-tertiary); font-family: var(--font-mono);">${label}</text>`)}
        <text x="4" y=${H - 8} style="font-size: ${fs}px; fill: var(--text-tertiary); font-family: var(--font-mono);">W</text>
        ${paths.map(([k, d]) => html`<path d=${d} fill="none" stroke=${BIN_COLORS[k]} stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />`)}
        ${hover && html`
          <line x1=${hx} y1=${MT} x2=${hx} y2=${MT + CH} stroke="var(--text-tertiary)" stroke-width="0.75" />
          ${rows.filter((r) => r.w > 0).map((r) => html`<circle cx=${hx} cy=${yOf(r.w)} r=${r.k === hover.k ? 4 : 3} fill=${BIN_COLORS[r.k]} stroke="var(--surface)" stroke-width="1" />`)}`}
      </svg>
      ${hover && html`
        <div data-testid="power-tooltip" class="absolute rounded-lg px-2 py-1.5 pointer-events-none"
          style="top: 4px; ${hx > W * 0.55 ? `right: ${((W - hx) / W) * 100 + 2}%;` : `left: ${(hx / W) * 100 + 2}%;`} background: var(--surface); border: 1px solid var(--border); box-shadow: 0 2px 8px rgba(26,22,16,0.12); font-family: var(--font-body); font-size: 0.7rem; color: var(--text); max-width: 220px;">
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
    return { curves, fits, included };
  }, [data, from, to, indoor, outdoor]);

  useEffect(() => {
    if (data) window.__power = { engine: data.engine, ms: data.ms, rides: data.packed.count, cp: result?.fits.map((f) => f && { cp: f.cp, wPrime: f.wPrime, rSquared: f.rSquared }) };
  }, [data, result]);

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
          <div class=${card} style=${cardStyle}>
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
            <${Chart} curves=${result.curves} visible=${visible} meta=${data.meta} />
            <p class="mt-1" data-testid="power-engine" style="font-family: var(--font-mono); font-size: 0.65rem; color: var(--text-tertiary);">
              ${data.engine} · ${Math.round(data.ms)} ms
            </p>
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
          </div>`}
      </div>
    </div>`;
}
