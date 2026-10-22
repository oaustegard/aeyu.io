import { html } from "htm/preact";

const W = 640, H = 180, ML = 40, MR = 12, MT = 10, MB = 22;
const CW = W - ML - MR, CH = H - MT - MB;
const MAX_POINTS = 600;

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
      <path d=${d} fill="none" stroke="#B85A28" stroke-width="1.5" stroke-linejoin="round" />
      <circle cx=${xOf(at)} cy=${yOf(series[at])} r="4" fill="#B85A28" stroke="var(--surface)" stroke-width="1.5" />
    </svg>`;
}
