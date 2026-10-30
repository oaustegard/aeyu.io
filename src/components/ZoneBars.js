import { html } from "htm/preact";

export const HR_ZONE_COLORS = ["#6E9BC0", "#5B9A68", "#D4A23A", "#D9712E", "#B8352A"];
export const POWER_ZONE_COLORS = ["#A39C92", "#6E9BC0", "#5B9A68", "#D4A23A", "#D9712E", "#C04A30", "#8E2A2E"];

// The wave crosses a bar in its duration / 60 (25 min of Z3 → 25 s); floored so short zones don't strobe
const WAVE_MIN_S = 1.5;
const waveSeconds = (sec) => Math.max(WAVE_MIN_S, sec / 60);

export function formatZoneTime(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

function Bar({ pct, color, sec, i, ghostPct }) {
  return html`
    <div class="zbar-track flex-1">
      ${ghostPct != null && html`<div class="zbar-fill zbar-fill--ghost" style="width: ${ghostPct}%; --c: ${color}; --i: ${i};"></div>`}
      <div class="zbar-fill" style="width: ${Math.max(pct, 1)}%; --c: ${color}; --i: ${i};">
        ${sec > 0 && html`<span class="zbar-wave" style="--d: ${waveSeconds(sec)}s; --i: ${i};"></span>`}
      </div>
    </div>
  `;
}

const rowStyle = "font-family: var(--font-mono); font-size: 11px;";
const labelStyle = "width: 3rem; color: var(--text-tertiary); text-align: right; font-size: 10px;";

export function ZoneBarChart({ title, zones, colors, labels, totalTime }) {
  if (!zones || zones.length === 0) return null;
  const total = totalTime || zones.reduce((s, t) => s + t, 0);
  if (total === 0) return null;
  const maxTime = Math.max(...zones);

  return html`
    <div>
      <h3 class="text-xs font-semibold mb-2" style="color: var(--text-secondary); font-family: var(--font-body); text-transform: uppercase; letter-spacing: 0.05em;">${title}</h3>
      <div class="space-y-1">
        ${zones.map((time, i) => {
          if (time === 0 && zones.length > 7) return null;
          const pct = maxTime > 0 ? (time / maxTime) * 100 : 0;
          const timePct = Math.round((time / total) * 100);
          return html`
            <div class="flex items-center gap-2" style=${rowStyle}>
              <span class="flex-shrink-0" style=${labelStyle}>${labels[i] ? labels[i].split(" ")[0] : `Z${i + 1}`}</span>
              <${Bar} pct=${pct} color=${colors[i] || "#8C8374"} sec=${time} i=${i} />
              <span class="flex-shrink-0" style="width: 3.5rem; color: var(--text-secondary); text-align: right;">${formatZoneTime(time)}</span>
              <span class="flex-shrink-0" style="width: 2rem; color: var(--text-tertiary); text-align: right; font-size: 10px;">${timePct}%</span>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

/**
 * Longest unbroken block (solid) over total time (ghost) at or above each HR
 * floor, easiest floor first. The floors are 70/80/87/93% of max HR, so they
 * take the Z2–Z5 colours.
 */
export function SustainedBlocksChart({ byThreshold }) {
  if (!byThreshold || byThreshold.length === 0) return null;
  const rows = [...byThreshold].sort((a, b) => a.threshold - b.threshold);
  const max = Math.max(...rows.map((b) => b.totalSec));
  if (max === 0) return null;
  const offset = Math.max(0, HR_ZONE_COLORS.length - rows.length);
  return html`
    <div class="space-y-1">
      ${rows.map((b, i) => html`
        <div class="flex items-center gap-2" style=${rowStyle}>
          <span class="flex-shrink-0" style=${labelStyle}>≥${b.threshold}</span>
          <${Bar} pct=${(b.longestSec / max) * 100} ghostPct=${(b.totalSec / max) * 100}
            color=${HR_ZONE_COLORS[Math.min(i + offset, HR_ZONE_COLORS.length - 1)]} sec=${b.longestSec} i=${i} />
          <span class="flex-shrink-0" style="width: 5.5rem; color: var(--text); text-align: right;">
            ${formatZoneTime(b.longestSec)}<span style="color: var(--text-tertiary);"> / ${formatZoneTime(b.totalSec)}</span>
          </span>
        </div>
      `)}
      <div class="flex items-center gap-3 pt-1" style="font-family: var(--font-mono); font-size: 10px; color: var(--text-tertiary); padding-left: 3.5rem;">
        <span class="flex items-center gap-1"><span style="display: inline-block; width: 10px; height: 8px; border-radius: 2px; background: var(--text-tertiary);"></span>longest unbroken</span>
        <span class="flex items-center gap-1"><span style="display: inline-block; width: 10px; height: 8px; border-radius: 2px; background: color-mix(in srgb, var(--text-tertiary) 25%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text-tertiary) 35%, transparent);"></span>total time above</span>
      </div>
    </div>
  `;
}

const DECOUPLE_SCALE = 20;

export function decouplingColor(pct) {
  return pct <= 5 ? "#3D7A4A" : pct <= 10 ? "#B8862E" : "#C04A30";
}

export function DecouplingMeter({ pct }) {
  const pos = Math.min(Math.max(pct, 0), DECOUPLE_SCALE) / DECOUPLE_SCALE * 100;
  return html`
    <div class="mt-2 mb-1">
      <div class="decouple-meter">
        <span class="decouple-marker" style="left: ${pos}%; --c: ${decouplingColor(pct)};"></span>
      </div>
      <div class="relative mt-1" style="height: 12px; font-family: var(--font-mono); font-size: 10px; color: var(--text-tertiary);">
        <span class="absolute" style="left: 0;">0%</span>
        <span class="absolute" style="left: ${5 / DECOUPLE_SCALE * 100}%; transform: translateX(-50%);">5%</span>
        <span class="absolute" style="right: 0;">${DECOUPLE_SCALE}%+</span>
      </div>
    </div>
  `;
}
