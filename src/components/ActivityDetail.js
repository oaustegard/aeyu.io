/**
 * Activity Detail Screen
 * Shows all segment efforts for an activity with award indicators.
 * Includes share card generation (Canvas) and copy-to-clipboard summary.
 */

import { html } from "htm/preact";
import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { getActivity, getSegment, getAllActivities, getResetEvent, getUserConfig, getAllRoutes } from "../db.js";
import { computeAwards, computeRideLevelAwards } from "../awards.js";
import { detectRoutes, findRouteForActivity } from "../routes.js";
import { resyncActivity } from "../sync.js";
import { isDemo } from "../demo.js";
import { navigate } from "../app.js";
import {
  formatDistance,
  formatTime,
  formatDate,
  formatDateFull,
  formatElevation,
  formatPower,
} from "../units.js";
import { renderIconSVG, drawIcon } from "../icons.js";
import { AWARD_LABELS, AWARD_COLORS } from "../award-config.js";

const activity = signal(null);
const awards = signal([]);
const segmentHistory = signal(new Map());
const loading = signal(true);
const copied = signal(false);
const cardGenerated = signal(false);
const resyncing = signal(false);
const resyncError = signal(null);

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
          routes = detectRoutes(withEfforts);
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
  }
}


// ── Text Summary ──────────────────────────────────────────────────

function buildSummary(act, awardsList) {
  const lines = [];
  lines.push(act.name);
  let meta = `${formatDateShort(act.start_date_local)} · ${formatDistance(act.distance)} · ${formatTime(act.moving_time)}`;
  if (act.total_elevation_gain) meta += ` · ${formatElevation(act.total_elevation_gain)}`;
  if (act.device_watts && act.average_watts) meta += ` · ${formatPower(act.average_watts)}`;
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


// ── Canvas Share Card ─────────────────────────────────────────────

async function renderShareCard(canvas, act, awardsList) {
  const W = 1080;
  const pad = 60, left = pad + 48, maxTextW = W - left - pad - 48;
  const rightEdge = W - pad - 48;

  // Wait for fonts to load
  await Promise.all([
    document.fonts.load('400 52px "Instrument Serif"'),
    document.fonts.load('400 30px "IBM Plex Mono"'),
    document.fonts.load('500 28px "DM Sans"'),
    document.fonts.load('600 26px "DM Sans"'),
    document.fonts.load('400 24px "Instrument Serif"'),
  ]).catch(() => {});

  // Pre-measure to compute dynamic height
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = W;
  const tmpCtx = tmpCanvas.getContext("2d");
  tmpCtx.font = '400 52px "Instrument Serif", serif';
  const nameLines = wrapText(tmpCtx, act.name, maxTextW);

  // Build meta text and measure for wrapping (#87)
  const metaParts = [formatDateShort(act.start_date_local), formatDistance(act.distance), formatTime(act.moving_time)];
  if (act.total_elevation_gain) metaParts.push(formatElevation(act.total_elevation_gain));
  if (act.device_watts && act.average_watts) metaParts.push(formatPower(act.average_watts));
  tmpCtx.font = '400 30px "IBM Plex Mono", monospace';
  const metaText = metaParts.join("  ·  ");
  const metaLines = wrapText(tmpCtx, metaText, maxTextW);

  // Deduplicate awards for share card: best award per segment, max 5 highlights (#87)
  const highlightAwards = buildShareCardHighlights(awardsList);

  // Pre-measure pill rows for wrapping (#87)
  const counts = {};
  const pillOrder = ["route_season_first", "season_first", "year_best", "ytd_best_time", "ytd_best_power", "best_month_ever", "monthly_best", "recent_best", "improvement_streak", "comeback", "closing_in", "top_decile", "top_quartile", "beat_median", "consistency", "milestone", "anniversary", "distance_record", "elevation_record", "segment_count", "endurance_record", "season_first_power", "np_year_best", "np_recent_best", "work_year_best", "work_recent_best", "peak_power", "peak_power_recent", "indoor_np_year_best", "indoor_work_year_best", "trainer_streak", "indoor_vs_outdoor"];
  for (const a of awardsList) counts[a.type] = (counts[a.type] || 0) + 1;
  tmpCtx.font = '600 26px "DM Sans", sans-serif';
  const pillRows = layoutPillRows(tmpCtx, counts, pillOrder, left, maxTextW);

  // Calculate height
  let contentH = 60;  // top padding in card
  contentH += 28 + 60; // header + gap
  contentH += 48;      // divider gap
  contentH += nameLines.length * 62 + 8; // title
  contentH += metaLines.length * 38 + 26; // meta lines + gap

  if (awardsList.length > 0) {
    contentH += pillRows.length * 52 + 20 + 36; // pill rows + gap + divider
    for (const a of highlightAwards) {
      contentH += (a.delta && a.delta > 0) ? 60 : 48;
    }
    if (awardsList.length > highlightAwards.length) contentH += 40;
  }
  contentH += 48; // bottom padding in card

  const cardY = 60, cardBottom = 60;
  const taglineH = 60;
  const H = cardY + contentH + taglineH + cardBottom;

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background — warm paper
  ctx.fillStyle = "#F6F3EE";
  ctx.fillRect(0, 0, W, H);

  // Topo texture — concentric circles at 3% opacity
  ctx.strokeStyle = "rgba(26, 22, 16, 0.03)";
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

  // Card container
  const cardW = W - pad * 2, cardH = contentH;
  ctx.fillStyle = "#FFFFFF";
  roundRect(ctx, pad, cardY, cardW, cardH, 24);
  ctx.fill();
  ctx.strokeStyle = "#E5DFD4";
  ctx.lineWidth = 1;
  roundRect(ctx, pad, cardY, cardW, cardH, 24);
  ctx.stroke();

  let y = cardY + 60;

  // Header — wordmark left, "Participation Awards" right
  ctx.font = '400 28px "Instrument Serif", serif';
  ctx.fillStyle = "#1A1610";
  ctx.textAlign = "left";
  ctx.fillText("aeyu", left, y);
  const aeyuW = ctx.measureText("aeyu").width;
  ctx.fillStyle = "#B85A28";
  ctx.fillText(".io", left + aeyuW, y);

  ctx.font = '400 28px "DM Sans", sans-serif';
  ctx.fillStyle = "#8C8374";
  ctx.textAlign = "right";
  ctx.fillText("Participation Awards", rightEdge, y);
  ctx.textAlign = "left";
  y += 60;

  // Divider
  ctx.strokeStyle = "#E5DFD4";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(rightEdge, y);
  ctx.stroke();
  y += 48;

  // Activity name
  ctx.font = '400 52px "Instrument Serif", serif';
  ctx.fillStyle = "#1A1610";
  for (const line of nameLines) {
    ctx.fillText(line, left, y);
    y += 62;
  }
  y += 8;

  // Meta — wrapped to fit (#87)
  ctx.font = '400 30px "IBM Plex Mono", monospace';
  ctx.fillStyle = "#5C5548";
  for (const line of metaLines) {
    ctx.fillText(line, left, y);
    y += 38;
  }
  y += 26;

  // Awards
  if (awardsList.length > 0) {
    // Summary pills — multi-row wrapping (#87)
    for (const row of pillRows) {
      for (const pill of row) {
        ctx.font = '600 26px "DM Sans", sans-serif';
        const colors = AWARD_COLORS[pill.type];
        if (!colors) continue;

        const iconSize = 20;
        const iconPad = 6;
        const textW = ctx.measureText(pill.label).width;
        const tw = 16 + iconSize + iconPad + textW + 16;

        ctx.fillStyle = colors.bg;
        roundRect(ctx, pill.x, y - 28, tw, 40, 20);
        ctx.fill();
        ctx.strokeStyle = colors.border;
        ctx.lineWidth = 1;
        roundRect(ctx, pill.x, y - 28, tw, 40, 20);
        ctx.stroke();

        drawIcon(ctx, pill.type, pill.x + 14, y - 26, iconSize, colors.accent, 2);

        ctx.fillStyle = colors.text;
        ctx.font = '600 26px "DM Sans", sans-serif';
        ctx.fillText(pill.label, pill.x + 14 + iconSize + iconPad, y);
      }
      y += 52;
    }
    y += 20;

    // Divider
    ctx.strokeStyle = "#E5DFD4";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(rightEdge, y);
    ctx.stroke();
    y += 36;

    // Top segment highlights — deduplicated, max 5 (#87)
    for (const award of highlightAwards) {
      const colors = AWARD_COLORS[award.type];
      if (!colors) continue;

      drawIcon(ctx, award.type, left, y - 14, 20, colors.accent, 2);

      ctx.font = '500 28px "DM Sans", sans-serif';
      ctx.fillStyle = "#1A1610";
      const segName = award.segment || award.route_name || "";
      const awardLabel = AWARD_LABELS[award.type]?.label || "";
      const displayName = segName ? `${segName} — ${awardLabel}` : awardLabel;
      // Truncate to fit
      let truncated = displayName;
      const rightLabelW = 150; // reserve space for time/power
      while (ctx.measureText(truncated).width > maxTextW - rightLabelW - 28 && truncated.length > 3) {
        truncated = truncated.slice(0, -4) + "…";
      }
      ctx.fillText(truncated, left + 28, y + 4);

      const rightLabel = award.time != null ? formatTime(award.time) : (award.power ? `${Math.round(award.power)}W` : "");
      ctx.font = '500 28px "IBM Plex Mono", monospace';
      ctx.fillStyle = colors.accent;
      ctx.textAlign = "right";
      ctx.fillText(rightLabel, rightEdge, y + 4);
      ctx.textAlign = "left";

      if (award.delta && award.delta > 0) {
        ctx.font = '400 22px "IBM Plex Mono", monospace';
        ctx.fillStyle = "#8C8374";
        ctx.fillText(`${formatTime(award.delta)} faster`, left + 28, y + 30);
      }
      y += (award.delta && award.delta > 0) ? 60 : 48;
    }

    const remaining = awardsList.length - highlightAwards.length;
    if (remaining > 0) {
      ctx.font = '400 24px "DM Sans", sans-serif';
      ctx.fillStyle = "#8C8374";
      ctx.fillText(`+ ${remaining} more awards`, left, y + 8);
    }
  }

  // Tagline
  ctx.font = 'italic 24px "Instrument Serif", serif';
  ctx.fillStyle = "#8C8374";
  ctx.textAlign = "center";
  ctx.fillText("It's just you and your efforts", W / 2, H - 30);
  ctx.textAlign = "left";
}

/**
 * Build share card highlights: best award per segment, max 5 rows (#87).
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
    season_first_power: 12, indoor_np_year_best: 14, indoor_work_year_best: 13,
    trainer_streak: 10, indoor_vs_outdoor: 8, comeback_pb: 12, recovery_milestone: 11,
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
  // Sort by tier descending, take top 5
  return [...bySegment.values()]
    .sort((a, b) => (TIER[b.type] || 0) - (TIER[a.type] || 0))
    .slice(0, 5);
}

/**
 * Layout summary pills into rows that fit within maxTextW (#87).
 */
function layoutPillRows(ctx, counts, order, startX, maxW) {
  const rows = [];
  let currentRow = [];
  let x = startX;
  const iconSize = 20, iconPad = 6, pillPad = 16, gap = 12;

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
          <button onClick=${() => navigate("dashboard")} class="mt-4" style="color: var(--accent);">
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
    await renderShareCard(canvas, act, awards.value);
    canvas.style.display = "block";
    cardGenerated.value = true;
  }

  function handleSaveImage() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      if (navigator.share && navigator.canShare) {
        const file = new File([blob], `${act.name.replace(/[^a-z0-9]/gi, "-")}-awards.png`, { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file] }).catch(() => downloadBlob(blob));
          return;
        }
      }
      downloadBlob(blob);
    }, "image/png");
  }

  function downloadBlob(blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${act.name.replace(/[^a-z0-9]/gi, "-")}-awards.png`;
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
  const ridePower = act.device_watts && act.average_watts ? formatPower(act.average_watts) : null;

  return html`
    <div class="min-h-screen" style="background: var(--bg);">
      <header class="px-6 py-4" style="background: var(--surface); border-bottom: 1px solid var(--border);">
        <div class="max-w-3xl mx-auto">
          <button onClick=${() => navigate("dashboard")} class="text-sm mb-2 block" style="color: var(--accent);">
            ← Back to dashboard
          </button>
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <h1 style="font-family: var(--font-display); font-size: 1.25rem; color: var(--text);">${act.name}</h1>
              <a href=${`https://www.strava.com/activities/${act.id}`} target="_blank" rel="noopener noreferrer" title="View on Strava" class="flex-shrink-0" style="color: var(--strava); opacity: 0.7; transition: opacity 0.15s;" onMouseOver=${e => e.currentTarget.style.opacity = '1'} onMouseOut=${e => e.currentTarget.style.opacity = '0.7'}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              </a>
            </div>
            ${!isDemo.value && html`
              <button
                onClick=${handleResync}
                disabled=${resyncing.value}
                class="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                style="border: 1px solid var(--border); color: var(--text-secondary); font-family: var(--font-body);"
                title="Re-fetch this activity from Strava"
              >
                <svg class="w-3.5 h-3.5 ${resyncing.value ? 'animate-spin' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
                ${resyncing.value ? "Resyncing…" : "Resync"}
              </button>
            `}
          </div>
          ${resyncError.value && html`
            <div class="mt-1 text-xs" style="color: #A03020;">${resyncError.value}</div>
          `}
          <p style="font-family: var(--font-mono); font-size: 14px; color: var(--text-secondary);">
            ${formatDateFull(act.start_date_local)}
            · ${formatDistance(act.distance)}
            · ${formatTime(act.moving_time)}
            ${act.total_elevation_gain ? ` · ${formatElevation(act.total_elevation_gain)} elevation` : ""}
            ${ridePower ? ` · ${ridePower} avg` : ""}
          </p>
        </div>
      </header>

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
                    <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style=${pillStyle}>
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

              <!-- Canvas + save -->
              <canvas ref=${canvasRef} style="display:none; width:100%; max-width:540px; height:auto; margin-top:12px; border-radius:12px;"></canvas>
              ${isCardGenerated && html`
                <button
                  onClick=${handleSaveImage}
                  class="mt-3 inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg text-white transition-colors"
                  style="background: var(--strava); font-family: var(--font-body);"
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
                  </svg>
                  Save / Share Image
                </button>
              `}
            </div>
          </div>
        `}

        <!-- Segment efforts — summary cards with expandable detail (#88) -->
        ${act.has_efforts && act.segment_efforts && act.segment_efforts.length > 0 && html`
          <h2 style="font-family: var(--font-display); font-size: 1.125rem; color: var(--text); margin-bottom: 0.75rem;">Segment Efforts</h2>
          <div class="space-y-3">
            ${act.segment_efforts.map((effort) => {
              const seg = segmentHistory.value.get(effort.segment.id);
              const segAwards = effortAwards.get(effort.segment.id) || [];
              const effortCount = seg ? seg.efforts.length : 0;
              const effortPower = effort.device_watts && effort.average_watts
                ? formatPower(effort.average_watts)
                : null;
              const hasAwards = segAwards.length > 0;

              return html`
                <div class="rounded-xl p-4" style=${hasAwards
                  ? "background: var(--surface); border: 1px solid var(--border);"
                  : "background: var(--surface); border: 1px solid var(--border); opacity: 0.7;"}>
                  <div class="flex items-center gap-1.5" style="font-family: var(--font-body); font-size: 16px; font-weight: 500; color: var(--text);">
                    ${effort.segment.name}
                    <a href=${`https://www.strava.com/segments/${effort.segment.id}`} target="_blank" rel="noopener noreferrer" title="View segment on Strava" class="flex-shrink-0" style="color: var(--strava); opacity: 0.5; transition: opacity 0.15s;" onMouseOver=${e => e.currentTarget.style.opacity = '1'} onMouseOut=${e => e.currentTarget.style.opacity = '0.5'} onClick=${e => e.stopPropagation()}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </a>
                  </div>
                  <div class="mt-1" style="font-family: var(--font-mono); font-size: 14px; color: var(--text-secondary);">
                    ${formatDistance(effort.segment.distance)}
                    · ${effort.segment.average_grade}% grade
                    · ${formatTime(effort.elapsed_time)}
                    ${effortPower ? ` · ${effortPower}` : ""}
                    ${effortCount > 1 ? ` · ${effortCount} efforts` : ""}
                  </div>
                  ${effort.pr_rank && html`
                    <div class="mt-1" style="font-family: var(--font-mono); font-size: 0.75rem; color: var(--strava);">Strava PR #${effort.pr_rank}</div>
                  `}
                  ${hasAwards && html`
                    <div class="flex flex-wrap gap-1 mt-2">
                      ${segAwards.map(
                        (a) => {
                          const al = AWARD_LABELS[a.type];
                          const pillStyle = al ? `background: ${al.bg}; color: ${al.text}; border: 1px solid ${al.border};` : "background: #ECEAE6; color: #3E3A36;";
                          return html`
                            <span class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full" style=${pillStyle}>
                              ${al ? renderIconSVG(a.type, { size: 12, color: al.dot }) : null}
                              ${al?.label || a.type}
                            </span>
                          `;
                        }
                      )}
                    </div>
                    <details class="mt-2">
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

        <div class="text-center mt-12 mb-6">
          <p style="font-family: var(--font-body); font-size: 0.75rem; color: var(--text-tertiary);">Powered by Strava</p>
        </div>
      </main>
    </div>
  `;
}
