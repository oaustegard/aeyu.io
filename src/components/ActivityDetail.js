/**
 * Activity Detail Screen
 * Shows all segment efforts for an activity with award indicators.
 * Includes share card generation (Canvas) and copy-to-clipboard summary.
 */

import { html } from "htm/preact";
import { signal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { getActivity, getSegment } from "../db.js";
import { computeAwards } from "../awards.js";
import { navigate } from "../app.js";

const activity = signal(null);
const awards = signal([]);
const segmentHistory = signal(new Map());
const loading = signal(true);
const copied = signal(false);
const cardGenerated = signal(false);

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}

function formatDistance(meters) {
  const km = meters / 1000;
  return km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(meters)} m`;
}

function formatDate(isoString) {
  return new Date(isoString).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

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
};

const AWARD_COLORS = {
  year_best:    { bg: "#FEF9C3", text: "#854D0E", accent: "#EAB308" },
  season_first: { bg: "#DCFCE7", text: "#166534", accent: "#22C55E" },
  recent_best:  { bg: "#DBEAFE", text: "#1E40AF", accent: "#3B82F6" },
};

async function loadActivity(id) {
  loading.value = true;
  cardGenerated.value = false;
  try {
    const act = await getActivity(Number(id));
    if (!act) return;
    activity.value = act;

    if (act.has_efforts) {
      const awardsList = await computeAwards(act);
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
  if (act.total_elevation_gain) meta += ` · ${Math.round(act.total_elevation_gain)}m`;
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
      lines.push(`  ${icon} ${a.segment} — ${formatTime(a.time)}`);
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
  const hasDeltas = awardsList.slice(0, showCount).some(a => a.delta && a.delta > 0);

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
  if (act.total_elevation_gain) meta.push(`${Math.round(act.total_elevation_gain)}m`);
  ctx.font = "400 30px -apple-system, BlinkMacSystemFont, sans-serif";
  ctx.fillStyle = "#94A3B8";
  ctx.fillText(meta.join("  ·  "), left, y);
  y += 64;

  // Awards
  if (awardsList.length > 0) {
    // Summary pills
    const counts = {};
    const order = ["season_first", "year_best", "recent_best"];
    for (const a of awardsList) counts[a.type] = (counts[a.type] || 0) + 1;

    let pillX = left;
    ctx.font = "600 26px -apple-system, BlinkMacSystemFont, sans-serif";
    for (const type of order) {
      if (!counts[type]) continue;
      const label = counts[type] > 1
        ? `${counts[type]}× ${AWARD_LABELS[type].label}`
        : AWARD_LABELS[type].label;
      const colors = AWARD_COLORS[type];
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

      // Accent bar
      ctx.fillStyle = colors.accent;
      roundRect(ctx, left, y - 16, 4, 44, 2);
      ctx.fill();

      // Segment name
      ctx.font = "500 28px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = "#E2E8F0";
      ctx.fillText(award.segment, left + 20, y + 4);

      // Time
      ctx.font = "600 28px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillStyle = colors.accent;
      ctx.textAlign = "right";
      ctx.fillText(formatTime(award.time), W - pad - 48, y + 4);
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

  return html`
    <div class="min-h-screen bg-gray-50">
      <header class="bg-white border-b border-gray-200 px-6 py-4">
        <div class="max-w-3xl mx-auto">
          <button onClick=${() => navigate("dashboard")} class="text-sm text-blue-600 hover:underline mb-2 block">
            ← Back to dashboard
          </button>
          <h1 class="text-xl font-bold text-gray-800">${act.name}</h1>
          <p class="text-sm text-gray-500">
            ${formatDate(act.start_date_local)}
            · ${formatDistance(act.distance)}
            · ${formatTime(act.moving_time)}
            ${act.total_elevation_gain ? ` · ${Math.round(act.total_elevation_gain)}m elevation` : ""}
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
                (award) => html`
                  <div class="flex items-start gap-3 p-2 rounded-lg bg-gray-50">
                    <span class="text-lg">${AWARD_LABELS[award.type]?.icon || "•"}</span>
                    <div>
                      <span class="text-xs px-2 py-0.5 rounded-full ${AWARD_LABELS[award.type]?.color || 'bg-gray-100'}">
                        ${AWARD_LABELS[award.type]?.label || award.type}
                      </span>
                      <p class="text-sm text-gray-700 mt-1">${award.message}</p>
                    </div>
                  </div>
                `
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

              return html`
                <div class="bg-white rounded-xl border border-gray-200 p-4">
                  <div class="flex items-start justify-between">
                    <div>
                      <div class="font-medium text-gray-800">${effort.segment.name}</div>
                      <div class="text-sm text-gray-500 mt-1">
                        ${formatDistance(effort.segment.distance)}
                        · ${effort.segment.average_grade}% grade
                        · ${formatTime(effort.elapsed_time)}
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
