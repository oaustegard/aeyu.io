import { html } from "htm/preact";
import { useState } from "preact/hooks";
import { formatTime } from "../units.js";

const MAX_EFFORTS = 20;

function linearRegression(values) {
  const n = values.length;
  if (n < 2) return { slope: 0, intercept: values[0] || 0, r2: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i];
    sumXY += i * values[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;
  const yMean = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (values[i] - yMean) ** 2;
    ssRes += (values[i] - (intercept + slope * i)) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { slope, intercept, r2 };
}

function computeImprovementRate(efforts) {
  if (efforts.length < 2) return null;
  const first = new Date(efforts[0].start_date_local).getTime();
  const last = new Date(efforts[efforts.length - 1].start_date_local).getTime();
  const monthSpan = (last - first) / (1000 * 60 * 60 * 24 * 30.44);
  if (monthSpan < 0.5) return null;
  const times = efforts.map(e => e.elapsed_time);
  const { slope, r2 } = linearRegression(times);
  if (r2 < 0.05) return null;
  const secsPerMonth = slope * (times.length - 1) / monthSpan;
  return secsPerMonth;
}

function formatRate(secsPerMonth) {
  const abs = Math.abs(secsPerMonth);
  const sign = secsPerMonth < 0 ? "−" : "+";
  if (abs < 0.1) return null;
  if (abs < 60) return `${sign}${abs.toFixed(1)}s/mo`;
  const m = Math.floor(abs / 60);
  const s = Math.round(abs % 60);
  return `${sign}${m}:${String(s).padStart(2, "0")}/mo`;
}

function formatDateShort(iso) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
}

export function SegmentSparkline({ segment, currentEffortId }) {
  const [expanded, setExpanded] = useState(false);

  if (!segment || !segment.efforts || segment.efforts.length < 2) return null;

  const sorted = [...segment.efforts]
    .sort((a, b) => new Date(a.start_date_local) - new Date(b.start_date_local));
  const recent = sorted.slice(-MAX_EFFORTS);
  const times = recent.map(e => e.elapsed_time);
  const { slope, intercept } = linearRegression(times);
  const rate = computeImprovementRate(recent);
  const rateStr = rate != null ? formatRate(rate) : null;
  const improving = rate != null && rate < -0.1;
  const regressing = rate != null && rate > 0.1;

  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const range = maxT - minT || 1;

  const w = expanded ? 320 : 140;
  const h = expanded ? 120 : 36;
  const padX = expanded ? 8 : 4;
  const padY = expanded ? 12 : 4;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;

  const points = times.map((t, i) => ({
    x: padX + (times.length === 1 ? plotW / 2 : (i / (times.length - 1)) * plotW),
    y: padY + ((t - minT) / range) * plotH,
    time: t,
    date: recent[i].start_date_local,
    isCurrent: recent[i].effort_id === currentEffortId,
  }));

  const trendY0 = padY + ((intercept - minT) / range) * plotH;
  const trendY1 = padY + (((intercept + slope * (times.length - 1)) - minT) / range) * plotH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");

  const trendColor = improving ? "#22c55e" : regressing ? "#ef4444" : "#9ca3af";

  const [tooltip, setTooltip] = useState(null);

  return html`
    <div style="margin-top: 6px;">
      <div
        class="flex items-center gap-2 cursor-pointer select-none"
        onClick=${() => setExpanded(!expanded)}
        style="min-height: 36px;"
      >
        <svg
          width=${w}
          height=${h}
          viewBox="0 0 ${w} ${h}"
          style="background: var(--bg, #faf9f7); border: 1px solid var(--border); border-radius: 6px; flex-shrink: 0;"
          onMouseLeave=${() => setTooltip(null)}
        >
          <!-- effort line -->
          <path d=${linePath} fill="none" stroke="var(--text-tertiary, #a8a29e)" stroke-width=${expanded ? 1.5 : 1} stroke-linejoin="round" />
          <!-- trend line -->
          <line
            x1=${padX} y1=${trendY0}
            x2=${padX + plotW} y2=${trendY1}
            stroke=${trendColor}
            stroke-width=${expanded ? 2 : 1.5}
            stroke-dasharray=${expanded ? "6,3" : "4,2"}
            opacity="0.8"
          />
          <!-- dots -->
          ${points.map((p, i) => html`
            <circle
              cx=${p.x} cy=${p.y}
              r=${p.isCurrent ? (expanded ? 5 : 3.5) : (expanded ? 3 : 1.5)}
              fill=${p.isCurrent ? "var(--strava, #fc4c02)" : "var(--text-tertiary, #a8a29e)"}
              stroke=${p.isCurrent ? "#fff" : "none"}
              stroke-width=${p.isCurrent ? 1.5 : 0}
              onMouseEnter=${() => expanded && setTooltip({ x: p.x, y: p.y, time: p.time, date: p.date, idx: i })}
              style=${expanded ? "cursor: pointer;" : ""}
            />
          `)}
          <!-- tooltip -->
          ${expanded && tooltip && html`
            <g>
              <rect
                x=${Math.min(tooltip.x + 8, w - 90)}
                y=${Math.max(tooltip.y - 30, 2)}
                width="82" height="24" rx="4"
                fill="var(--surface, #fff)" stroke="var(--border)" stroke-width="1"
              />
              <text
                x=${Math.min(tooltip.x + 12, w - 86)}
                y=${Math.max(tooltip.y - 13, 17)}
                font-size="10" font-family="var(--font-mono)"
                fill="var(--text)"
              >
                ${formatDateShort(tooltip.date)}
              </text>
              <text
                x=${Math.min(tooltip.x + 72, w - 22)}
                y=${Math.max(tooltip.y - 13, 17)}
                font-size="10" font-family="var(--font-mono)"
                fill="var(--text)" text-anchor="end"
              >
                ${formatTime(tooltip.time)}
              </text>
            </g>
          `}
        </svg>
        ${!expanded && rateStr && html`
          <span style="font-family: var(--font-mono); font-size: 0.6875rem; color: ${trendColor}; white-space: nowrap;">
            ${rateStr}
          </span>
        `}
        ${!expanded && html`
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; opacity: 0.5;">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        `}
      </div>
      ${expanded && html`
        <div class="flex items-center gap-3 mt-1 px-1" style="font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text-tertiary);">
          <span>${recent.length} effort${recent.length !== 1 ? "s" : ""}</span>
          <span>Best: ${formatTime(minT)}</span>
          ${rateStr && html`
            <span style="color: ${trendColor}; font-weight: 500;">Trend: ${rateStr}</span>
          `}
          <svg
            width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
            style="flex-shrink: 0; opacity: 0.5; cursor: pointer; margin-left: auto;"
            onClick=${(e) => { e.stopPropagation(); setExpanded(false); }}
          >
            <polyline points="18 15 12 9 6 15"/>
          </svg>
        </div>
      `}
    </div>
  `;
}
