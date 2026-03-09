/**
 * Activity Detail Screen
 * Shows all segment efforts for an activity with award indicators.
 * Includes share card generation (Canvas) and copy-to-clipboard summary.
 */

import { html } from "htm/preact";
import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { getActivity, getSegment, getAllActivities, getResetEvent, getUserConfig } from "../db.js";
import { computeAwards, computeRideLevelAwards } from "../awards.js";
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

const AWARD_LABELS = {
  year_best: { label: "Year Best", color: "bg-yellow-100 text-yellow-800", icon: "★" },
  season_first: { label: "Season First", color: "bg-green-100 text-green-800", icon: "🌱" },
  recent_best: { label: "Recent Best", color: "bg-blue-100 text-blue-800", icon: "↑" },
  beat_median: { label: "Beat Median", color: "bg-purple-100 text-purple-800", icon: "◆" },
  top_quartile: { label: "Top Quartile", color: "bg-indigo-100 text-indigo-800", icon: "▲" },
  top_decile: { label: "Top 10%", color: "bg-red-100 text-red-800", icon: "⬆" },
  consistency: { label: "Metronome", color: "bg-teal-100 text-teal-800", icon: "≡" },
  monthly_best: { label: "Monthly Best", color: "bg-orange-100 text-orange-800", icon: "◎" },
  improvement_streak: { label: "On a Roll", color: "bg-emerald-100 text-emerald-800", icon: "⟫" },
  comeback: { label: "Comeback", color: "bg-rose-100 text-rose-800", icon: "↺" },
  milestone: { label: "Milestone", color: "bg-amber-100 text-amber-800", icon: "⬡" },
  best_month_ever: { label: "Best Month Ever", color: "bg-fuchsia-100 text-fuchsia-800", icon: "◉" },
  closing_in: { label: "Closing In", color: "bg-pink-100 text-pink-800", icon: "◈" },
  anniversary: { label: "Anniversary", color: "bg-violet-100 text-violet-800", icon: "↻" },
  distance_record: { label: "Longest Ride", color: "bg-cyan-100 text-cyan-800", icon: "→" },
  elevation_record: { label: "Most Climbing", color: "bg-sky-100 text-sky-800", icon: "⛰" },
  segment_count: { label: "Most Segments", color: "bg-lime-100 text-lime-800", icon: "#" },
  endurance_record: { label: "Longest by Time", color: "bg-slate-100 text-slate-800", icon: "⏱" },
  ytd_best_time: { label: "YTD Best", color: "bg-amber-200 text-amber-900", icon: "📅" },
  ytd_best_power: { label: "YTD Power", color: "bg-red-200 text-red-900", icon: "⚡" },
  // Comeback mode (#60)
  comeback_pb: { label: "Comeback PB", color: "bg-rose-200 text-rose-900", icon: "🔄" },
  recovery_milestone: { label: "Recovery", color: "bg-orange-200 text-orange-900", icon: "📈" },
  comeback_full: { label: "You're Back!", color: "bg-green-200 text-green-900", icon: "🎉" },
  comeback_distance: { label: "Comeback Distance", color: "bg-rose-100 text-rose-800", icon: "→" },
  comeback_elevation: { label: "Comeback Climbing", color: "bg-rose-100 text-rose-800", icon: "⛰" },
  comeback_endurance: { label: "Comeback Endurance", color: "bg-rose-100 text-rose-800", icon: "⏱" },
  reference_best: { label: "Reference Best", color: "bg-teal-200 text-teal-900", icon: "⊕" },
  // Route-level Season First (#59)
  route_season_first: { label: "Route Season First", color: "bg-green-200 text-green-900", icon: "🛤" },
  // Activity-level power awards (#45)
  season_first_power: { label: "First Power Ride", color: "bg-green-200 text-green-900", icon: "⚡" },
  np_year_best: { label: "NP Year Best", color: "bg-red-200 text-red-900", icon: "⚡" },
  np_recent_best: { label: "NP Recent Best", color: "bg-red-100 text-red-800", icon: "⚡" },
  work_year_best: { label: "Work Year Best", color: "bg-orange-200 text-orange-900", icon: "⊙" },
  work_recent_best: { label: "Work Recent Best", color: "bg-orange-100 text-orange-800", icon: "⊙" },
  peak_power: { label: "Peak Power", color: "bg-yellow-200 text-yellow-900", icon: "⚡" },
  peak_power_recent: { label: "Peak Recent", color: "bg-yellow-100 text-yellow-800", icon: "⚡" },
  // Indoor training awards (#46)
  indoor_np_year_best: { label: "Indoor NP Best", color: "bg-violet-200 text-violet-900", icon: "🏠" },
  indoor_work_year_best: { label: "Indoor Work Best", color: "bg-violet-100 text-violet-800", icon: "🏠" },
  trainer_streak: { label: "Trainer Streak", color: "bg-indigo-200 text-indigo-900", icon: "🔥" },
  indoor_vs_outdoor: { label: "Indoor vs Outdoor", color: "bg-sky-200 text-sky-900", icon: "↔" },
};

const AWARD_COLORS = {
  year_best:          { bg: "#FEF9C3", text: "#854D0E", accent: "#EAB308" },
  season_first:       { bg: "#DCFCE7", text: "#166534", accent: "#22C55E" },
  recent_best:        { bg: "#DBEAFE", text: "#1E40AF", accent: "#3B82F6" },
  beat_median:        { bg: "#F3E8FF", text: "#6B21A8", accent: "#A855F7" },
  top_quartile:       { bg: "#E0E7FF", text: "#3730A3", accent: "#6366F1" },
  top_decile:         { bg: "#FEE2E2", text: "#991B1B", accent: "#EF4444" },
  consistency:        { bg: "#CCFBF1", text: "#115E59", accent: "#14B8A6" },
  monthly_best:       { bg: "#FFEDD5", text: "#9A3412", accent: "#F97316" },
  improvement_streak: { bg: "#D1FAE5", text: "#065F46", accent: "#10B981" },
  comeback:           { bg: "#FFE4E6", text: "#9F1239", accent: "#F43F5E" },
  milestone:          { bg: "#FEF3C7", text: "#92400E", accent: "#F59E0B" },
  best_month_ever:    { bg: "#FAE8FF", text: "#86198F", accent: "#D946EF" },
  closing_in:         { bg: "#FCE7F3", text: "#9D174D", accent: "#EC4899" },
  anniversary:        { bg: "#EDE9FE", text: "#5B21B6", accent: "#8B5CF6" },
  distance_record:    { bg: "#CFFAFE", text: "#155E75", accent: "#06B6D4" },
  elevation_record:   { bg: "#E0F2FE", text: "#075985", accent: "#0EA5E9" },
  segment_count:      { bg: "#ECFCCB", text: "#3F6212", accent: "#84CC16" },
  endurance_record:   { bg: "#F1F5F9", text: "#334155", accent: "#64748B" },
  ytd_best_time:      { bg: "#FDE68A", text: "#78350F", accent: "#D97706" },
  ytd_best_power:     { bg: "#FECACA", text: "#7F1D1D", accent: "#DC2626" },
  // Comeback mode (#60)
  comeback_pb:        { bg: "#FECDD3", text: "#881337", accent: "#E11D48" },
  recovery_milestone: { bg: "#FED7AA", text: "#7C2D12", accent: "#EA580C" },
  comeback_full:      { bg: "#BBF7D0", text: "#14532D", accent: "#16A34A" },
  comeback_distance:  { bg: "#FFE4E6", text: "#9F1239", accent: "#F43F5E" },
  comeback_elevation: { bg: "#FFE4E6", text: "#9F1239", accent: "#F43F5E" },
  comeback_endurance: { bg: "#FFE4E6", text: "#9F1239", accent: "#F43F5E" },
  reference_best:     { bg: "#99F6E4", text: "#134E4A", accent: "#14B8A6" },
  // Route-level Season First (#59)
  route_season_first: { bg: "#BBF7D0", text: "#14532D", accent: "#16A34A" },
  // Activity-level power awards (#45)
  season_first_power: { bg: "#BBF7D0", text: "#14532D", accent: "#16A34A" },
  np_year_best:       { bg: "#FECACA", text: "#7F1D1D", accent: "#DC2626" },
  np_recent_best:     { bg: "#FEE2E2", text: "#991B1B", accent: "#EF4444" },
  work_year_best:     { bg: "#FED7AA", text: "#7C2D12", accent: "#EA580C" },
  work_recent_best:   { bg: "#FFEDD5", text: "#9A3412", accent: "#F97316" },
  peak_power:         { bg: "#FDE68A", text: "#78350F", accent: "#D97706" },
  peak_power_recent:  { bg: "#FEF9C3", text: "#854D0E", accent: "#EAB308" },
  // Indoor training awards (#46)
  indoor_np_year_best:  { bg: "#DDD6FE", text: "#4C1D95", accent: "#7C3AED" },
  indoor_work_year_best:{ bg: "#EDE9FE", text: "#5B21B6", accent: "#8B5CF6" },
  trainer_streak:       { bg: "#C7D2FE", text: "#312E81", accent: "#4F46E5" },
  indoor_vs_outdoor:    { bg: "#BAE6FD", text: "#075985", accent: "#0284C7" },
};

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
      const resetEvent = await getResetEvent();
      const userConfig = await getUserConfig();
      const refPoints = userConfig.referencePoints || [];
      const segmentAwards = await computeAwards(act, resetEvent, refPoints);
      const allActivities = await getAllActivities();
      const rideAwards = computeRideLevelAwards(act, allActivities, resetEvent);
      const awardsList = [...segmentAwards, ...rideAwards];
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

    const top = awardsList.slice(0, 3);
    for (const a of top) {
      const icon = AWARD_LABELS[a.type]?.icon || "•";
      let detail = a.time != null ? formatTime(a.time) : "";
      if (a.power) detail += detail ? ` · ${formatPower(a.power)}` : formatPower(a.power);
      lines.push(`  ${icon} ${a.segment || ""} ${detail ? "— " + detail : ""}`);
    }
    if (awardsList.length > 3) lines.push(`  + ${awardsList.length - 3} more`);
  }
  lines.push("");
  lines.push("aeyu.io — Participation Awards");
  return lines.join("\n");
}


// ── Canvas Share Card ─────────────────────────────────────────────

function renderShareCard(canvas, act, awardsList) {
  const W = 1080;
  const pad = 60, left = pad + 48, maxTextW = W - left - pad - 48;

  // Pre-measure to compute dynamic height
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = W;
  const tmpCtx = tmpCanvas.getContext("2d");
  tmpCtx.font = "bold 52px -apple-system, BlinkMacSystemFont, sans-serif";
  const nameLines = wrapText(tmpCtx, act.name, maxTextW);

  const showCount = Math.min(awardsList.length, 6);

  // Calculate height
  let contentH = 60;  // top padding in card
  contentH += 28 + 60; // header + gap
  contentH += 48;      // divider gap
  contentH += nameLines.length * 62 + 8; // title
  contentH += 30 + 64; // meta line + gap

  if (awardsList.length > 0) {
    contentH += 36 + 20 + 36; // pills row + divider
    for (let i = 0; i < showCount; i++) {
      const a = awardsList[i];
      contentH += (a.delta && a.delta > 0) ? 60 : 48;
    }
    if (awardsList.length > showCount) contentH += 40;
  }
  contentH += 48; // bottom padding in card

  const cardY = 60, cardBottom = 60;
  const taglineH = 60;
  const H = cardY + contentH + taglineH + cardBottom;

  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // Background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#1E293B");
  bg.addColorStop(0.5, "#0F172A");
  bg.addColorStop(1, "#1E293B");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle texture
  ctx.fillStyle = "rgba(255,255,255,0.015)";
  for (let i = 0; i < 150; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * W, Math.random() * H, Math.random() * 2 + 0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Card container
  const cardW = W - pad * 2, cardH = contentH;
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  roundRect(ctx, pad, cardY, cardW, cardH, 24);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.1)";
  ctx.lineWidth = 1;
  roundRect(ctx, pad, cardY, cardW, cardH, 24);
  ctx.stroke();

  let y = cardY + 60;

  // Header
  ctx.font = "bold 28px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillStyle = "#94A3B8";
  ctx.textAlign = "left";
  ctx.fillText("aeyu.io", left, y);
  ctx.font = "600 28px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillStyle = "#64748B";
  ctx.textAlign = "right";
  ctx.fillText("Participation Awards", W - pad - 48, y);
  ctx.textAlign = "left";
  y += 60;

  // Divider
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(W - pad - 48, y);
  ctx.stroke();
  y += 48;

  // Activity name
  ctx.font = "bold 52px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillStyle = "#F8FAFC";
  for (const line of nameLines) {
    ctx.fillText(line, left, y);
    y += 62;
  }
  y += 8;

  // Meta
  const meta = [formatDateShort(act.start_date_local), formatDistance(act.distance), formatTime(act.moving_time)];
  if (act.total_elevation_gain) meta.push(formatElevation(act.total_elevation_gain));
  if (act.device_watts && act.average_watts) meta.push(formatPower(act.average_watts));
  ctx.font = "400 30px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillStyle = "#94A3B8";
  ctx.fillText(meta.join("  ·  "), left, y);
  y += 64;

  // Awards
  if (awardsList.length > 0) {
    // Summary pills
    const counts = {};
    const order = ["route_season_first", "season_first", "year_best", "ytd_best_time", "ytd_best_power", "best_month_ever", "monthly_best", "recent_best", "improvement_streak", "comeback", "closing_in", "top_decile", "top_quartile", "beat_median", "consistency", "milestone", "anniversary", "distance_record", "elevation_record", "segment_count", "endurance_record", "season_first_power", "np_year_best", "np_recent_best", "work_year_best", "work_recent_best", "peak_power", "peak_power_recent", "indoor_np_year_best", "indoor_work_year_best", "trainer_streak", "indoor_vs_outdoor"];
    for (const a of awardsList) counts[a.type] = (counts[a.type] || 0) + 1;

    let pillX = left;
    ctx.font = "600 26px -apple-system, BlinkMacSystemFont, sans-serif";
    for (const type of order) {
      if (!counts[type]) continue;
      const label = counts[type] > 1
        ? `${counts[type]}× ${AWARD_LABELS[type].label}`
        : AWARD_LABELS[type].label;
      const colors = AWARD_COLORS[type];
      if (!colors) continue;
      const tw = ctx.measureText(label).width + 32;
      ctx.fillStyle = colors.bg;
      roundRect(ctx, pillX, y - 28, tw, 40, 20);
      ctx.fill();
      ctx.fillStyle = colors.text;
      ctx.fillText(label, pillX + 16, y);
      pillX += tw + 12;
    }
    y += 36 + 20;

    // Divider
    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(W - pad - 48, y);
    ctx.stroke();
    y += 36;

    // Individual awards
    const show = awardsList.slice(0, 6);
    for (const award of show) {
      const colors = AWARD_COLORS[award.type];
      if (!colors) continue;

      // Accent bar
      ctx.fillStyle = colors.accent;
      roundRect(ctx, left, y - 16, 4, 44, 2);
      ctx.fill();

      // Segment name
      ctx.font = "500 28px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "#E2E8F0";
      ctx.fillText(award.segment || "", left + 20, y + 4);

      // Time + power
      const rightLabel = award.time != null ? formatTime(award.time) : (award.power ? `${Math.round(award.power)}W` : "");
      ctx.font = "600 28px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = colors.accent;
      ctx.textAlign = "right";
      ctx.fillText(rightLabel, W - pad - 48, y + 4);
      ctx.textAlign = "left";

      // Delta
      if (award.delta && award.delta > 0) {
        ctx.font = "400 22px -apple-system, BlinkMacSystemFont, sans-serif";
        ctx.fillStyle = "#64748B";
        ctx.fillText(`${formatTime(award.delta)} faster`, left + 20, y + 30);
      }
      y += (award.delta && award.delta > 0) ? 60 : 48;
    }

    if (awardsList.length > 6) {
      ctx.font = "400 24px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "#64748B";
      ctx.fillText(`+ ${awardsList.length - 6} more awards`, left, y + 8);
    }
  }

  // Tagline
  ctx.font = "italic 24px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillStyle = "#475569";
  ctx.textAlign = "center";
  ctx.fillText("It's just you and your efforts", W / 2, H - 30);
  ctx.textAlign = "left";
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
      <div class="min-h-screen bg-gray-50 flex items-center justify-center">
        <p class="text-gray-400">Loading activity...</p>
      </div>
    `;
  }

  if (!act) {
    return html`
      <div class="min-h-screen bg-gray-50 flex items-center justify-center">
        <div class="text-center">
          <p class="text-gray-500">Activity not found</p>
          <button onClick=${() => navigate("dashboard")} class="mt-4 text-blue-600 hover:underline">
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

  function handleGenerateImage() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    renderShareCard(canvas, act, awards.value);
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
    <div class="min-h-screen bg-gray-50">
      <header class="bg-white border-b border-gray-200 px-6 py-4">
        <div class="max-w-3xl mx-auto">
          <button onClick=${() => navigate("dashboard")} class="text-sm text-blue-600 hover:underline mb-2 block">
            ← Back to dashboard
          </button>
          <div class="flex items-center justify-between gap-3">
            <h1 class="text-xl font-bold text-gray-800">${act.name}</h1>
            ${!isDemo.value && html`
              <button
                onClick=${handleResync}
                disabled=${resyncing.value}
                class="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
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
            <div class="mt-1 text-xs text-red-600">${resyncError.value}</div>
          `}
          <p class="text-sm text-gray-500">
            ${formatDateFull(act.start_date_local)}
            · ${formatDistance(act.distance)}
            · ${formatTime(act.moving_time)}
            ${act.total_elevation_gain ? ` · ${formatElevation(act.total_elevation_gain)} elevation` : ""}
            ${ridePower ? ` · ${ridePower} avg` : ""}
          </p>
        </div>
      </header>

      <main class="max-w-3xl mx-auto px-6 py-6">
        <!-- Awards summary -->
        ${awards.value.length > 0 && html`
          <div class="bg-white rounded-xl border border-gray-200 p-4 mb-6">
            <h2 class="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Awards Earned</h2>
            <div class="space-y-2">
              ${awards.value.map(
                (award) => {
                  // Route Season First: show collapsed award + expandable segment details (#59)
                  if (award.type === "route_season_first" && award._collapsed_season_firsts) {
                    return html`
                      <div class="p-2 rounded-lg bg-gray-50">
                        <div class="flex items-start gap-3">
                          <span class="text-lg">${AWARD_LABELS[award.type]?.icon || "•"}</span>
                          <div class="flex-1">
                            <span class="text-xs px-2 py-0.5 rounded-full ${AWARD_LABELS[award.type]?.color || 'bg-gray-100'}">
                              ${AWARD_LABELS[award.type]?.label || award.type}
                            </span>
                            <p class="text-sm text-gray-700 mt-1">${award.message}</p>
                          </div>
                        </div>
                        <details class="mt-2 ml-9">
                          <summary class="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
                            ${award._collapsed_season_firsts.length} segment Season Firsts
                          </summary>
                          <div class="mt-1 space-y-1 pl-2 border-l-2 border-green-200">
                            ${award._collapsed_season_firsts.map(
                              (sf) => html`
                                <div class="flex items-start gap-2 py-1">
                                  <span class="text-xs">${AWARD_LABELS.season_first?.icon || "🌱"}</span>
                                  <p class="text-xs text-gray-600">${sf.message}</p>
                                </div>
                              `
                            )}
                          </div>
                        </details>
                      </div>
                    `;
                  }
                  return html`
                    <div class="flex items-start gap-3 p-2 rounded-lg bg-gray-50">
                      <span class="text-lg">${AWARD_LABELS[award.type]?.icon || "•"}</span>
                      <div>
                        <span class="text-xs px-2 py-0.5 rounded-full ${AWARD_LABELS[award.type]?.color || 'bg-gray-100'}">
                          ${AWARD_LABELS[award.type]?.label || award.type}
                        </span>
                        <p class="text-sm text-gray-700 mt-1">${award.message}</p>
                      </div>
                    </div>
                  `;
                }
              )}
            </div>

            <!-- Share actions -->
            <div class="border-t border-gray-100 mt-4 pt-4">
              <div class="flex flex-wrap gap-2">
                <button
                  onClick=${handleCopy}
                  class="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                  </svg>
                  ${copied.value ? "Copied!" : "Copy Summary"}
                </button>
                <button
                  onClick=${handleGenerateImage}
                  class="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition-colors"
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
                  class="mt-3 inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
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

        <!-- Segment efforts -->
        ${act.has_efforts && act.segment_efforts && act.segment_efforts.length > 0 && html`
          <h2 class="text-lg font-semibold text-gray-800 mb-3">Segment Efforts</h2>
          <div class="space-y-3">
            ${act.segment_efforts.map((effort) => {
              const seg = segmentHistory.value.get(effort.segment.id);
              const segAwards = effortAwards.get(effort.segment.id) || [];
              const effortCount = seg ? seg.efforts.length : 0;
              const effortPower = effort.device_watts && effort.average_watts
                ? formatPower(effort.average_watts)
                : null;

              return html`
                <div class="bg-white rounded-xl border border-gray-200 p-4">
                  <div class="flex items-start justify-between">
                    <div>
                      <div class="font-medium text-gray-800">${effort.segment.name}</div>
                      <div class="text-sm text-gray-500 mt-1">
                        ${formatDistance(effort.segment.distance)}
                        · ${effort.segment.average_grade}% grade
                        · ${formatTime(effort.elapsed_time)}
                        ${effortPower ? ` · ${effortPower}` : ""}
                      </div>
                      ${effortCount > 1 && html`
                        <div class="text-xs text-gray-400 mt-1">
                          ${effortCount} total efforts on this segment
                        </div>
                      `}
                    </div>
                    ${segAwards.length > 0 && html`
                      <div class="flex flex-wrap gap-1 ml-3">
                        ${segAwards.map(
                          (a) => html`
                            <span class="text-xs px-2 py-0.5 rounded-full ${AWARD_LABELS[a.type]?.color || 'bg-gray-100'}">
                              ${AWARD_LABELS[a.type]?.icon || ""} ${AWARD_LABELS[a.type]?.label || a.type}
                            </span>
                          `
                        )}
                      </div>
                    `}
                  </div>
                  ${effort.pr_rank && html`
                    <div class="mt-2 text-xs text-orange-600">Strava PR #${effort.pr_rank}</div>
                  `}
                </div>
              `;
            })}
          </div>
        `}

        ${!act.has_efforts && html`
          <div class="bg-yellow-50 border border-yellow-200 rounded-lg p-4 text-sm text-yellow-700">
            Segment details have not been loaded yet for this activity. Run a sync to fetch them.
          </div>
        `}

        <div class="text-center mt-12 mb-6">
          <p class="text-xs text-gray-400">Powered by Strava</p>
        </div>
      </main>
    </div>
  `;
}
