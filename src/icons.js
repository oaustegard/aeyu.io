/**
 * Award Badge Icons
 *
 * Geometric outline icons for award types. Each icon is defined once as
 * drawing primitives, then consumed in two contexts:
 *
 *   1. HTM/Preact: renderIconSVG(type, { size, color, strokeWidth })
 *      Returns an htm-compatible SVG element string for use in components.
 *
 *   2. Canvas: drawIcon(ctx, type, x, y, size, color, strokeWidth)
 *      Draws the icon onto a Canvas 2D context for share card generation.
 *
 * All icons use a 24×24 coordinate system. Stroke-only, no fills.
 * Colors come from the award palette (see design/STYLE_GUIDE.md).
 */

import { html } from "htm/preact";

// ── Icon Definitions ───────────────────────────────────────────────
// Each icon is an array of drawing primitives:
//   { type: "path", d: "..." }
//   { type: "circle", cx, cy, r }
//   { type: "line", x1, y1, x2, y2 }
//   { type: "polyline", points: [[x,y], ...] }
//   { type: "polygon", points: [[x,y], ...] }
//   { type: "rect", x, y, w, h, rx }
//
// Optional per-primitive: { ..., strokeWidth: N } to override default

const ICON_DEFS = {
  // 🌱 Season First — sprouting seedling
  season_first: [
    { type: "path", d: "M12 22V12" },
    { type: "path", d: "M8 8c0-3 4-6 4-6s4 3 4 6c0 2.5-1.8 4-4 4S8 10.5 8 8z" },
    { type: "path", d: "M5 14c2-2 5-1 7 0" },
    { type: "path", d: "M19 14c-2-2-5-1-7 0" },
  ],

  // ★ Year Best — five-pointed star
  year_best: [
    { type: "polygon", points: [[12,2],[15.09,8.26],[22,9.27],[17,14.14],[18.18,21.02],[12,17.77],[5.82,21.02],[7,14.14],[2,9.27],[8.91,8.26]] },
  ],

  // ⬆ Top 10% — double chevron up
  top_decile: [
    { type: "polyline", points: [[6,15],[12,9],[18,15]] },
    { type: "polyline", points: [[6,20],[12,14],[18,20]] },
  ],

  // ↗ Recent Best — upward trend arrow
  recent_best: [
    { type: "polyline", points: [[22,7],[13.5,15.5],[8.5,10.5],[2,17]] },
    { type: "polyline", points: [[16,7],[22,7],[22,13]] },
  ],

  // ≡ Metronome — three horizontal bars
  consistency: [
    { type: "line", x1: 4, y1: 8, x2: 20, y2: 8 },
    { type: "line", x1: 4, y1: 12, x2: 20, y2: 12 },
    { type: "line", x1: 4, y1: 16, x2: 20, y2: 16 },
  ],

  // ↺ Comeback — return arrow on arc
  comeback: [
    { type: "path", d: "M3 12a9 9 0 1 1 3 6.7" },
    { type: "polyline", points: [[3,20],[3,13],[10,13]] },
  ],

  // ◎ Monthly Best — calendar with star
  monthly_best: [
    { type: "rect", x: 3, y: 4, w: 18, h: 18, rx: 2 },
    { type: "line", x1: 3, y1: 9, x2: 21, y2: 9 },
    { type: "polygon", points: [[12,12],[13.5,15],[17,15.5],[14.5,17.5],[15,21],[12,19.2],[9,21],[9.5,17.5],[7,15.5],[10.5,15]], strokeWidth: 0.8 },
  ],

  // ⟫ On a Roll — ascending steps with arrow
  improvement_streak: [
    { type: "polyline", points: [[4,18],[4,14],[9,14],[9,10],[14,10],[14,6],[20,6]] },
    { type: "polyline", points: [[17,3],[20,6],[17,9]] },
  ],

  // 📅 YTD Best Time — clock
  ytd_best_time: [
    { type: "circle", cx: 12, cy: 12, r: 9 },
    { type: "polyline", points: [[12,7],[12,12],[16,14]] },
  ],

  // ⚡ YTD Best Power — lightning bolt
  ytd_best_power: [
    { type: "polygon", points: [[13,2],[3,14],[12,14],[11,22],[21,10],[12,10]] },
  ],

  // ⬡ Milestone — flag on peak
  milestone: [
    { type: "path", d: "M4 22L12 6l8 16" },
    { type: "line", x1: 12, y1: 6, x2: 12, y2: 2 },
    { type: "path", d: "M12 2l5 2.5L12 7" },
  ],

  // ▲ Top Quartile — single chevron up
  top_quartile: [
    { type: "polyline", points: [[6,16],[12,8],[18,16]] },
  ],

  // ◆ Beat Median — diamond
  beat_median: [
    { type: "polygon", points: [[12,3],[21,12],[12,21],[3,12]] },
  ],

  // ◈ Closing In — bullseye target
  closing_in: [
    { type: "circle", cx: 12, cy: 12, r: 9 },
    { type: "circle", cx: 12, cy: 12, r: 5 },
    { type: "circle", cx: 12, cy: 12, r: 1.5 },
  ],

  // ↻ Anniversary — circular arrow
  anniversary: [
    { type: "path", d: "M21 12a9 9 0 1 1-6.7-8.7" },
    { type: "polyline", points: [[21,3],[21,9],[15,9]] },
  ],

  // → Longest Ride (distance_record)
  distance_record: [
    { type: "line", x1: 3, y1: 12, x2: 21, y2: 12 },
    { type: "polyline", points: [[16,7],[21,12],[16,17]] },
  ],

  // ⛰ Most Climbing (elevation_record)
  elevation_record: [
    { type: "polyline", points: [[2,20],[9,8],[13,14],[18,4],[22,20]] },
  ],

  // # Most Segments (segment_count)
  segment_count: [
    { type: "line", x1: 4, y1: 4, x2: 4, y2: 20 },
    { type: "line", x1: 10, y1: 4, x2: 10, y2: 20 },
    { type: "line", x1: 16, y1: 4, x2: 16, y2: 20 },
    { type: "line", x1: 2, y1: 8, x2: 18, y2: 8 },
    { type: "line", x1: 8, y1: 16, x2: 22, y2: 16 },
  ],

  // ⏱ Longest by Time (endurance_record)
  endurance_record: [
    { type: "circle", cx: 12, cy: 13, r: 9 },
    { type: "polyline", points: [[12,8],[12,13],[16,15]] },
    { type: "line", x1: 12, y1: 1, x2: 12, y2: 4 },
    { type: "polyline", points: [[8,2],[12,1],[16,2]] },
  ],

  // ◉ Best Month Ever
  best_month_ever: [
    { type: "circle", cx: 12, cy: 12, r: 9 },
    { type: "polygon", points: [[12,6],[13.8,10.2],[18,10.8],[14.8,13.5],[15.6,18],[12,15.8],[8.4,18],[9.2,13.5],[6,10.8],[10.2,10.2]] },
  ],
};


// ── HTM/Preact SVG Rendering ───────────────────────────────────────

/**
 * Render an award icon as an inline SVG element (for HTM/Preact components).
 *
 * Usage in HTM:
 *   ${renderIconSVG("year_best", { size: 16, color: "#B8862E" })}
 *
 * Or use the component wrapper:
 *   <${AwardIcon} type="year_best" size=${16} color="#B8862E" />
 */
export function renderIconSVG(type, { size = 16, color = "#6B6260", strokeWidth } = {}) {
  const prims = ICON_DEFS[type];
  if (!prims) return null;

  const sw = strokeWidth || (size > 20 ? 2 : 1.5);

  const children = prims.map((p, i) => {
    const psw = p.strokeWidth != null ? p.strokeWidth * sw : sw;
    switch (p.type) {
      case "path":
        return html`<path key=${i} d=${p.d} stroke-width=${psw} />`;
      case "circle":
        return html`<circle key=${i} cx=${p.cx} cy=${p.cy} r=${p.r} stroke-width=${psw} />`;
      case "line":
        return html`<line key=${i} x1=${p.x1} y1=${p.y1} x2=${p.x2} y2=${p.y2} stroke-width=${psw} />`;
      case "polyline":
        return html`<polyline key=${i} points=${p.points.map(pt => pt.join(",")).join(" ")} stroke-width=${psw} />`;
      case "polygon":
        return html`<polygon key=${i} points=${p.points.map(pt => pt.join(",")).join(" ")} stroke-width=${psw} />`;
      case "rect":
        return html`<rect key=${i} x=${p.x} y=${p.y} width=${p.w} height=${p.h} rx=${p.rx || 0} stroke-width=${psw} />`;
      default:
        return null;
    }
  });

  return html`
    <svg
      width=${size}
      height=${size}
      viewBox="0 0 24 24"
      fill="none"
      stroke=${color}
      stroke-linecap="round"
      stroke-linejoin="round"
      style=${{ flexShrink: 0 }}
    >
      ${children}
    </svg>
  `;
}

/**
 * Preact component wrapper for use in HTM templates.
 *
 *   <${AwardIcon} type="season_first" size=${24} color="#3D7A4A" />
 */
export function AwardIcon({ type, size, color, strokeWidth }) {
  return renderIconSVG(type, { size, color, strokeWidth });
}


// ── Canvas 2D Rendering ────────────────────────────────────────────

/**
 * Draw an award icon onto a Canvas 2D context.
 * Used by the share card renderer (ActivityDetail.js → renderShareCard).
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} type — award type key
 * @param {number} x — left edge of icon bounding box
 * @param {number} y — top edge of icon bounding box
 * @param {number} size — icon size in canvas pixels
 * @param {string} color — stroke color
 * @param {number} [strokeWidth=2] — stroke width in canvas pixels
 */
export function drawIcon(ctx, type, x, y, size, color, strokeWidth = 2) {
  const prims = ICON_DEFS[type];
  if (!prims) return;

  const scale = size / 24;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  ctx.fillStyle = "none";
  ctx.lineWidth = strokeWidth / scale; // compensate for scale
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const p of prims) {
    const psw = p.strokeWidth != null ? (p.strokeWidth * strokeWidth) / scale : ctx.lineWidth;
    ctx.lineWidth = psw;

    switch (p.type) {
      case "path":
        _drawPath2D(ctx, p.d);
        break;
      case "circle":
        ctx.beginPath();
        ctx.arc(p.cx, p.cy, p.r, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case "line":
        ctx.beginPath();
        ctx.moveTo(p.x1, p.y1);
        ctx.lineTo(p.x2, p.y2);
        ctx.stroke();
        break;
      case "polyline":
        ctx.beginPath();
        p.points.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
        ctx.stroke();
        break;
      case "polygon":
        ctx.beginPath();
        p.points.forEach(([px, py], i) => i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
        ctx.closePath();
        ctx.stroke();
        break;
      case "rect":
        _drawRoundRect(ctx, p.x, p.y, p.w, p.h, p.rx || 0);
        ctx.stroke();
        break;
    }
  }

  ctx.restore();
}

/** Draw an SVG path `d` string using Path2D. */
function _drawPath2D(ctx, d) {
  try {
    const p = new Path2D(d);
    ctx.stroke(p);
  } catch {
    // Path2D not supported (very old browsers) — skip gracefully
  }
}

/** Draw a rounded rectangle (used for calendar icon). */
function _drawRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}


// ── Exports ────────────────────────────────────────────────────────

/** All defined icon types (for iteration/validation). */
export const ICON_TYPES = Object.keys(ICON_DEFS);

/** Raw icon definitions (for advanced use / custom renderers). */
export { ICON_DEFS };
