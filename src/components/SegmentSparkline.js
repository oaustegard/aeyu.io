import { html } from "htm/preact";
import { useState, useRef, useCallback } from "preact/hooks";
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
  const svgRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(null);

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

  const w = 320;
  const h = 100;
  const padX = 8;
  const padY = 12;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;

  const points = times.map((t, i) => ({
    x: padX + (times.length === 1 ? plotW / 2 : (i / (times.length - 1)) * plotW),
    y: padY + ((t - minT) / range) * plotH,
    time: t,
    date: recent[i].start_date_local,
    isCurrent: recent[i].effort_id === currentEffortId,
    idx: i,
  }));

  const trendY0 = padY + ((intercept - minT) / range) * plotH;
  const trendY1 = padY + (((intercept + slope * (times.length - 1)) - minT) / range) * plotH;
  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const trendColor = improving ? "#22c55e" : regressing ? "#ef4444" : "#9ca3af";

  // Find nearest point by x-position relative to SVG
  const findNearest = useCallback((clientX) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * w;
    let closest = 0;
    let closestDist = Infinity;
    for (let i = 0; i < points.length; i++) {
      const d = Math.abs(points[i].x - svgX);
      if (d < closestDist) { closestDist = d; closest = i; }
    }
    setActiveIdx(closest);
  }, [points, w]);

  const onTouchStart = useCallback((e) => {
    e.preventDefault();
    findNearest(e.touches[0].clientX);
  }, [findNearest]);

  const onTouchMove = useCallback((e) => {
    e.preventDefault();
    findNearest(e.touches[0].clientX);
  }, [findNearest]);

  const onTouchEnd = useCallback(() => {
    setActiveIdx(null);
  }, []);

  const onMouseMove = useCallback((e) => {
    findNearest(e.clientX);
  }, [findNearest]);

  const onMouseLeave = useCallback(() => {
    setActiveIdx(null);
  }, []);

  const active = activeIdx != null ? points[activeIdx] : null;

  // Tooltip positioning: show above the point, centered horizontally
  const tooltipW = 110;
  const tooltipH = 28;
  const pointR = 5;
  const tooltipGap = 4;
  const tooltipX = active ? Math.max(2, Math.min(active.x - tooltipW / 2, w - tooltipW - 2)) : 0;
  const aboveY = active ? Math.max(2, active.y - tooltipH - pointR - tooltipGap) : 0;
  // Flip below if tooltip above would overlap the point
  const overlapAbove = active && (aboveY + tooltipH + tooltipGap > active.y - pointR);
  const belowY = active ? active.y + pointR + tooltipGap : 0;
  const fitsBelow = active && (belowY + tooltipH <= h - 2);
  const finalTooltipY = (overlapAbove && fitsBelow) ? belowY : aboveY;

  return html`
    <div style="margin-top: 6px;">
      <svg
        ref=${svgRef}
        width="100%"
        height=${h}
        viewBox="0 0 ${w} ${h}"
        preserveAspectRatio="none"
        style="display: block; background: var(--bg, #faf9f7); border: 1px solid var(--border); border-radius: 6px; touch-action: none; cursor: crosshair;"
        onTouchStart=${onTouchStart}
        onTouchMove=${onTouchMove}
        onTouchEnd=${onTouchEnd}
        onMouseMove=${onMouseMove}
        onMouseLeave=${onMouseLeave}
      >
        <!-- effort line -->
        <path d=${linePath} fill="none" stroke="var(--text-tertiary, #a8a29e)" stroke-width="1.5" stroke-linejoin="round" />
        <!-- trend line -->
        <line
          x1=${padX} y1=${trendY0}
          x2=${padX + plotW} y2=${trendY1}
          stroke=${trendColor}
          stroke-width="2"
          stroke-dasharray="6,3"
          opacity="0.8"
        />
        <!-- vertical crosshair at active point -->
        ${active && html`
          <line
            x1=${active.x} y1=${padY}
            x2=${active.x} y2=${h - padY}
            stroke="var(--text-tertiary, #a8a29e)"
            stroke-width="0.5"
            stroke-dasharray="3,2"
            opacity="0.6"
          />
        `}
        <!-- dots -->
        ${points.map((p) => html`
          <circle
            cx=${p.x} cy=${p.y}
            r=${p.idx === activeIdx ? 5 : p.isCurrent ? 4 : 2.5}
            fill=${p.isCurrent ? "var(--strava, #fc4c02)" : p.idx === activeIdx ? "var(--text, #3E3A36)" : "var(--text-tertiary, #a8a29e)"}
            stroke=${p.isCurrent || p.idx === activeIdx ? "#fff" : "none"}
            stroke-width=${p.isCurrent || p.idx === activeIdx ? 1.5 : 0}
          />
        `)}
        <!-- tooltip -->
        ${active && html`
          <g>
            <rect
              x=${tooltipX}
              y=${finalTooltipY}
              width=${tooltipW} height=${tooltipH} rx="4"
              fill="var(--surface, #fff)" stroke="var(--border)" stroke-width="1"
            />
            <text
              x=${tooltipX + 6}
              y=${finalTooltipY + 17}
              font-size="10" font-family="var(--font-mono)"
              fill="var(--text-secondary)"
            >
              ${formatDateShort(active.date)}
            </text>
            <text
              x=${tooltipX + tooltipW - 6}
              y=${finalTooltipY + 17}
              font-size="11" font-family="var(--font-mono)"
              fill="var(--text)" font-weight="600"
              text-anchor="end"
            >
              ${formatTime(active.time)}
            </text>
          </g>
        `}
      </svg>
      <div class="flex items-center gap-3 mt-1 px-1" style="font-family: var(--font-mono); font-size: 0.6875rem; color: var(--text-tertiary);">
        <span>${recent.length} effort${recent.length !== 1 ? "s" : ""}</span>
        <span>Best: ${formatTime(minT)}</span>
        ${rateStr && html`
          <span style="color: ${trendColor}; font-weight: 500;">Trend: ${rateStr}</span>
        `}
      </div>
    </div>
  `;
}
