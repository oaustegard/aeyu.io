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

export function SegmentSparkline({ segment, currentEffortId, stravaSegmentId, onExportLLM, exportLlmStatus }) {
  const svgRef = useRef(null);
  const [activeIdx, setActiveIdx] = useState(null);
  const [showHelp, setShowHelp] = useState(false);

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
  const hasLongTime = active && active.time >= 3600;
  const tooltipW = hasLongTime ? 140 : 110;
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
    <div style="margin-top: 6px; max-width: 480px;">
      <svg
        ref=${svgRef}
        width="100%"
        viewBox="0 0 ${w} ${h}"
        preserveAspectRatio="xMidYMid meet"
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
        <span class="relative" style="display: inline-flex; align-items: center; gap: 6px; margin-left: auto;">
          ${stravaSegmentId && html`
            <a
              href=${`https://www.strava.com/segments/${stravaSegmentId}`}
              target="_blank"
              rel="noopener noreferrer"
              style="display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; color: var(--strava, #fc4c02); opacity: 0.6; transition: opacity 0.15s;"
              onMouseOver=${e => e.currentTarget.style.opacity = '1'}
              onMouseOut=${e => e.currentTarget.style.opacity = '0.6'}
              onClick=${e => e.stopPropagation()}
              aria-label="View on Strava"
              title="View on Strava"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
          `}
          ${onExportLLM && html`
            <button
              onClick=${(e) => { e.stopPropagation(); onExportLLM(); }}
              disabled=${exportLlmStatus === "loading"}
              style="display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; color: var(--accent); background: transparent; border: none; cursor: pointer; padding: 0; opacity: 0.6; transition: opacity 0.15s;"
              onMouseOver=${e => e.currentTarget.style.opacity = '1'}
              onMouseOut=${e => e.currentTarget.style.opacity = '0.6'}
              aria-label=${exportLlmStatus === "copied" ? "Copied!" : exportLlmStatus === "error" ? "Export failed" : "Export for AI"}
              title=${exportLlmStatus === "copied" ? "Copied!" : exportLlmStatus === "error" ? "Export failed" : "Export for AI"}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/></svg>
            </button>
          `}
          <button
            onClick=${(e) => { e.stopPropagation(); setShowHelp(!showHelp); }}
            style="width: 16px; height: 16px; font-size: 10px; font-weight: 600; color: var(--text-tertiary); border: 1.5px solid var(--text-tertiary); background: transparent; cursor: pointer; line-height: 1; padding: 0; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;"
            aria-label="Help"
          >?</button>
          ${showHelp && html`
            <div
              onClick=${(e) => e.stopPropagation()}
              class="absolute z-20 rounded-lg shadow-lg p-3"
              style="bottom: calc(100% + 8px); right: 0; width: 260px; background: var(--surface, #fff); border: 1px solid var(--border); font-family: var(--font-body); font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.5;"
            >
              <button
                onClick=${() => setShowHelp(false)}
                style="position: absolute; top: 4px; right: 6px; background: none; border: none; cursor: pointer; color: var(--text-tertiary); font-size: 14px; line-height: 1; padding: 2px;"
                aria-label="Close"
              >\u00D7</button>
              Your recent effort history (up to 20). Current effort in orange. Dashed trend line: green = getting faster, red = slowing down. Tap/hover to see individual effort times.
            </div>
          `}
        </span>
      </div>
    </div>
  `;
}
