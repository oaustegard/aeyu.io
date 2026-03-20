/**
 * Activity Detail Screen
 * Shows all segment efforts for an activity with award indicators.
 * Includes share card generation (Canvas) and copy-to-clipboard summary.
 */

import { html } from "htm/preact";
import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { getActivity, getSegment, getAllActivities, getResetEvent, getUserConfig, getAllRoutes, getStravaRoutes } from "../db.js";
import { computeAwards, computeRideLevelAwards } from "../awards.js";
import { detectRoutes, findRouteForActivity } from "../routes.js";
import { resyncActivity } from "../sync.js";
import { isDemo } from "../demo.js";
import { navigate } from "../app.js";
import {
  unitSystem,
  setUnitPreference,
  formatDistance,
  formatTime,
  formatDate,
  formatDateFull,
  formatElevation,
  formatSpeed,
  formatPower,
} from "../units.js";
import { renderIconSVG, drawIcon } from "../icons.js";
import { AWARD_LABELS, AWARD_COLORS } from "../award-config.js";
import { StickyHeader } from "./StickyHeader.js";
import { SegmentSparkline } from "./SegmentSparkline.js";
import { buildRideExport, rideToMarkdown, buildSegmentExport, segmentToMarkdown } from "../export-llm.js";

const activity = signal(null);
const awards = signal([]);
const segmentHistory = signal(new Map());
const loading = signal(true);
const copied = signal(false);
const cardGenerated = signal(false);
const segmentCardGenerated = signal(null); // segment_id or null
const resyncing = signal(false);
const resyncError = signal(null);
const sortColumn = signal(null); // null = activity order
const sortDirection = signal("asc"); // "asc" or "desc"
const llmExportStatus = signal(null); // null | "loading" | "copied" | "error"
const llmExportFormat = signal("markdown");
const llmIncludeForm = signal(true);
const segmentLlmExportStatus = signal(null); // null | { segmentId, state: "loading"|"copied"|"error" }

function formatDateShort(isoString) {
  return new Date(isoString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function loadActivity(id) {
  // Only show full loading screen on initial load, not on refresh/resync
  if (!activity.value || activity.value.id !== Number(id)) {
    loading.value = true;
  }
  cardGenerated.value = false;
  segmentCardGenerated.value = null;
  sortColumn.value = null;
  sortDirection.value = "asc";
  try {
    const act = await getActivity(Number(id));
    if (!act) return;
    activity.value = act;

    if (act.has_efforts) {
      // Propagate device_watts from segment efforts to activity level (#85)
      // Handles activities synced before power fields were added to sync code
      if (!act.device_watts && act.segment_efforts) {
        const hasDeviceWatts = act.segment_efforts.some(e => e.device_watts);
        if (hasDeviceWatts) {
          act.device_watts = true;
          if (!act.weighted_average_watts && act.average_watts) {
            act.weighted_average_watts = act.average_watts;
          }
        }
      }

      const resetEvent = await getResetEvent();
      const userConfig = await getUserConfig();
      const refPoints = userConfig.referencePoints || [];
      const segmentAwards = await computeAwards(act, resetEvent, refPoints);
      const allActivities = await getAllActivities();
      const rideAwards = computeRideLevelAwards(act, allActivities, resetEvent);
      let awardsList = [...segmentAwards, ...rideAwards];

      // Route-level Season First collapse (#84)
      const seasonFirsts = awardsList.filter(a => a.type === "season_first");
      if (seasonFirsts.length >= 2) {
        let routes = await getAllRoutes();
        if (!routes || routes.length === 0) {
          const withEfforts = allActivities.filter(a => a.has_efforts);
          const stravaRoutes = await getStravaRoutes();
          routes = detectRoutes(withEfforts, stravaRoutes);
        }
        if (routes.length > 0) {
          const route = findRouteForActivity(act, routes);
          if (route) {
            const nonSeasonFirsts = awardsList.filter(a => a.type !== "season_first");
            const routeAward = {
              type: "route_season_first",
              segment: null,
              segment_id: null,
              time: null,
              power: null,
              comparison: null,
              delta: null,
              route_name: route.name,
              route_frequency: route.frequency,
              collapsed_count: seasonFirsts.length,
              _collapsed_season_firsts: seasonFirsts,
              message: `Season First on ${route.name}! First time this year on this route (${seasonFirsts.length} segments) — ${route.frequency} times total`,
            };
            awardsList = [...nonSeasonFirsts, routeAward];
          }
        }
      }

      // Filter out disabled award types
      const disabled = new Set(userConfig.disabledAwards || []);
      if (disabled.size > 0) {
        awardsList = awardsList.filter((a) => {
          if (disabled.has(a.type)) return false;
          if (a.type === "route_season_first" && disabled.has("season_first")) return false;
          return true;
        });
      }

      awards.value = awardsList;

      const history = new Map();
      for (const effort of act.segment_efforts || []) {
        const seg = await getSegment(effort.segment.id);
        if (seg) history.set(effort.segment.id, seg);
      }
      segmentHistory.value = history;
    }
  } finally {
    loading.value = false;
    if (window.dismissLoadingOverlay) window.dismissLoadingOverlay();
  }
}


// ── Text Summary ──────────────────────────────────────────────────

function buildSummary(act, awardsList) {
  const lines = [];
  lines.push(act.name);
  let meta = `${formatDateShort(act.start_date_local)} · ${formatDistance(act.distance)} · ${formatTime(act.moving_time)}`;
  if (act.average_speed) meta += ` · ${formatSpeed(act.average_speed)}`;
  if (act.total_elevation_gain) meta += ` · ${formatElevation(act.total_elevation_gain)}`;
  if ((act.device_watts || act.sport_type === "VirtualRide") && act.average_watts) meta += ` · ${formatPower(act.average_watts)}`;
  lines.push(meta);

  if (awardsList.length > 0) {
    lines.push("");
    const counts = {};
    for (const a of awardsList) {
      const label = AWARD_LABELS[a.type]?.label || a.type;
      counts[label] = (counts[label] || 0) + 1;
    }
    lines.push(Object.entries(counts).map(([l, n]) => n > 1 ? `${n}× ${l}` : l).join(", "));

    // Top highlights — deduplicated by segment (#87)
    const highlights = buildShareCardHighlights(awardsList);
    for (const a of highlights) {
      let detail = a.time != null ? formatTime(a.time) : "";
      if (a.power) detail += detail ? ` · ${formatPower(a.power)}` : formatPower(a.power);
      lines.push(`  ${a.segment || a.route_name || ""} ${detail ? "— " + detail : ""}`);
    }
    const remaining = awardsList.length - highlights.length;
    if (remaining > 0) lines.push(`  + ${remaining} more`);
  }
  lines.push("");
  lines.push("aeyu.io — Participation Awards");
  return lines.join("\n");
}


// ── Logo Loader ──────────────────────────────────────────────────
let _logoImg = null;
function loadLogo() {
  if (_logoImg) return Promise.resolve(_logoImg);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { _logoImg = img; resolve(img); };
    img.onerror = () => resolve(null);
    img.src = "/icons/icon-512.png";
  });
}

function drawLogoWatermark(ctx, W, H, cardY, cardH, pad) {
  if (!_logoImg) return;
  const cardW = W - pad * 2;
  ctx.save();
  // Clip to card bounds so watermark doesn't bleed
  roundRect(ctx, pad, cardY, cardW, cardH, 24);
  ctx.clip();
  // Fill card with the icon's background color at subtle opacity
  ctx.globalAlpha = 0.035;
  ctx.fillStyle = "#A0522D";
  ctx.fillRect(pad, cardY, cardW, cardH);
  // Draw logo sized to fill the card height, centered
  ctx.globalAlpha = 0.05;
  const logoSize = cardH;
  const lx = W / 2 - logoSize / 2;
  const ly = cardY;
  ctx.drawImage(_logoImg, lx, ly, logoSize, logoSize);
  ctx.restore();
}


// ── Canvas Share Card ─────────────────────────────────────────────

async function renderShareCard(canvas, act, awardsList) {
  const W = 1080;
  const pad = 36, left = pad + 36, maxTextW = W - left - pad - 36;
  const rightEdge = W - pad - 36;

  await Promise.all([
    document.fonts.load('400 64px "Instrument Serif"'),
    document.fonts.load('400 34px "IBM Plex Mono"'),
    document.fonts.load('500 32px "DM Sans"'),
    document.fonts.load('600 30px "DM Sans"'),
    document.fonts.load('400 26px "Instrument Serif"'),
    loadLogo(),
  ]).catch(() => {});

  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = W;
  const tmpCtx = tmpCanvas.getContext("2d");
  tmpCtx.font = '400 64px "Instrument Serif", serif';
  const nameLines = wrapText(tmpCtx, act.name, maxTextW);

  const metaParts = [formatDateShort(act.start_date_local), formatDistance(act.distance), formatTime(act.moving_time)];
  if (act.average_speed) metaParts.push(formatSpeed(act.average_speed));
  if (act.total_elevation_gain) metaParts.push(formatElevation(act.total_elevation_gain));
  if ((act.device_watts || act.sport_type === "VirtualRide") && act.average_watts) metaParts.push(formatPower(act.average_watts));
  tmpCtx.font = '400 34px "IBM Plex Mono", monospace';
  const metaText = metaParts.join("  ·  ");
  const metaLines = wrapText(tmpCtx, metaText, maxTextW);

  const highlightAwards = buildShareCardHighlights(awardsList);

  const counts = {};
  const pillOrder = ["route_season_first", "season_first", "year_best", "ytd_best_time", "ytd_best_power", "best_month_ever", "monthly_best", "recent_best", "improvement_streak", "comeback", "closing_in", "top_decile", "top_quartile", "beat_median", "consistency", "milestone", "anniversary", "distance_record", "elevation_record", "segment_count", "endurance_record", "season_first_power", "np_year_best", "np_recent_best", "work_year_best", "work_recent_best", "peak_power", "peak_power_recent", "watt_milestone", "kj_milestone", "power_progression", "power_consistency", "ftp_milestone", "curve_year_best", "curve_all_time", "indoor_np_year_best", "indoor_work_year_best", "trainer_streak", "indoor_vs_outdoor", "weekly_streak", "group_consistency", "reference_best", "comeback_pb", "recovery_milestone", "comeback_full", "comeback_distance", "comeback_elevation", "comeback_endurance"];
  for (const a of awardsList) counts[a.type] = (counts[a.type] || 0) + 1;
  tmpCtx.font = '600 30px "DM Sans", sans-serif';
  const allPillRows = layoutPillRows(tmpCtx, counts, pillOrder, left, maxTextW);
  const MAX_PILL_ROWS = 2;
  const pillRows = allPillRows.slice(0, MAX_PILL_ROWS);
  const pillTypesShown = new Set(pillRows.flat().map(p => p.type));
  const hiddenPillCount = Object.keys(counts).filter(t => !pillTypesShown.has(t)).length;

  let contentH = 48;  // top padding
  contentH += 32 + 48; // header + gap
  contentH += 40;      // divider gap
  contentH += nameLines.length * 74 + 8; // title (bigger font)
  contentH += metaLines.length * 42 + 24; // meta lines + gap

  if (awardsList.length > 0) {
    contentH += pillRows.length * 56 + 16 + 32; // pill rows + gap + divider
    for (const a of highlightAwards) {
      contentH += (a.delta && a.delta > 0) ? 68 : 52;
    }
    if (awardsList.length > highlightAwards.length) contentH += 44;
  }
  contentH += 48; // bottom padding

  const cardY = 36, cardBottom = 36;
  const taglineH = 56;
  const H = cardY + contentH + taglineH + cardBottom;

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#EDE9E1";
  ctx.fillRect(0, 0, W, H);

  // Topo texture
  ctx.strokeStyle = "rgba(26, 22, 16, 0.04)";
  ctx.lineWidth = 1;
  const centers = [
    [W * 0.15, H * 0.3], [W * 0.75, H * 0.2], [W * 0.5, H * 0.7],
    [W * 0.85, H * 0.6], [W * 0.25, H * 0.8],
  ];
  for (const [cx, cy] of centers) {
    for (let r = 40; r < 400; r += 50) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Card shadow
  const cardW = W - pad * 2, cardH = contentH;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.10)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = "#FDFCFA";
  roundRect(ctx, pad, cardY, cardW, cardH, 20);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "#D8D0C4";
  ctx.lineWidth = 1.5;
  roundRect(ctx, pad, cardY, cardW, cardH, 20);
  ctx.stroke();

  drawLogoWatermark(ctx, W, H, cardY, cardH, pad);

  let y = cardY + 48;

  // Header
  ctx.font = '400 30px "Instrument Serif", serif';
  ctx.fillStyle = "#1A1610";
  ctx.textAlign = "left";
  ctx.fillText("aeyu", left, y);
  const aeyuW = ctx.measureText("aeyu").width;
  ctx.fillStyle = "#B85A28";
  ctx.fillText(".io", left + aeyuW, y);

  ctx.font = '400 30px "DM Sans", sans-serif';
  ctx.fillStyle = "#7A7164";
  ctx.textAlign = "right";
  ctx.fillText("Participation Awards", rightEdge, y);
  ctx.textAlign = "left";
  y += 48;

  // Divider
  ctx.strokeStyle = "#D8D0C4";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(rightEdge, y);
  ctx.stroke();
  y += 40;

  // Activity name — larger
  ctx.font = '400 64px "Instrument Serif", serif';
  ctx.fillStyle = "#1A1610";
  for (const line of nameLines) {
    ctx.fillText(line, left, y);
    y += 74;
  }
  y += 8;

  // Meta
  ctx.font = '400 34px "IBM Plex Mono", monospace';
  ctx.fillStyle = "#4A4438";
  for (const line of metaLines) {
    ctx.fillText(line, left, y);
    y += 42;
  }
  y += 24;

  // Awards
  if (awardsList.length > 0) {
    for (const row of pillRows) {
      for (const pill of row) {
        ctx.font = '600 30px "DM Sans", sans-serif';
        const colors = AWARD_COLORS[pill.type];
        if (!colors) continue;

        const iconSize = 22;
        const iconPad = 6;
        const textW = ctx.measureText(pill.label).width;
        const tw = 16 + iconSize + iconPad + textW + 16;

        ctx.fillStyle = colors.bg;
        roundRect(ctx, pill.x, y - 30, tw, 44, 22);
        ctx.fill();
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 1.5;
        roundRect(ctx, pill.x, y - 30, tw, 44, 22);
        ctx.stroke();

        drawIcon(ctx, pill.type, pill.x + 14, y - 28, iconSize, colors.accent, 2);

        ctx.fillStyle = colors.text;
        ctx.font = '600 30px "DM Sans", sans-serif';
        ctx.fillText(pill.label, pill.x + 14 + iconSize + iconPad, y);
      }
      y += 56;
    }
    y += 16;

    // Divider
    ctx.strokeStyle = "#D8D0C4";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(rightEdge, y);
    ctx.stroke();
    y += 32;

    // Top segment highlights
    for (const award of highlightAwards) {
      const colors = AWARD_COLORS[award.type];
      if (!colors) continue;

      drawIcon(ctx, award.type, left, y - 14, 22, colors.accent, 2);

      ctx.font = '500 32px "DM Sans", sans-serif';
      ctx.fillStyle = "#1A1610";
      const segName = award.segment || award.route_name || "";
      const awardLabel = AWARD_LABELS[award.type]?.label || "";
      const displayName = segName ? `${segName} — ${awardLabel}` : awardLabel;
      let truncated = displayName;
      const rightLabelW = 160;
      while (ctx.measureText(truncated).width > maxTextW - rightLabelW - 32 && truncated.length > 3) {
        truncated = truncated.slice(0, -4) + "…";
      }
      ctx.fillText(truncated, left + 32, y + 4);

      const rightLabel = award.time != null ? formatTime(award.time) : (award.power ? `${Math.round(award.power)}W` : "");
      ctx.font = '500 32px "IBM Plex Mono", monospace';
      ctx.fillStyle = colors.accent;
      ctx.textAlign = "right";
      ctx.fillText(rightLabel, rightEdge, y + 4);
      ctx.textAlign = "left";

      if (award.delta && award.delta > 0) {
        ctx.font = '400 24px "IBM Plex Mono", monospace';
        ctx.fillStyle = "#7A7164";
        ctx.fillText(`${formatTime(award.delta)} faster`, left + 32, y + 32);
      }
      y += (award.delta && award.delta > 0) ? 68 : 52;
    }

    const remaining = awardsList.length - highlightAwards.length;
    if (remaining > 0) {
      ctx.font = '400 26px "DM Sans", sans-serif';
      ctx.fillStyle = "#7A7164";
      ctx.fillText(`+ ${remaining} more awards`, left, y + 8);
    }
  }

  // Tagline
  ctx.font = 'italic 26px "Instrument Serif", serif';
  ctx.fillStyle = "#7A7164";
  ctx.textAlign = "center";
  ctx.fillText("It's just you and your efforts", W / 2, H - 28);
  ctx.textAlign = "left";
}

// ── Segment Share Card ────────────────────────────────────────────

function drawPerformanceChart(ctx, segment, currentEffortId, chartX, chartY, chartW, chartH) {
  if (!segment || !segment.efforts || segment.efforts.length < 2) return;

  const MAX_EFFORTS = 20;
  const sorted = [...segment.efforts]
    .sort((a, b) => new Date(a.start_date_local) - new Date(b.start_date_local));
  const recent = sorted.slice(-MAX_EFFORTS);
  const times = recent.map(e => e.elapsed_time);

  // Linear regression
  const n = times.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i; sumY += times[i]; sumXY += i * times[i]; sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = denom === 0 ? sumY / n : (sumY - slope * sumX) / n;

  // Improvement rate
  const first = new Date(recent[0].start_date_local).getTime();
  const last = new Date(recent[n - 1].start_date_local).getTime();
  const monthSpan = (last - first) / (1000 * 60 * 60 * 24 * 30.44);
  let rate = null;
  if (monthSpan >= 0.5) {
    const yMean = sumY / n;
    let ssTot = 0, ssRes = 0;
    for (let i = 0; i < n; i++) {
      ssTot += (times[i] - yMean) ** 2;
      ssRes += (times[i] - (intercept + slope * i)) ** 2;
    }
    const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
    if (r2 >= 0.05) rate = slope * (n - 1) / monthSpan;
  }

  const improving = rate != null && rate < -0.1;
  const regressing = rate != null && rate > 0.1;
  const trendColor = improving ? "#22c55e" : regressing ? "#ef4444" : "#9ca3af";

  const minT = Math.min(...times);
  const maxT = Math.max(...times);
  const range = maxT - minT || 1;

  const padX = 16, padY = 24;
  const plotW = chartW - padX * 2;
  const plotH = chartH - padY * 2;

  const points = times.map((t, i) => ({
    x: chartX + padX + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW),
    y: chartY + padY + ((t - minT) / range) * plotH,
    time: t,
    date: recent[i].start_date_local,
    isCurrent: recent[i].effort_id === currentEffortId,
  }));

  // Chart background
  ctx.save();
  ctx.fillStyle = "#FAF9F7";
  roundRect(ctx, chartX, chartY, chartW, chartH, 12);
  ctx.fill();
  ctx.strokeStyle = "#E5DFD4";
  ctx.lineWidth = 1;
  roundRect(ctx, chartX, chartY, chartW, chartH, 12);
  ctx.stroke();

  // Clip to chart bounds
  roundRect(ctx, chartX, chartY, chartW, chartH, 12);
  ctx.clip();

  // Min/max reference lines
  ctx.strokeStyle = "#E5DFD4";
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(chartX + padX, chartY + padY);
  ctx.lineTo(chartX + chartW - padX, chartY + padY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(chartX + padX, chartY + chartH - padY);
  ctx.lineTo(chartX + chartW - padX, chartY + chartH - padY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Time labels for min/max
  ctx.font = '400 22px "IBM Plex Mono", monospace';
  ctx.fillStyle = "#7A7164";
  ctx.textAlign = "right";
  ctx.fillText(formatTime(minT), chartX + chartW - padX, chartY + padY - 6);
  ctx.fillText(formatTime(maxT), chartX + chartW - padX, chartY + chartH - padY + 18);
  ctx.textAlign = "left";

  // Trend line
  const trendY0 = chartY + padY + ((intercept - minT) / range) * plotH;
  const trendY1 = chartY + padY + (((intercept + slope * (n - 1)) - minT) / range) * plotH;
  ctx.strokeStyle = trendColor;
  ctx.lineWidth = 2.5;
  ctx.setLineDash([8, 4]);
  ctx.globalAlpha = 0.7;
  ctx.beginPath();
  ctx.moveTo(chartX + padX, trendY0);
  ctx.lineTo(chartX + chartW - padX, trendY1);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Effort line
  ctx.strokeStyle = "#A8A29E";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.beginPath();
  points.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
  ctx.stroke();

  // Dots
  for (const p of points) {
    if (p.isCurrent) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#fc4c02";
      ctx.fill();
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = 2.5;
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = "#A8A29E";
      ctx.fill();
    }
  }

  ctx.restore();

  // Stats below chart
  ctx.font = '400 24px "IBM Plex Mono", monospace';
  ctx.fillStyle = "#7A7164";
  const statsY = chartY + chartH + 28;
  ctx.fillText(`${recent.length} efforts  ·  Best: ${formatTime(minT)}`, chartX, statsY);

  if (rate != null) {
    const abs = Math.abs(rate);
    if (abs >= 0.1) {
      const sign = rate < 0 ? "−" : "+";
      const rateStr = abs < 60
        ? `${sign}${abs.toFixed(1)}s/mo`
        : `${sign}${Math.floor(abs / 60)}:${String(Math.round(abs % 60)).padStart(2, "0")}/mo`;
      ctx.fillStyle = trendColor;
      ctx.font = '500 24px "IBM Plex Mono", monospace';
      ctx.textAlign = "right";
      ctx.fillText(`Trend: ${rateStr}`, chartX + chartW, statsY);
      ctx.textAlign = "left";
    }
  }
}

async function renderSegmentShareCard(canvas, act, effort, segAwards, segment) {
  const W = 1080;
  const pad = 36, left = pad + 36, maxTextW = W - left - pad - 36;
  const rightEdge = W - pad - 36;

  await Promise.all([
    document.fonts.load('400 64px "Instrument Serif"'),
    document.fonts.load('400 34px "IBM Plex Mono"'),
    document.fonts.load('500 32px "DM Sans"'),
    document.fonts.load('600 30px "DM Sans"'),
    document.fonts.load('400 26px "Instrument Serif"'),
    loadLogo(),
  ]).catch(() => {});

  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = W;
  const tmpCtx = tmpCanvas.getContext("2d");

  tmpCtx.font = '400 64px "Instrument Serif", serif';
  const nameLines = wrapText(tmpCtx, effort.segment.name, maxTextW);

  const metaParts = [formatDistance(effort.segment.distance), `${effort.segment.average_grade}% grade`, formatTime(effort.elapsed_time)];
  if (effort.elapsed_time > 0) metaParts.push(formatSpeed(effort.segment.distance / effort.elapsed_time));
  if (effort.device_watts && effort.average_watts) metaParts.push(formatPower(effort.average_watts));
  if (effort.average_heartrate) metaParts.push(`${Math.round(effort.average_heartrate)} bpm`);
  if (effort.average_cadence) metaParts.push(`${Math.round(effort.average_cadence)} rpm`);
  tmpCtx.font = '400 34px "IBM Plex Mono", monospace';
  const metaText = metaParts.join("  ·  ");
  const metaLines = wrapText(tmpCtx, metaText, maxTextW);

  const counts = {};
  const pillOrder = ["year_best", "ytd_best_time", "ytd_best_power", "best_month_ever", "monthly_best", "recent_best", "improvement_streak", "comeback", "closing_in", "top_decile", "top_quartile", "beat_median", "consistency", "milestone", "season_first", "anniversary", "reference_best"];
  for (const a of segAwards) counts[a.type] = (counts[a.type] || 0) + 1;
  tmpCtx.font = '600 30px "DM Sans", sans-serif';
  const allPillRows = layoutPillRows(tmpCtx, counts, pillOrder, left, maxTextW);
  const MAX_PILL_ROWS = 2;
  const pillRows = allPillRows.slice(0, MAX_PILL_ROWS);

  tmpCtx.font = '400 28px "DM Sans", sans-serif';
  const contextText = `${act.name}  ·  ${formatDateShort(act.start_date_local)}`;
  const contextLines = wrapText(tmpCtx, contextText, maxTextW);

  let contentH = 48; // top padding
  contentH += 32 + 48; // header + gap
  contentH += 40; // divider
  contentH += nameLines.length * 74 + 8; // segment name
  contentH += metaLines.length * 42 + 24; // meta

  const hasChart = segment && segment.efforts && segment.efforts.length >= 2;
  const chartH = 220, chartStatsH = 36;
  if (hasChart) contentH += chartH + chartStatsH + 28;

  const awardMsgMaxW = maxTextW - 32;
  tmpCtx.font = '400 28px "DM Sans", sans-serif';
  const displayAwards = segAwards.slice(0, 4);
  const wrappedAwardMsgs = displayAwards.map(a => {
    const msg = a.message || (AWARD_LABELS[a.type]?.label || "");
    return wrapText(tmpCtx, msg, awardMsgMaxW);
  });

  if (segAwards.length > 0) {
    contentH += pillRows.length * 56 + 16 + 32; // pills + gap + divider
    for (const lines of wrappedAwardMsgs) {
      contentH += lines.length * 36 + 16;
    }
    if (segAwards.length > displayAwards.length) contentH += 44;
  }

  contentH += 24 + contextLines.length * 36 + 24; // context section
  contentH += 48; // bottom padding

  const cardY = 36, cardBottom = 36, taglineH = 56;
  const H = cardY + contentH + taglineH + cardBottom;

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = "#EDE9E1";
  ctx.fillRect(0, 0, W, H);

  // Topo texture
  ctx.strokeStyle = "rgba(26, 22, 16, 0.04)";
  ctx.lineWidth = 1;
  const centers = [
    [W * 0.15, H * 0.3], [W * 0.75, H * 0.2], [W * 0.5, H * 0.7],
    [W * 0.85, H * 0.6], [W * 0.25, H * 0.8],
  ];
  for (const [cx, cy] of centers) {
    for (let r = 40; r < 400; r += 50) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Card with shadow
  const cardW = W - pad * 2, cardH = contentH;
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.10)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = "#FDFCFA";
  roundRect(ctx, pad, cardY, cardW, cardH, 20);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "#D8D0C4";
  ctx.lineWidth = 1.5;
  roundRect(ctx, pad, cardY, cardW, cardH, 20);
  ctx.stroke();

  drawLogoWatermark(ctx, W, H, cardY, cardH, pad);

  let y = cardY + 48;

  // Header
  ctx.font = '400 30px "Instrument Serif", serif';
  ctx.fillStyle = "#1A1610";
  ctx.textAlign = "left";
  ctx.fillText("aeyu", left, y);
  const aeyuW = ctx.measureText("aeyu").width;
  ctx.fillStyle = "#B85A28";
  ctx.fillText(".io", left + aeyuW, y);

  ctx.font = '400 30px "DM Sans", sans-serif';
  ctx.fillStyle = "#7A7164";
  ctx.textAlign = "right";
  ctx.fillText("Segment Awards", rightEdge, y);
  ctx.textAlign = "left";
  y += 48;

  // Divider
  ctx.strokeStyle = "#D8D0C4";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(rightEdge, y);
  ctx.stroke();
  y += 40;

  // Segment name — larger
  ctx.font = '400 64px "Instrument Serif", serif';
  ctx.fillStyle = "#1A1610";
  for (const line of nameLines) {
    ctx.fillText(line, left, y);
    y += 74;
  }
  y += 8;

  // Meta
  ctx.font = '400 34px "IBM Plex Mono", monospace';
  ctx.fillStyle = "#4A4438";
  for (const line of metaLines) {
    ctx.fillText(line, left, y);
    y += 42;
  }
  y += 24;

  // Performance chart
  if (hasChart) {
    const chartW = rightEdge - left;
    drawPerformanceChart(ctx, segment, effort.id, left, y, chartW, chartH);
    y += chartH + chartStatsH + 28;
  }

  // Awards
  if (segAwards.length > 0) {
    for (const row of pillRows) {
      for (const pill of row) {
        ctx.font = '600 30px "DM Sans", sans-serif';
        const colors = AWARD_COLORS[pill.type];
        if (!colors) continue;

        const iconSize = 22;
        const iconPad = 6;
        const textW = ctx.measureText(pill.label).width;
        const tw = 16 + iconSize + iconPad + textW + 16;

        ctx.fillStyle = colors.bg;
        roundRect(ctx, pill.x, y - 30, tw, 44, 22);
        ctx.fill();
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 1.5;
        roundRect(ctx, pill.x, y - 30, tw, 44, 22);
        ctx.stroke();

        drawIcon(ctx, pill.type, pill.x + 14, y - 28, iconSize, colors.accent, 2);

        ctx.fillStyle = colors.text;
        ctx.font = '600 30px "DM Sans", sans-serif';
        ctx.fillText(pill.label, pill.x + 14 + iconSize + iconPad, y);
      }
      y += 56;
    }
    y += 16;

    // Divider
    ctx.strokeStyle = "#D8D0C4";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(rightEdge, y);
    ctx.stroke();
    y += 32;

    // Award details — wrapped text
    for (let i = 0; i < displayAwards.length; i++) {
      const award = displayAwards[i];
      const colors = AWARD_COLORS[award.type];
      if (!colors) continue;
      const msgLines = wrappedAwardMsgs[i];

      drawIcon(ctx, award.type, left, y - 14, 22, colors.accent, 2);

      ctx.font = '400 28px "DM Sans", sans-serif';
      ctx.fillStyle = "#4A4438";
      for (const line of msgLines) {
        ctx.fillText(line, left + 32, y + 4);
        y += 36;
      }
      y += 16;
    }

    const remaining = segAwards.length - displayAwards.length;
    if (remaining > 0) {
      ctx.font = '400 26px "DM Sans", sans-serif';
      ctx.fillStyle = "#7A7164";
      ctx.fillText(`+ ${remaining} more awards`, left, y + 8);
    }
  }

  // Context — activity name + date at bottom of card
  y = cardY + contentH - 48 - contextLines.length * 36;
  ctx.strokeStyle = "#D8D0C4";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(left, y - 16);
  ctx.lineTo(rightEdge, y - 16);
  ctx.stroke();
  ctx.font = '400 28px "DM Sans", sans-serif';
  ctx.fillStyle = "#7A7164";
  for (const line of contextLines) {
    ctx.fillText(line, left, y + 8);
    y += 36;
  }

  // Tagline
  ctx.font = 'italic 26px "Instrument Serif", serif';
  ctx.fillStyle = "#7A7164";
  ctx.textAlign = "center";
  ctx.fillText("It's just you and your efforts", W / 2, H - 28);
  ctx.textAlign = "left";
}


/**
 * Build share card highlights: best award per segment, max 4 rows.
 * Deduplicates segments — picks the highest-tier award for each.
 * Includes ride-level awards (no segment) too.
 */
function buildShareCardHighlights(awardsList) {
  const TIER = {
    route_season_first: 20, year_best: 18, ytd_best_time: 17, ytd_best_power: 17,
    np_year_best: 16, peak_power: 16, best_month_ever: 15, top_decile: 14,
    work_year_best: 13, improvement_streak: 12, comeback: 12, closing_in: 11,
    top_quartile: 10, recent_best: 9, np_recent_best: 9, monthly_best: 8,
    work_recent_best: 8, peak_power_recent: 8, beat_median: 7, season_first: 6,
    consistency: 5, milestone: 4, anniversary: 3, distance_record: 15,
    elevation_record: 14, segment_count: 3, endurance_record: 13,
    season_first_power: 12, watt_milestone: 11, kj_milestone: 10, power_progression: 9,
    power_consistency: 5, ftp_milestone: 14, curve_year_best: 16, curve_all_time: 18,
    indoor_np_year_best: 14, indoor_work_year_best: 13,
    trainer_streak: 10, indoor_vs_outdoor: 8, weekly_streak: 10, group_consistency: 5,
    comeback_pb: 12, recovery_milestone: 11,
    comeback_full: 15, comeback_distance: 10, comeback_elevation: 10, comeback_endurance: 10,
    reference_best: 6,
  };
  // Best award per segment (or per unique ride-level type)
  const bySegment = new Map();
  for (const a of awardsList) {
    const key = a.segment_id != null ? `seg:${a.segment_id}` : `ride:${a.type}`;
    const tier = TIER[a.type] || 0;
    if (!bySegment.has(key) || tier > (TIER[bySegment.get(key).type] || 0)) {
      bySegment.set(key, a);
    }
  }
  // Sort by tier descending, take top 4
  return [...bySegment.values()]
    .sort((a, b) => (TIER[b.type] || 0) - (TIER[a.type] || 0))
    .slice(0, 4);
}

/**
 * Layout summary pills into rows that fit within maxTextW (#87).
 */
function layoutPillRows(ctx, counts, order, startX, maxW) {
  const rows = [];
  let currentRow = [];
  let x = startX;
  const iconSize = 22, iconPad = 6, pillPad = 16, gap = 12;

  for (const type of order) {
    if (!counts[type]) continue;
    const label = counts[type] > 1
      ? `${counts[type]}× ${AWARD_LABELS[type].label}`
      : AWARD_LABELS[type].label;
    const textW = ctx.measureText(label).width;
    const tw = pillPad + iconSize + iconPad + textW + pillPad;

    if (currentRow.length > 0 && (x - startX + tw) > maxW) {
      rows.push(currentRow);
      currentRow = [];
      x = startX;
    }
    currentRow.push({ type, label, x });
    x += tw + gap;
  }
  if (currentRow.length > 0) rows.push(currentRow);
  return rows;
}

function roundRect(ctx, x, y, w, h, r) {
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

function wrapText(ctx, text, maxW) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}


// ── Segment Sort ──────────────────────────────────────────────────

const SORT_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "time", label: "Time" },
  { key: "distance", label: "Dist" },
  { key: "grade", label: "Grade" },
  { key: "power", label: "Power" },
  { key: "hr", label: "HR" },
  { key: "cadence", label: "Cadence" },
  { key: "awards", label: "Awards" },
];

function toggleSort(key) {
  if (sortColumn.value === key) {
    if (sortDirection.value === "asc") {
      sortDirection.value = "desc";
    } else {
      // Third click resets to default (activity order)
      sortColumn.value = null;
      sortDirection.value = "asc";
    }
  } else {
    sortColumn.value = key;
    sortDirection.value = key === "name" ? "asc" : "desc";
  }
}

function sortEfforts(efforts, effortAwards) {
  const col = sortColumn.value;
  if (!col) return efforts;
  const dir = sortDirection.value === "asc" ? 1 : -1;

  return [...efforts].sort((a, b) => {
    let va, vb;
    switch (col) {
      case "name":
        va = a.segment.name.toLowerCase();
        vb = b.segment.name.toLowerCase();
        return va < vb ? -dir : va > vb ? dir : 0;
      case "time":
        va = a.elapsed_time || 0;
        vb = b.elapsed_time || 0;
        break;
      case "distance":
        va = a.segment.distance || 0;
        vb = b.segment.distance || 0;
        break;
      case "grade":
        va = a.segment.average_grade || 0;
        vb = b.segment.average_grade || 0;
        break;
      case "power":
        va = (a.device_watts && a.average_watts) || 0;
        vb = (b.device_watts && b.average_watts) || 0;
        break;
      case "hr":
        va = a.average_heartrate || 0;
        vb = b.average_heartrate || 0;
        break;
      case "cadence":
        va = a.average_cadence || 0;
        vb = b.average_cadence || 0;
        break;
      case "awards":
        va = (effortAwards.get(a.segment.id) || []).length;
        vb = (effortAwards.get(b.segment.id) || []).length;
        break;
      default:
        return 0;
    }
    return (va - vb) * dir;
  });
}

function SortArrow({ col }) {
  if (sortColumn.value !== col) return null;
  const up = sortDirection.value === "asc";
  return html`<span class="ml-0.5" style="font-size: 0.6rem; line-height: 1;">${up ? "▲" : "▼"}</span>`;
}

function SegmentSortBar({ efforts, effortAwards }) {
  const hasPower = efforts.some(e => e.device_watts && e.average_watts);
  const hasHR = efforts.some(e => e.average_heartrate);
  const hasCadence = efforts.some(e => e.average_cadence);

  return html`
    <div class="flex flex-wrap gap-1.5 mb-3" style="font-family: var(--font-body);">
      ${SORT_COLUMNS.filter(c => {
        if (c.key === "power" && !hasPower) return false;
        if (c.key === "hr" && !hasHR) return false;
        if (c.key === "cadence" && !hasCadence) return false;
        return true;
      }).map(c => {
        const active = sortColumn.value === c.key;
        return html`
          <button
            key=${c.key}
            onClick=${() => toggleSort(c.key)}
            class="inline-flex items-center text-xs px-2 py-1 rounded-lg transition-colors"
            style=${active
              ? "background: var(--accent); color: var(--text-on-dark); font-weight: 600;"
              : "background: var(--surface); color: var(--text-tertiary); border: 1px solid var(--border); cursor: pointer;"}
          >
            ${c.label}<${SortArrow} col=${c.key} />
          </button>
        `;
      })}
    </div>
  `;
}

// ── Component ─────────────────────────────────────────────────────

export function ActivityDetail({ id }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (id) loadActivity(id);
  }, [id]);

  const act = activity.value;
  const isCardGenerated = cardGenerated.value;

  if (loading.value) {
    return html`
      <div class="min-h-screen flex items-center justify-center" style="background: var(--bg);">
        <p style="color: var(--text-tertiary);">Loading activity...</p>
      </div>
    `;
  }

  if (!act) {
    return html`
      <div class="min-h-screen flex items-center justify-center" style="background: var(--bg);">
        <div class="text-center">
          <p style="color: var(--text-secondary);">Activity not found</p>
          <button onClick=${() => navigate(isDemo.value ? "/demo" : "/dashboard")} class="mt-4" style="color: var(--accent);">
            Back to dashboard
          </button>
        </div>
      </div>
    `;
  }

  const effortAwards = new Map();
  for (const award of awards.value) {
    if (!effortAwards.has(award.segment_id)) {
      effortAwards.set(award.segment_id, []);
    }
    effortAwards.get(award.segment_id).push(award);
  }

  function handleCopy() {
    const text = buildSummary(act, awards.value);
    navigator.clipboard.writeText(text).then(() => {
      copied.value = true;
      setTimeout(() => { copied.value = false; }, 2000);
    }).catch(() => {});
  }

  async function handleGenerateImage() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    segmentCardGenerated.value = null;
    await renderShareCard(canvas, act, awards.value);
    canvas.style.display = "block";
    cardGenerated.value = true;
  }

  async function handleGenerateSegmentImage(effort, segAwards) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    cardGenerated.value = false;
    const seg = segmentHistory.value.get(effort.segment.id);
    await renderSegmentShareCard(canvas, act, effort, segAwards, seg);
    canvas.style.display = "block";
    segmentCardGenerated.value = effort.segment.id;
    // Scroll canvas into view
    canvas.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function shareOrSaveCanvas(filename) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], filename, { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] }).catch(() => downloadBlob(blob, filename));
          return;
        }
      }
      downloadBlob(blob, filename);
    }, "image/png");
  }

  function copyCanvasToClipboard() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob })
      ]).then(() => {
        copied.value = true;
        setTimeout(() => { copied.value = false; }, 2000);
      }).catch(() => {});
    }, "image/png");
  }

  function handleSaveImage() {
    const segId = segmentCardGenerated.value;
    if (segId) {
      const effort = act.segment_efforts?.find(e => e.segment.id === segId);
      const name = effort ? effort.segment.name : "segment";
      shareOrSaveCanvas(`${name.replace(/[^a-z0-9]/gi, "-")}-awards.png`);
    } else {
      shareOrSaveCanvas(`${act.name.replace(/[^a-z0-9]/gi, "-")}-awards.png`);
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "awards.png";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleResync() {
    if (resyncing.value) return;
    resyncing.value = true;
    resyncError.value = null;
    try {
      await resyncActivity(Number(id));
      await loadActivity(id);
    } catch (err) {
      resyncError.value = err.message || "Resync failed";
    } finally {
      resyncing.value = false;
    }
  }

  // Ride-level power display
  const ridePower = (act.device_watts || act.sport_type === "VirtualRide") && act.average_watts ? formatPower(act.average_watts) : null;

  return html`
    <div class="min-h-screen" style="background: var(--bg);">
      <${StickyHeader}
        onBack=${() => navigate(isDemo.value ? "/demo" : "/dashboard")}
        backLabel="Dashboard"
        contextLabel=${act.name}
        unitSystem=${unitSystem.value}
        onUnitToggle=${async () => {
          const next = unitSystem.value === "metric" ? "imperial" : "metric";
          await setUnitPreference(next);
          await loadActivity(id);
        }}
        menuItems=${[
          ...(!isDemo.value ? [{
            label: resyncing.value ? "Resyncing…" : "Resync activity",
            onClick: handleResync,
            hidden: resyncing.value,
          }] : []),
          {
            label: "View on Strava",
            onClick: () => window.open(`https://www.strava.com/activities/${act.id}`, "_blank"),
          },
        ]}
        rightSlot=${!isDemo.value && html`
          <button
            onClick=${handleResync}
            disabled=${resyncing.value}
            class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            style="border: 1px solid rgba(255,255,255,0.3); color: rgba(255,255,255,0.9); font-family: var(--font-body); background: rgba(255,255,255,0.1);"
            title="Re-fetch this activity from Strava"
          >
            <svg class="w-3 h-3 ${resyncing.value ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
            </svg>
            ${resyncing.value ? "Resyncing…" : "Resync"}
          </button>
        `}
      />

      <!-- Activity title bar (below sticky header) -->
      <div style="background: var(--accent);">
        <div class="max-w-3xl mx-auto px-4 pb-4">
          <div class="flex items-center gap-2 mb-1">
            <h1 style="font-family: var(--font-display); font-size: 1.25rem; color: var(--text-on-dark);">${act.name}</h1>
            <a href=${`https://www.strava.com/activities/${act.id}`} target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 flex-shrink-0 text-xs font-semibold" style="color: rgba(255,255,255,0.8); text-decoration: none; transition: opacity 0.15s;" onMouseOver=${e => e.currentTarget.style.opacity = '0.7'} onMouseOut=${e => e.currentTarget.style.opacity = '1'}>
              View on Strava
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            </a>
          </div>
          ${resyncError.value && html`
            <div class="mb-1 text-xs" style="color: #FFB0A0;">${resyncError.value}</div>
          `}
          <p style="font-family: var(--font-mono); font-size: 14px; color: rgba(255,255,255,0.7);">
            ${formatDateFull(act.start_date_local)}
            · ${formatDistance(act.distance)}
            · ${formatTime(act.moving_time)}
            ${act.average_speed ? ` · ${formatSpeed(act.average_speed)}` : ""}
            ${act.total_elevation_gain ? ` · ${formatElevation(act.total_elevation_gain)} elevation` : ""}
            ${ridePower ? ` · ${ridePower} avg` : ""}
          </p>
        </div>
      </div>

      <main class="max-w-3xl mx-auto px-6 py-6">
        <!-- Awards summary — compact pill row + ride-level awards + share (#88) -->
        ${awards.value.length > 0 && html`
          <div class="rounded-xl p-4 mb-6" style="background: var(--surface); border: 1px solid var(--border);">
            <h2 style="font-family: var(--font-body); font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem;">Awards Earned</h2>
            <!-- Compact award type pills with counts -->
            <div class="flex flex-wrap gap-1.5">
              ${(() => {
                const counts = {};
                for (const a of awards.value) {
                  counts[a.type] = (counts[a.type] || 0) + 1;
                }
                return Object.entries(counts).map(([type, count]) => {
                  const al = AWARD_LABELS[type];
                  const pillStyle = al ? `background: ${al.bg}; color: ${al.text}; border: 1px solid ${al.border};` : "background: #ECEAE6; color: #3E3A36;";
                  const label = al?.label || type;
                  return html`
                    <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full cursor-help" style=${pillStyle} title=${al?.tip || ""}>
                      ${al ? renderIconSVG(type, { size: 12, color: al.dot }) : null}
                      ${count > 1 ? `${count}× ${label}` : label}
                    </span>
                  `;
                });
              })()}
            </div>

            <!-- Ride-level awards detail -->
            ${(() => {
              const rideAwards = awards.value.filter(a => !a.segment_id);
              if (rideAwards.length === 0) return null;
              return html`
                <div class="mt-3 space-y-1.5">
                  ${rideAwards.map(award => {
                    const al = AWARD_LABELS[award.type];
                    // Route Season First with expandable segment list
                    if (award.type === "route_season_first" && award._collapsed_season_firsts) {
                      return html`
                        <div class="flex items-start gap-2 p-2 rounded-lg" style="background: var(--bg);">
                          ${al ? renderIconSVG(award.type, { size: 16, color: al.dot }) : null}
                          <div class="flex-1">
                            <p style="font-family: var(--font-body); font-size: 0.8125rem; color: var(--text-secondary);">${award.message}</p>
                            <details class="mt-1">
                              <summary class="text-xs cursor-pointer" style="color: var(--text-tertiary);">
                                ${award._collapsed_season_firsts.length} segment Season Firsts
                              </summary>
                              <div class="mt-1 space-y-1 pl-2" style="border-left: 2px solid ${AWARD_LABELS.season_first.border};">
                                ${award._collapsed_season_firsts.map(sf => html`
                                  <div class="flex items-start gap-2 py-0.5">
                                    ${renderIconSVG("season_first", { size: 12, color: AWARD_LABELS.season_first.dot })}
                                    <p class="text-xs" style="color: var(--text-secondary);">${sf.message}</p>
                                  </div>
                                `)}
                              </div>
                            </details>
                          </div>
                        </div>
                      `;
                    }
                    return html`
                      <div class="flex items-start gap-2 p-2 rounded-lg" style="background: var(--bg);">
                        ${al ? renderIconSVG(award.type, { size: 16, color: al.dot }) : null}
                        <p style="font-family: var(--font-body); font-size: 0.8125rem; color: var(--text-secondary);">${award.message}</p>
                      </div>
                    `;
                  })}
                </div>
              `;
            })()}

            <!-- Share actions -->
            <div class="mt-4 pt-4" style="border-top: 1px solid var(--border-light);">
              <div class="flex flex-wrap gap-2">
                <button
                  onClick=${handleCopy}
                  class="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors"
                  style="border: 1px solid var(--border); color: var(--text-secondary); font-family: var(--font-body);"
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                  </svg>
                  ${copied.value ? "Copied!" : "Copy Summary"}
                </button>
                <button
                  onClick=${handleGenerateImage}
                  class="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors"
                  style="border: 1px solid var(--border); color: var(--text-secondary); font-family: var(--font-body);"
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                  </svg>
                  Generate Share Image
                </button>
              </div>

              <!-- Canvas + save/share/copy -->
              <canvas ref=${canvasRef} style="display:none; width:100%; max-width:540px; height:auto; margin-top:12px; border-radius:12px;"></canvas>
              ${(isCardGenerated || segmentCardGenerated.value) && html`
                <div class="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick=${handleSaveImage}
                    class="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-white transition-colors"
                    style="background: var(--strava); font-family: var(--font-body);"
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                    </svg>
                    Save / Share
                  </button>
                  <button
                    onClick=${copyCanvasToClipboard}
                    class="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg transition-colors"
                    style="border: 1px solid var(--border); color: var(--text-secondary); font-family: var(--font-body);"
                  >
                    <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                    </svg>
                    ${copied.value ? "Copied!" : "Copy Image"}
                  </button>
                </div>
              `}

            </div>
          </div>
        `}

        <!-- LLM Export — always visible -->
        <div class="rounded-xl p-4 mb-6" style="background: var(--surface); border: 1px solid var(--border);">
          <p class="text-xs font-medium mb-1" style="color: var(--text-secondary); font-family: var(--font-body);">Export for AI Coach</p>
          <p class="text-xs mb-2" style="color: var(--border);">Copy this ride's data for use with an LLM.</p>
          <div class="flex flex-wrap items-center gap-2 mb-2">
            <select
              value=${llmExportFormat.value}
              onChange=${(e) => { llmExportFormat.value = e.target.value; llmExportStatus.value = null; }}
              class="text-xs rounded px-2 py-1 focus:outline-none"
              style="border: 1px solid var(--border); background: var(--bg-card); color: var(--text); font-family: var(--font-mono);"
            >
              <option value="markdown">Markdown</option>
              <option value="json">JSON</option>
            </select>
            <label class="inline-flex items-center gap-1 text-xs cursor-pointer" style="color: var(--text-secondary); font-family: var(--font-body);">
              <input
                type="checkbox"
                checked=${llmIncludeForm.value}
                onChange=${(e) => { llmIncludeForm.value = e.target.checked; llmExportStatus.value = null; }}
                class="rounded"
                style="accent-color: var(--accent);"
              />
              Include form context
            </label>
          </div>
          <button
            onClick=${async () => {
              llmExportStatus.value = "loading";
              try {
                const textPromise = (async () => {
                  const ctx = await buildRideExport(act.id, { includeForm: llmIncludeForm.value });
                  if (!ctx) throw new Error("Activity not found");
                  return llmExportFormat.value === "markdown" ? rideToMarkdown(ctx) : JSON.stringify(ctx, null, 2);
                })();
                const blobPromise = textPromise.then(t => new Blob([t], { type: "text/plain" }));
                await navigator.clipboard.write([new ClipboardItem({ "text/plain": blobPromise })]);
                llmExportStatus.value = "copied";
                setTimeout(() => { llmExportStatus.value = null; }, 3000);
              } catch (e) {
                console.error("Ride export failed:", e);
                llmExportStatus.value = "error";
                setTimeout(() => { llmExportStatus.value = null; }, 3000);
              }
            }}
            disabled=${llmExportStatus.value === "loading"}
            class="text-xs transition-colors"
            style="color: var(--accent);"
          >
            ${llmExportStatus.value === "loading" ? "Building export..." : llmExportStatus.value === "copied" ? "Copied to clipboard!" : llmExportStatus.value === "error" ? "Export failed" : "Copy ride data to clipboard"}
          </button>
        </div>

        <!-- Segment efforts — summary cards with expandable detail (#88) -->
        ${act.has_efforts && act.segment_efforts && act.segment_efforts.length > 0 && html`
          <h2 style="font-family: var(--font-display); font-size: 1.125rem; color: var(--text); margin-bottom: 0.75rem;">Segment Efforts</h2>

          <!-- Sort header -->
          <${SegmentSortBar} efforts=${act.segment_efforts} effortAwards=${effortAwards} />

          <div class="space-y-3">
            ${sortEfforts(act.segment_efforts, effortAwards).map((effort) => {
              const seg = segmentHistory.value.get(effort.segment.id);
              const segAwards = effortAwards.get(effort.segment.id) || [];
              const effortCount = seg ? seg.efforts.length : 0;
              const effortSpeed = effort.elapsed_time > 0
                ? formatSpeed(effort.segment.distance / effort.elapsed_time)
                : null;
              const effortPower = effort.device_watts && effort.average_watts
                ? formatPower(effort.average_watts)
                : null;
              const effortHR = effort.average_heartrate
                ? `${Math.round(effort.average_heartrate)} bpm`
                : null;
              const effortCadence = effort.average_cadence
                ? `${Math.round(effort.average_cadence)} rpm`
                : null;
              const hasAwards = segAwards.length > 0;

              return html`
                <div class="relative rounded-xl p-4" style=${hasAwards
                  ? "background: var(--surface); border: 1px solid var(--border);"
                  : "background: var(--surface); border: 1px solid var(--border); opacity: 0.7;"}>
                  <a href=${`https://www.strava.com/segments/${effort.segment.id}`} target="_blank" rel="noopener noreferrer" class="absolute inline-flex items-center gap-0.5 flex-shrink-0 whitespace-nowrap" style="top: 0.75rem; right: 0.75rem; font-size: 0.625rem; font-weight: 600; color: var(--strava); text-decoration: none; opacity: 0.6; transition: opacity 0.15s;" onMouseOver=${e => e.currentTarget.style.opacity = '1'} onMouseOut=${e => e.currentTarget.style.opacity = '0.6'} onClick=${e => e.stopPropagation()}>
                    View on Strava
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                  </a>
                  <div class="pr-20" style="font-family: var(--font-body); font-size: 16px; font-weight: 500; color: var(--text);">
                    ${effort.segment.name}
                  </div>
                  <div class="mt-1" style="font-family: var(--font-mono); font-size: 14px; color: var(--text-secondary);">
                    ${formatDistance(effort.segment.distance)}
                    · ${effort.segment.average_grade}% grade
                    · ${formatTime(effort.elapsed_time)}
                    ${effortSpeed ? ` · ${effortSpeed}` : ""}
                    ${effortPower ? ` · ${effortPower}` : ""}
                    ${effortHR ? ` · ${effortHR}` : ""}
                    ${effortCadence ? ` · ${effortCadence}` : ""}
                    ${effortCount > 1 ? ` · ${effortCount} efforts` : ""}
                  </div>
                  ${effort.pr_rank && html`
                    <div class="mt-1" style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--strava);">Strava PR #${effort.pr_rank}</div>
                  `}
                  ${seg && seg.efforts && seg.efforts.length >= 2 && html`
                    <${SegmentSparkline} segment=${seg} currentEffortId=${effort.id} />
                  `}
                  ${hasAwards && html`
                    <div class="flex flex-wrap gap-1 mt-2">
                      ${segAwards.map(
                        (a) => {
                          const al = AWARD_LABELS[a.type];
                          const pillStyle = al ? `background: ${al.bg}; color: ${al.text}; border: 1px solid ${al.border};` : "background: #ECEAE6; color: #3E3A36;";
                          const rankSuffix = (n) => { const s = ["th","st","nd","rd"]; const v = n % 100; return n + (s[(v-20)%10]||s[v]||s[0]); };
                          const isYtd = a.type === "ytd_best_time" || a.type === "ytd_best_power";
                          const deltaLabel = a.type === "ytd_best_power" ? "more powerful" : "faster";
                          const setLabel = isYtd ? (a.totalInSet === 1 ? "year" : "years") : "";
                          const rankInfo = a.rank != null && a.totalInSet != null
                            ? ` · ${rankSuffix(a.rank)} of ${a.totalInSet}${isYtd ? ` ${setLabel}` : ""}${a.pctDelta ? `, ${a.pctDelta}% ${deltaLabel}` : ""}`
                            : "";
                          return html`
                            <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full cursor-help" style=${pillStyle} title=${al?.tip || ""}>
                              ${al ? renderIconSVG(a.type, { size: 12, color: al.dot }) : null}
                              ${al?.label || a.type}${rankInfo}
                            </span>
                          `;
                        }
                      )}
                    </div>
                    <div class="flex items-center gap-3 mt-2">
                      <details class="flex-1">
                        <summary class="text-xs cursor-pointer select-none" style="color: var(--text-tertiary); font-family: var(--font-body);">
                          Award details
                        </summary>
                        <div class="mt-2 space-y-1.5 pl-1" style="border-left: 2px solid var(--border);">
                          ${segAwards.map(a => {
                            const al = AWARD_LABELS[a.type];
                            return html`
                              <div class="flex items-start gap-2 py-0.5 pl-2">
                                ${al ? renderIconSVG(a.type, { size: 14, color: al.dot }) : null}
                                <p class="text-xs" style="color: var(--text-secondary); font-family: var(--font-body);">${a.message}</p>
                              </div>
                            `;
                          })}
                        </div>
                      </details>
                      <button
                        onClick=${() => handleGenerateSegmentImage(effort, segAwards)}
                        class="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg transition-colors whitespace-nowrap"
                        style="border: 1px solid var(--border); color: var(--text-tertiary); font-family: var(--font-body);"
                        title="Share this segment's awards"
                      >
                        <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                          <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/>
                        </svg>
                        Share Segment
                      </button>
                    </div>
                  `}
                  ${effortCount >= 2 && html`
                    <button
                      onClick=${async (e) => {
                        e.stopPropagation();
                        const sid = effort.segment.id;
                        segmentLlmExportStatus.value = { segmentId: sid, state: "loading" };
                        try {
                          const textPromise = (async () => {
                            const ctx = await buildSegmentExport(sid);
                            if (!ctx) throw new Error("Segment not found");
                            return llmExportFormat.value === "markdown" ? segmentToMarkdown(ctx) : JSON.stringify(ctx, null, 2);
                          })();
                          const blobPromise = textPromise.then(t => new Blob([t], { type: "text/plain" }));
                          await navigator.clipboard.write([new ClipboardItem({ "text/plain": blobPromise })]);
                          segmentLlmExportStatus.value = { segmentId: sid, state: "copied" };
                          setTimeout(() => { segmentLlmExportStatus.value = null; }, 3000);
                        } catch (err) {
                          console.error("Segment export failed:", err);
                          segmentLlmExportStatus.value = { segmentId: sid, state: "error" };
                          setTimeout(() => { segmentLlmExportStatus.value = null; }, 3000);
                        }
                      }}
                      disabled=${segmentLlmExportStatus.value?.segmentId === effort.segment.id && segmentLlmExportStatus.value?.state === "loading"}
                      class="inline-flex items-center gap-1 text-xs mt-2 transition-colors"
                      style="color: var(--accent); font-family: var(--font-body);"
                      title="Export this segment's effort history for LLM analysis"
                    >
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"/>
                      </svg>
                      ${segmentLlmExportStatus.value?.segmentId === effort.segment.id
                        ? segmentLlmExportStatus.value.state === "loading" ? "Exporting..." : segmentLlmExportStatus.value.state === "copied" ? "Copied!" : "Export failed"
                        : "Export for AI"}
                    </button>
                  `}
                </div>
              `;
            })}
          </div>
        `}

        ${!act.has_efforts && html`
          <div class="rounded-lg p-4" style="background: #FBF0D8; border: 1px solid #E8D4A0; font-family: var(--font-body); font-size: 0.875rem; color: #6E5010;">
            Segment details have not been loaded yet for this activity. Run a sync to fetch them.
          </div>
        `}

      </main>

      <!-- Powered by Strava -->
      <footer class="text-center py-4 mt-4" style="border-top: 1px solid var(--border);">
        <img src="assets/strava/api_logo_pwrdBy_strava_horiz_orange.svg" alt="Powered by Strava" style="height: 18px; display: inline-block; opacity: 0.6;" />
      </footer>
    </div>
  `;
}
