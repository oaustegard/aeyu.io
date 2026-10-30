import { html } from "htm/preact";
import { getRideStreams, getSyncState } from "../db.js";
import { wattsPerSecond } from "../ride-streams.js";
import { wbalSeries, maxDeficit } from "../wbal.js";
import { estimateCriticalPower } from "../critical-power.js";
import { getAllTimeBestCurve } from "../power-curve.js";

const W = 640, H = 180, ML = 40, MR = 12, MT = 10, MB = 22;
const CW = W - ML - MR, CH = H - MT - MB;
const MAX_POINTS = 600;
let wbalSeq = 0;

export function fmtClock(s) {
  const t = Math.round(s);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

const fmtHM = (s) => `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;

export function WbalChart({ series, wPrime, at, testid }) {
  const n = series.length;
  if (n < 2) return null;
  const stride = Math.max(1, Math.ceil(n / MAX_POINTS));
  const lo = Math.min(0, series[at] ?? 0);
  const yMin = lo < 0 ? lo : 0;
  const xOf = (i) => ML + (i / (n - 1)) * CW;
  const yOf = (v) => MT + CH - ((v - yMin) / (wPrime - yMin)) * CH;
  let d = "";
  for (let i = 0; i < n; i += stride) {
    let m = series[i];
    for (let j = i + 1; j < Math.min(n, i + stride); j++) if (series[j] < m) m = series[j];
    d += `${i ? "L" : "M"}${xOf(i).toFixed(1)},${yOf(m).toFixed(1)}`;
  }
  const gid = `wbal-${++wbalSeq}`;
  const area = `${d}L${xOf(n - 1).toFixed(1)},${yOf(yMin).toFixed(1)}L${ML},${yOf(yMin).toFixed(1)}Z`;
  const tickStep = [300, 600, 900, 1800, 3600, 7200, 10800].find((v) => n / v <= 6) || 21600;
  const xTicks = [];
  for (let t = 0; t < n; t += tickStep) xTicks.push(t);
  const txt = "font-size: 10px; fill: var(--text-tertiary); font-family: var(--font-mono);";
  return html`
    <svg data-testid=${testid} viewBox="0 0 ${W} ${H}" style="width: 100%; height: auto; display: block;">
      <line x1=${ML} y1=${yOf(wPrime)} x2=${W - MR} y2=${yOf(wPrime)} stroke="var(--border)" stroke-width="0.5" />
      <line x1=${ML} y1=${yOf(0)} x2=${W - MR} y2=${yOf(0)} stroke="var(--text-tertiary)" stroke-width="1" stroke-dasharray="4,3" />
      <text x=${ML - 5} y=${yOf(wPrime) + 3} text-anchor="end" style=${txt}>${(wPrime / 1000).toFixed(1)}</text>
      <text x=${ML - 5} y=${yOf(0) + 3} text-anchor="end" style=${txt}>0</text>
      <text x="4" y=${H - 6} style=${txt}>kJ</text>
      ${xTicks.map((t) => html`<text x=${xOf(Math.min(t, n - 1))} y=${H - 6} text-anchor="middle" style=${txt}>${fmtHM(t)}</text>`)}
      <defs>
        <linearGradient id=${gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#B85A28" stop-opacity="0.22" />
          <stop offset="100%" stop-color="#B85A28" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <path d=${area} fill=${`url(#${gid})`} />
      <path class="chart-draw" pathLength="1" d=${d} fill="none" stroke="#B85A28" stroke-width="1.5" stroke-linejoin="round" />
      <circle cx=${xOf(at)} cy=${yOf(series[at])} r="4" fill="#B85A28" stroke="var(--surface)" stroke-width="1.5" />
    </svg>`;
}

/**
 * W′ balance through one ride against the saved W′ balance fit, or the MMP
 * fit until the power page has saved one. series[i] is the balance i seconds
 * after t0, the ride's first stream timestamp. null without streams or a CP.
 */
export async function loadRideWbal(activityId) {
  const rec = await getRideStreams(activityId);
  const watts = rec?.watts ? wattsPerSecond(rec) : null;
  if (!watts || !watts.length) return null;
  const saved = (await getSyncState()).wbal_fit;
  let cp = saved?.cp, wPrime = saved?.wPrime, label = "W′ balance fit";
  if (!(cp > 0 && wPrime > 0)) {
    const est = estimateCriticalPower(await getAllTimeBestCurve());
    if (!est) return null;
    ({ cp, wPrime } = est);
    label = "best-effort fit";
  }
  const { max, at } = maxDeficit(watts, cp, wPrime);
  return { series: wbalSeries(watts, cp, wPrime), t0: rec.time_jumps[1], cp, wPrime, label, min: wPrime - max, at };
}
