import { html } from "htm/preact";
import { unitSystem } from "../units.js";

const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

export function TrendChart({ rides: rawRides, highlightId }) {
  const rides = rawRides.filter((r) => r.average_speed);
  if (rides.length < 2) return null;

  const hasPower = rides.some((r) => r.average_watts);
  const speeds = rides.map((r) => unitSystem.value === "imperial" ? r.average_speed * 2.23694 : r.average_speed * 3.6);
  const powers = hasPower ? rides.map((r) => r.average_watts || 0) : [];
  const speedUnit = unitSystem.value === "imperial" ? "mph" : "km/h";
  const spdColor = "#4882A8", powColor = "#A05060";

  const minSpd = Math.min(...speeds), maxSpd = Math.max(...speeds);
  const spdRange = maxSpd - minSpd || 1;
  const padSpd = { min: minSpd - spdRange * 0.1, max: maxSpd + spdRange * 0.1 };
  const pSpdRange = padSpd.max - padSpd.min;

  let padPow, pPowRange;
  if (hasPower) {
    const validPowers = powers.filter((p) => p > 0);
    if (validPowers.length >= 2) {
      const minPow = Math.min(...validPowers), maxPow = Math.max(...validPowers);
      const powRange = maxPow - minPow || 1;
      padPow = { min: minPow - powRange * 0.1, max: maxPow + powRange * 0.1 };
      pPowRange = padPow.max - padPow.min;
    }
  }
  const showPow = hasPower && padPow;

  const W = 280, H = showPow ? 80 : 60, ML = 32, MR = showPow ? 32 : 4, MT = 4, MB = 18;
  const cW = W - ML - MR, cH = H - MT - MB;
  const xPos = (i) => ML + (i / (rides.length - 1)) * cW;
  const ySpd = (s) => MT + cH - ((s - padSpd.min) / pSpdRange) * cH;
  const yPow = showPow ? (p) => MT + cH - ((p - padPow.min) / pPowRange) * cH : null;

  const spdPath = speeds.map((s, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${ySpd(s).toFixed(1)}`).join(' ');
  let powPathD = null;
  if (showPow) {
    const pts = powers.map((p, i) => p > 0 ? `${xPos(i).toFixed(1)},${yPow(p).toFixed(1)}` : null).filter(Boolean);
    if (pts.length > 1) powPathD = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt}`).join(' ');
  }

  const labelStep = Math.max(1, Math.ceil(rides.length / 6));
  const spdTicks = [padSpd.min, padSpd.min + pSpdRange / 2, padSpd.max].map((v) => +v.toFixed(1));
  const powTicks = showPow ? [padPow.min, padPow.min + pPowRange / 2, padPow.max].map((v) => Math.round(v)) : [];

  const dotRadius = (i) => {
    if (highlightId && rides[i].id === highlightId) return 4;
    return i === rides.length - 1 ? 3 : 1.5;
  };
  const dotStroke = (i) => highlightId && rides[i].id === highlightId ? "var(--text)" : "none";

  return html`
    <svg viewBox="0 0 ${W} ${H}" style="width: 100%; height: auto; margin-top: 0.25rem; overflow: visible;">
      ${spdTicks.map((v) => html`
        <text x="${ML - 3}" y="${ySpd(v) + 1}" text-anchor="end" style="font-size: 6px; fill: ${spdColor}; font-family: var(--font-mono);">${v}</text>
        <line x1="${ML}" y1="${ySpd(v)}" x2="${W - MR}" y2="${ySpd(v)}" stroke="var(--border)" stroke-width="0.5" stroke-dasharray="2,2" />
      `)}
      ${showPow && powTicks.map((v) => html`
        <text x="${W - MR + 3}" y="${yPow(v) + 1}" text-anchor="start" style="font-size: 6px; fill: ${powColor}; font-family: var(--font-mono);">${v}</text>
      `)}
      <path d="${spdPath}" fill="none" stroke="${spdColor}" stroke-width="1.5" stroke-linejoin="round" />
      ${speeds.map((s, i) => html`
        <circle cx="${xPos(i)}" cy="${ySpd(s)}" r="${dotRadius(i)}" fill="${spdColor}"
          stroke="${dotStroke(i)}" stroke-width="1"
          style="cursor: pointer;" onclick=${() => { location.hash = '#/activity/' + rides[i].id; }}>
          <title>${new Date(rides[i].date).toLocaleDateString()}: ${s.toFixed(1)} ${speedUnit}</title>
        </circle>
      `)}
      ${powPathD && html`
        <path d="${powPathD}" fill="none" stroke="${powColor}" stroke-width="1.5" stroke-linejoin="round" stroke-dasharray="4,2" />
        ${rides.map((r, i) => r.average_watts ? html`
          <circle cx="${xPos(i)}" cy="${yPow(powers[i])}" r="${dotRadius(i)}" fill="${powColor}"
            stroke="${dotStroke(i)}" stroke-width="1"
            style="cursor: pointer;" onclick=${() => { location.hash = '#/activity/' + rides[i].id; }}>
            <title>${new Date(r.date).toLocaleDateString()}: ${Math.round(r.average_watts)}W</title>
          </circle>
        ` : null)}
      `}
      ${rides.map((r, i) => {
        if (i % labelStep !== 0 && i !== rides.length - 1) return null;
        const d = new Date(r.date);
        return html`<text x="${xPos(i)}" y="${H - 2}" text-anchor="middle" style="font-size: 6px; fill: var(--text-tertiary); font-family: var(--font-mono);">${monthNames[d.getMonth()]} '${String(d.getFullYear()).slice(2)}</text>`;
      })}
    </svg>
    <div class="flex items-center gap-3 mt-1" style="font-family: var(--font-mono); font-size: 0.5625rem; color: var(--text-tertiary);">
      <span class="flex items-center gap-1"><span style="display:inline-block;width:12px;height:2px;background:${spdColor};"></span>Speed (${speedUnit})</span>
      ${showPow && html`<span class="flex items-center gap-1"><span style="display:inline-block;width:12px;height:2px;background:${powColor};border-top:1px dashed ${powColor};"></span>Power (W)</span>`}
    </div>
  `;
}
