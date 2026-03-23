/**
 * LLM Export — Build a compact training context for AI coaching.
 *
 * Aggregates recent rides, pre-computed fitness trends, streak data,
 * and award distributions into a compact JSON or markdown payload
 * that fits comfortably in any LLM context window.
 */

import { getAllActivities, getAllSegments, getActivity, getSegment, getResetEvent, getUserConfig } from "./db.js";
import { computeFitnessSummary } from "./fitness.js";
import { computeStreakData, computeAwardsForActivities, computeAwards, computeRideLevelAwards } from "./awards.js";
import { unitSystem, formatDistance, formatElevation, formatSpeed } from "./units.js";
import { AWARD_LABELS } from "./award-config.js";
import { estimateFTP, POWER_CURVE_DURATIONS, DURATION_LABELS, getAllTimeBestCurve } from "./power-curve.js";

function filterByDays(activities, days) {
  const cutoff = Date.now() - days * 86400000;
  return activities.filter((a) => new Date(a.start_date).getTime() >= cutoff);
}

// VirtualRide power always comes from a trainer — treat it as device watts
function hasRealPower(a) {
  return a.device_watts || a.sport_type === "VirtualRide";
}

function slimActivity(a) {
  const slim = {
    name: a.name,
    date: a.start_date_local?.slice(0, 10),
    type: a.sport_type,
    distance_km: +(a.distance / 1000).toFixed(1),
    moving_time_min: Math.round(a.moving_time / 60),
    elevation_m: Math.round(a.total_elevation_gain || 0),
    avg_speed_kph: +((a.average_speed || 0) * 3.6).toFixed(1),
    segment_count: (a.segment_efforts || []).length,
    trainer: a.trainer || false,
  };
  if (hasRealPower(a) && a.weighted_average_watts) {
    slim.np_watts = Math.round(a.weighted_average_watts);
  }
  if (hasRealPower(a) && a.average_watts) {
    slim.avg_watts = Math.round(a.average_watts);
  }
  if (a.kilojoules) slim.kj = Math.round(a.kilojoules);
  if (a.has_heartrate && a.average_heartrate) {
    slim.avg_hr = Math.round(a.average_heartrate);
    slim.max_hr = Math.round(a.max_heartrate || 0);
  }
  return slim;
}

function buildWeeklyRollups(activities) {
  const weeks = {};
  for (const a of activities) {
    const d = new Date(a.start_date_local);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    if (!weeks[key]) weeks[key] = { rides: 0, distance_km: 0, elevation_m: 0, moving_min: 0, np_sum: 0, np_count: 0, hr_sum: 0, hr_count: 0, indoor: 0, kj: 0, kj_count: 0 };
    const w = weeks[key];
    w.rides++;
    w.distance_km += a.distance / 1000;
    w.elevation_m += a.total_elevation_gain || 0;
    w.moving_min += a.moving_time / 60;
    if (hasRealPower(a) && a.weighted_average_watts) { w.np_sum += a.weighted_average_watts; w.np_count++; }
    if (a.has_heartrate && a.average_heartrate) { w.hr_sum += a.average_heartrate; w.hr_count++; }
    if (a.kilojoules) { w.kj += a.kilojoules; w.kj_count++; }
    if (a.trainer || a.sport_type === "VirtualRide") w.indoor++;
  }
  return Object.entries(weeks)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week, w]) => {
      const r = {
        week_of: week,
        rides: w.rides,
        distance_km: +w.distance_km.toFixed(1),
        elevation_m: Math.round(w.elevation_m),
        moving_hrs: +(w.moving_min / 60).toFixed(1),
      };
      if (w.np_count > 0) r.avg_np = Math.round(w.np_sum / w.np_count);
      if (w.hr_count > 0) r.avg_hr = Math.round(w.hr_sum / w.hr_count);
      if (w.kj_count > 0) r.kj = Math.round(w.kj);
      if (w.indoor > 0) r.indoor_rides = w.indoor;
      return r;
    });
}

function buildWeekOverWeekDelta(weeklyRollups) {
  if (weeklyRollups.length < 2) return null;
  const now = new Date();
  const currentMonday = new Date(now);
  currentMonday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const currentWeekKey = currentMonday.toISOString().slice(0, 10);
  const lastWeek = weeklyRollups[weeklyRollups.length - 1];
  const isPartial = lastWeek.week_of === currentWeekKey;
  const completeWeeks = isPartial ? weeklyRollups.slice(0, -1) : weeklyRollups;
  if (completeWeeks.length < 1) return null;
  const compareWeek = completeWeeks[completeWeeks.length - 1];
  const avgCount = Math.min(4, completeWeeks.length - 1);
  if (avgCount < 1) return null;
  const avgWeeks = completeWeeks.slice(-(avgCount + 1), -1);
  const avg = (field) => avgWeeks.reduce((s, w) => s + (w[field] || 0), 0) / avgWeeks.length;
  const pctDelta = (val, baseline) => baseline > 0 ? Math.round((val / baseline - 1) * 100) : null;
  return {
    week: compareWeek.week_of,
    vs_n_week_avg: avgCount,
    volume_hrs_pct: pctDelta(compareWeek.moving_hrs, avg("moving_hrs")),
    intensity_np_pct: compareWeek.avg_np && avg("avg_np") > 0 ? pctDelta(compareWeek.avg_np, avg("avg_np")) : null,
    elevation_pct: pctDelta(compareWeek.elevation_m, avg("elevation_m")),
    load_kj_pct: compareWeek.kj && avg("kj") > 0 ? pctDelta(compareWeek.kj, avg("kj")) : null,
  };
}

const ZONE_BOUNDARIES = [
  { zone: "Z1", label: "<55%", max: 0.55 },
  { zone: "Z2", label: "55-75%", min: 0.55, max: 0.75 },
  { zone: "Z3", label: "75-90%", min: 0.75, max: 0.90 },
  { zone: "Z4", label: "90-105%", min: 0.90, max: 1.05 },
  { zone: "Z5", label: "105-120%", min: 1.05, max: 1.20 },
  { zone: "Z6+", label: ">120%", min: 1.20 },
];

function classifyZone(avgWatts, ftp) {
  const ratio = avgWatts / ftp;
  for (let i = ZONE_BOUNDARIES.length - 1; i >= 0; i--) {
    const z = ZONE_BOUNDARIES[i];
    if (z.min == null || ratio >= z.min) return i;
  }
  return 0;
}

function buildZoneDistribution(activities, ftp) {
  if (!ftp) return null;
  const weeks = {};
  let excluded = 0;
  for (const a of activities) {
    if (!hasRealPower(a) || !a.average_watts) { excluded++; continue; }
    const d = new Date(a.start_date_local);
    const day = d.getDay();
    const monday = new Date(d);
    monday.setDate(d.getDate() - ((day + 6) % 7));
    const key = monday.toISOString().slice(0, 10);
    if (!weeks[key]) weeks[key] = new Float64Array(ZONE_BOUNDARIES.length);
    const zi = classifyZone(a.average_watts, ftp);
    weeks[key][zi] += a.moving_time / 3600;
  }
  const rows = Object.entries(weeks).sort(([a], [b]) => a.localeCompare(b)).map(([week, zones]) => {
    const row = { week_of: week };
    for (let i = 0; i < ZONE_BOUNDARIES.length; i++) {
      row[ZONE_BOUNDARIES[i].zone] = +zones[i].toFixed(1);
    }
    return row;
  });
  return { ftp, zones: ZONE_BOUNDARIES.map(z => `${z.zone} (${z.label})`), weeks: rows, rides_without_power: excluded };
}

function buildPowerCurveSnapshot(allSorted) {
  const now = Date.now();
  const eightWeeks = 56 * 86400000;
  const currentWindow = allSorted.filter(a => a.power_curve && (now - new Date(a.start_date).getTime()) <= eightWeeks);
  const priorWindow = allSorted.filter(a => a.power_curve && (now - new Date(a.start_date).getTime()) > eightWeeks && (now - new Date(a.start_date).getTime()) <= 2 * eightWeeks);
  if (currentWindow.length === 0) return null;
  const KEY_DURATIONS = [5, 60, 300, 1200, 3600];
  const bestFor = (acts, dur) => {
    let best = 0;
    for (const a of acts) { if (a.power_curve[dur] > best) best = a.power_curve[dur]; }
    return best || null;
  };
  const rows = [];
  for (const dur of KEY_DURATIONS) {
    const current = bestFor(currentWindow, dur);
    if (!current) continue;
    const prior = bestFor(priorWindow, dur);
    const row = { duration_s: dur, label: DURATION_LABELS[dur] || `${dur}s`, current_watts: current };
    if (prior) {
      row.prior_watts = prior;
      row.delta_pct = +((current / prior - 1) * 100).toFixed(1);
    }
    rows.push(row);
  }
  if (rows.length === 0) return null;
  return { window_weeks: 8, durations: rows };
}

function buildMonthlyDeltas(activities) {
  const months = {};
  for (const a of activities) {
    const key = a.start_date_local?.slice(0, 7);
    if (!key) continue;
    if (!months[key]) months[key] = { rides: 0, distance_km: 0, elevation_m: 0, moving_min: 0 };
    const m = months[key];
    m.rides++;
    m.distance_km += a.distance / 1000;
    m.elevation_m += a.total_elevation_gain || 0;
    m.moving_min += a.moving_time / 60;
  }
  const sorted = Object.entries(months).sort(([a], [b]) => a.localeCompare(b));
  return sorted.map(([month, m], i) => {
    const r = {
      month,
      rides: m.rides,
      distance_km: +m.distance_km.toFixed(1),
      elevation_m: Math.round(m.elevation_m),
      moving_hrs: +(m.moving_min / 60).toFixed(1),
    };
    if (i > 0) {
      const prev = sorted[i - 1][1];
      r.distance_delta_pct = prev.distance_km > 0 ? +((m.distance_km / prev.distance_km - 1) * 100).toFixed(0) : null;
      r.volume_delta_pct = prev.moving_min > 0 ? +((m.moving_min / prev.moving_min - 1) * 100).toFixed(0) : null;
    }
    return r;
  });
}

function summarizeAwards(awardsMap) {
  const counts = {};
  for (const awards of awardsMap.values()) {
    for (const a of awards) {
      counts[a.type] = (counts[a.type] || 0) + 1;
    }
  }
  return counts;
}

function buildAwardHighlights(awardsMap) {
  const all = [];
  for (const awards of awardsMap.values()) {
    for (const a of awards) all.push(a);
  }
  if (all.length === 0) return [];

  const highlights = [];
  const counts = {};
  for (const a of all) counts[a.type] = (counts[a.type] || 0) + 1;

  const byType = {};
  for (const a of all) {
    if (!byType[a.type]) byType[a.type] = [];
    byType[a.type].push(a);
  }

  // Year bests
  if (counts.year_best) {
    const segments = new Set(byType.year_best.map(a => a.segment).filter(Boolean));
    highlights.push(`${counts.year_best} year best${counts.year_best !== 1 ? "s" : ""} across ${segments.size} segment${segments.size !== 1 ? "s" : ""}`);
  }

  // Improvement streaks — call out specific segments
  if (byType.improvement_streak) {
    const segCounts = {};
    for (const a of byType.improvement_streak) { if (a.segment) segCounts[a.segment] = (segCounts[a.segment] || 0) + 1; }
    const top = Object.entries(segCounts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (const [seg, cnt] of top) highlights.push(`${cnt} consecutive improvement${cnt !== 1 ? "s" : ""} on ${seg}`);
  }

  // Power year bests
  if (byType.ytd_best_power) {
    for (const a of byType.ytd_best_power) {
      if (a.message) highlights.push(a.message);
    }
  }

  // Season firsts
  if (counts.season_first) highlights.push(`First season rides on ${counts.season_first} segment${counts.season_first !== 1 ? "s" : ""}`);
  if (counts.route_season_first) highlights.push(`First season rides on ${counts.route_season_first} route${counts.route_season_first !== 1 ? "s" : ""}`);

  // Ride-level records
  const rideRecordTypes = ["distance_record", "elevation_record", "endurance_record", "speed_record"];
  for (const rt of rideRecordTypes) {
    if (byType[rt]) {
      for (const a of byType[rt]) { if (a.message) highlights.push(a.message); }
    }
  }

  // Top decile
  if (counts.top_decile) highlights.push(`${counts.top_decile} top-decile effort${counts.top_decile !== 1 ? "s" : ""}`);

  // Milestones
  if (byType.milestone) {
    for (const a of byType.milestone) { if (a.message) highlights.push(a.message); }
  }

  // Comeback
  if (byType.comeback_pb) {
    for (const a of byType.comeback_pb) { if (a.message) highlights.push(a.message); }
  }

  return highlights;
}

function formatFitness(fitness) {
  const out = {};
  if (fitness.performanceCapacity?.hasData) {
    const pc = fitness.performanceCapacity;
    out.performance_capacity = { score: pc.score, trend: pc.trend != null ? +pc.trend.toFixed(1) : null, climb_segments_used: pc.segments.length };
  }
  if (fitness.aerobicEfficiency?.hasData) {
    const ae = fitness.aerobicEfficiency;
    out.aerobic_efficiency = { current_ef: ae.ef.current, trend_pct: ae.ef.trend != null ? +ae.ef.trend.toFixed(1) : null, has_power_data: ae.ef.hasPowerData };
  }
  if (fitness.interpretation) out.interpretation = fitness.interpretation;
  return out;
}

function formatStreaks(streakData) {
  const out = {};
  if (streakData.weeklyStreak) {
    const ws = streakData.weeklyStreak;
    out.weekly_streak = { current_weeks: ws.current, longest_weeks: ws.longest, mulligan_used: ws.mulliganUsed };
    if (ws.danger) out.weekly_streak.danger = ws.danger;
  }
  return out;
}

export async function buildLLMContext(options = {}) {
  const days = options.days || 90;
  const coachMode = options.coachMode || false;
  const allActs = await getAllActivities();
  const sorted = [...allActs].sort((a, b) => (a.start_date_local || "").localeCompare(b.start_date_local || ""));
  const recent = filterByDays(sorted, days);

  const [fitness, streakData, awardsMap, segments] = await Promise.all([
    computeFitnessSummary(),
    Promise.resolve(computeStreakData(sorted)),
    recent.length > 0 ? computeAwardsForActivities(recent) : Promise.resolve(new Map()),
    getAllSegments(),
  ]);

  const weeklyRollups = buildWeeklyRollups(recent);

  const userConfig = await getUserConfig();
  const storedFTP = userConfig.ftp || null;
  const bestCurve = await getAllTimeBestCurve();
  const estimatedFTP = estimateFTP(bestCurve);
  const ftp = storedFTP || estimatedFTP;

  const zoneDistribution = buildZoneDistribution(recent, ftp);
  const powerCurveSnapshot = buildPowerCurveSnapshot(sorted);

  const ctx = {
    generated_at: new Date().toISOString(),
    window_days: days,
    coach_mode: coachMode,
    fitness: formatFitness(fitness),
    streaks: formatStreaks(streakData),
    weekly_rollups: weeklyRollups,
    week_over_week: buildWeekOverWeekDelta(weeklyRollups),
    zone_distribution: zoneDistribution,
    power_curve: powerCurveSnapshot,
    monthly_trends: buildMonthlyDeltas(recent),
    rides_in_window: recent.length,
  };

  if (!coachMode) {
    const totalRides = sorted.length;
    const firstRide = sorted.length > 0 ? sorted[0].start_date_local?.slice(0, 10) : null;
    const lastRide = sorted.length > 0 ? sorted[sorted.length - 1].start_date_local?.slice(0, 10) : null;
    const hasPower = sorted.some((a) => hasRealPower(a));
    const hasHR = sorted.some((a) => a.has_heartrate);
    const sportTypes = [...new Set(sorted.map((a) => a.sport_type))];
    ctx.athlete_summary = {
      total_rides: totalRides,
      first_ride: firstRide,
      last_ride: lastRide,
      segments_ridden: segments.length,
      has_power_meter: hasPower,
      has_heart_rate: hasHR,
      sport_types: sportTypes,
      unit_preference: unitSystem.value,
    };
    ctx.recent_rides = recent.slice(-25).reverse().map(slimActivity);
    ctx.award_summary = summarizeAwards(awardsMap);
  } else {
    ctx.award_highlights = buildAwardHighlights(awardsMap);
  }

  return ctx;
}

export function contextToMarkdown(ctx) {
  const coachMode = ctx.coach_mode;
  const fmtDist = (m) => formatDistance(m).replace("\u00A0", " ");
  const fmtElev = (m) => formatElevation(m).replace("\u00A0", " ");
  const isImperial = unitSystem.value === "imperial";
  const distLabel = isImperial ? "mi" : "km";
  const elevLabel = isImperial ? "ft" : "m";
  const convDist = (km) => isImperial ? +(km / 1.609344).toFixed(1) : km;
  const convElev = (m) => isImperial ? Math.round(m * 3.28084) : m;
  let md = `# Cycling Training Data (last ${ctx.window_days} days)${coachMode ? " — Coach Update" : ""}\n`;
  md += `Generated: ${ctx.generated_at.slice(0, 10)} · ${ctx.rides_in_window} rides in window\n\n`;

  if (ctx.athlete_summary) {
    const s = ctx.athlete_summary;
    md += `## Athlete Summary\n`;
    md += `- ${s.total_rides} total rides (${s.first_ride} to ${s.last_ride})\n`;
    md += `- ${s.segments_ridden} unique segments ridden\n`;
    md += `- Sport types: ${s.sport_types.join(", ")}\n`;
    md += `- Power meter: ${s.has_power_meter ? "yes" : "no"}, HR monitor: ${s.has_heart_rate ? "yes" : "no"}\n\n`;
  }

  if (ctx.fitness.performance_capacity || ctx.fitness.aerobic_efficiency) {
    md += `## Fitness Indicators\n`;
    if (ctx.fitness.performance_capacity) {
      const pc = ctx.fitness.performance_capacity;
      md += `- Performance Capacity: ${pc.score}/100`;
      if (pc.trend != null) md += ` (trend: ${pc.trend > 0 ? "+" : ""}${pc.trend})`;
      md += `\n`;
    }
    if (ctx.fitness.aerobic_efficiency) {
      const ae = ctx.fitness.aerobic_efficiency;
      md += `- Aerobic Efficiency (EF): ${ae.current_ef}`;
      if (ae.trend_pct != null) md += ` (trend: ${ae.trend_pct > 0 ? "+" : ""}${ae.trend_pct}%)`;
      md += `\n`;
    }
    if (ctx.fitness.interpretation) {
      md += `- Interpretation: **${ctx.fitness.interpretation}**\n`;
    }
    md += `\n`;
  }

  if (ctx.streaks.weekly_streak) {
    const ws = ctx.streaks.weekly_streak;
    md += `## Consistency\n`;
    md += `- Current weekly streak: ${ws.current_weeks} weeks (longest: ${ws.longest_weeks})\n`;
    if (ws.danger) md += `- Warning: ${ws.danger}\n`;
    md += `\n`;
  }

  if (ctx.weekly_rollups.length > 0) {
    md += `## Weekly Volume\n`;
    md += `| Week | Rides | Distance (${distLabel}) | Elevation (${elevLabel}) | Hours |`;
    const hasKJ = ctx.weekly_rollups.some((w) => w.kj);
    const hasNP = ctx.weekly_rollups.some((w) => w.avg_np);
    const hasHR = ctx.weekly_rollups.some((w) => w.avg_hr);
    if (hasKJ) md += ` kJ |`;
    if (hasNP) md += ` Avg NP |`;
    if (hasHR) md += ` Avg HR |`;
    md += `\n`;
    md += `|------|-------|---------------|---------------|-------|`;
    if (hasKJ) md += `------|`;
    if (hasNP) md += `--------|`;
    if (hasHR) md += `--------|`;
    md += `\n`;
    for (const w of ctx.weekly_rollups) {
      md += `| ${w.week_of} | ${w.rides} | ${convDist(w.distance_km)} | ${convElev(w.elevation_m)} | ${w.moving_hrs} |`;
      if (hasKJ) md += ` ${w.kj || "-"} |`;
      if (hasNP) md += ` ${w.avg_np || "-"} |`;
      if (hasHR) md += ` ${w.avg_hr || "-"} |`;
      md += `\n`;
    }
    if (ctx.week_over_week) {
      const d = ctx.week_over_week;
      const fmt = (v) => v != null ? `${v > 0 ? "+" : ""}${v}%` : "n/a";
      md += `\nThis week (${d.week}) vs ${d.vs_n_week_avg}-week avg: ${fmt(d.volume_hrs_pct)} volume (hrs)`;
      if (d.intensity_np_pct != null) md += `, ${fmt(d.intensity_np_pct)} intensity (NP)`;
      md += `, ${fmt(d.elevation_pct)} elevation`;
      if (d.load_kj_pct != null) md += `, ${fmt(d.load_kj_pct)} load (kJ)`;
      md += `\n`;
    }
    md += `\n`;
  }

  if (ctx.zone_distribution) {
    const zd = ctx.zone_distribution;
    md += `## Weekly Zone Distribution (FTP: ${zd.ftp}W)\n`;
    md += `| Week |`;
    for (const z of zd.zones) md += ` ${z} |`;
    md += `\n|------|`;
    for (let i = 0; i < zd.zones.length; i++) md += `------|`;
    md += `\n`;
    for (const w of zd.weeks) {
      md += `| ${w.week_of} |`;
      for (const zb of ZONE_BOUNDARIES) md += ` ${w[zb.zone] || "-"}h |`;
      md += `\n`;
    }
    if (zd.rides_without_power > 0) md += `\n_${zd.rides_without_power} ride${zd.rides_without_power !== 1 ? "s" : ""} without power data excluded._\n`;
    md += `\n`;
  }

  if (ctx.power_curve) {
    const pc = ctx.power_curve;
    md += `## Power Curve (${pc.window_weeks}-week bests)\n`;
    md += `| Duration | Current | Prior ${pc.window_weeks}wk | Delta |\n`;
    md += `|----------|---------|-----------|-------|\n`;
    for (const d of pc.durations) {
      md += `| ${d.label} | ${d.current_watts}W |`;
      md += d.prior_watts ? ` ${d.prior_watts}W | ${d.delta_pct > 0 ? "+" : ""}${d.delta_pct}% |` : ` - | - |`;
      md += `\n`;
    }
    md += `\n`;
  }

  if (ctx.monthly_trends.length > 0) {
    md += `## Monthly Trends\n`;
    for (const m of ctx.monthly_trends) {
      md += `- ${m.month}: ${m.rides} rides, ${convDist(m.distance_km)}${distLabel}, ${convElev(m.elevation_m)}${elevLabel} elev, ${m.moving_hrs}hrs`;
      if (m.distance_delta_pct != null) md += ` (distance ${m.distance_delta_pct > 0 ? "+" : ""}${m.distance_delta_pct}% vs prev)`;
      md += `\n`;
    }
    md += `\n`;
  }

  if (ctx.recent_rides && ctx.recent_rides.length > 0) {
    md += `## Last ${ctx.recent_rides.length} Rides\n`;
    for (const r of ctx.recent_rides) {
      md += `- **${r.date}** ${r.name}: ${convDist(r.distance_km)}${distLabel}, ${r.moving_time_min}min, ${convElev(r.elevation_m)}${elevLabel}`;
      if (r.np_watts) md += `, NP ${r.np_watts}W`;
      if (r.avg_hr) md += `, HR ${r.avg_hr}`;
      if (r.trainer) md += ` [indoor]`;
      md += `\n`;
    }
    md += `\n`;
  }

  if (ctx.award_highlights && ctx.award_highlights.length > 0) {
    md += `## Notable Achievements (last ${ctx.window_days} days)\n`;
    for (const h of ctx.award_highlights) {
      md += `- ${h}\n`;
    }
    md += `\n`;
  }

  if (ctx.award_summary) {
    const awardTypes = Object.entries(ctx.award_summary);
    if (awardTypes.length > 0) {
      md += `## Awards Earned (last ${ctx.window_days} days)\n`;
      awardTypes.sort((a, b) => b[1] - a[1]);
      for (const [type, count] of awardTypes) {
        md += `- ${type}: ${count}\n`;
      }
      md += `\n`;
    }
  }

  return md;
}

// ── Single Ride Export ──────────────────────────────────────────

function slimEffort(e) {
  const out = {
    segment: e.segment?.name,
    distance_km: +(e.segment?.distance / 1000).toFixed(2),
    grade_pct: e.segment?.average_grade,
    elapsed_time_s: e.elapsed_time,
    moving_time_s: e.moving_time,
  };
  if (e.device_watts && e.average_watts) out.avg_watts = Math.round(e.average_watts);
  if (e.average_heartrate) out.avg_hr = Math.round(e.average_heartrate);
  if (e.average_cadence) out.avg_cadence = Math.round(e.average_cadence);
  if (e.pr_rank) out.pr_rank = e.pr_rank;
  return out;
}

function slimAward(a) {
  const label = AWARD_LABELS[a.type]?.label || a.type;
  const out = { type: a.type, label };
  if (a.segment) out.segment = a.segment;
  if (a.message) out.message = a.message;
  if (a.delta != null) out.delta = a.delta;
  return out;
}

function buildFormContext(allActivities, rideDate) {
  const rideDateMs = new Date(rideDate).getTime();
  const preceding = allActivities
    .filter(a => new Date(a.start_date).getTime() < rideDateMs)
    .sort((a, b) => (b.start_date_local || "").localeCompare(a.start_date_local || ""));

  const last14 = preceding.slice(0, 14);
  const last30 = preceding.slice(0, 30);

  const rollup = (acts) => {
    if (acts.length === 0) return null;
    const totalDist = acts.reduce((s, a) => s + (a.distance || 0), 0);
    const totalTime = acts.reduce((s, a) => s + (a.moving_time || 0), 0);
    const totalElev = acts.reduce((s, a) => s + (a.total_elevation_gain || 0), 0);
    const withPower = acts.filter(a => hasRealPower(a) && a.weighted_average_watts);
    const withHR = acts.filter(a => a.has_heartrate && a.average_heartrate);
    const out = {
      rides: acts.length,
      distance_km: +(totalDist / 1000).toFixed(1),
      moving_hrs: +(totalTime / 3600).toFixed(1),
      elevation_m: Math.round(totalElev),
    };
    if (withPower.length > 0) out.avg_np = Math.round(withPower.reduce((s, a) => s + a.weighted_average_watts, 0) / withPower.length);
    if (withHR.length > 0) out.avg_hr = Math.round(withHR.reduce((s, a) => s + a.average_heartrate, 0) / withHR.length);
    return out;
  };

  const recent = last14.slice(0, 15).map(slimActivity);

  return {
    preceding_7_days: rollup(last14.filter(a => new Date(a.start_date).getTime() >= rideDateMs - 7 * 86400000)),
    preceding_14_days: rollup(last14.filter(a => new Date(a.start_date).getTime() >= rideDateMs - 14 * 86400000)),
    preceding_30_days: rollup(last30.filter(a => new Date(a.start_date).getTime() >= rideDateMs - 30 * 86400000)),
    recent_rides_before: recent,
  };
}

export async function buildRideExport(activityId, options = {}) {
  const includeForm = options.includeForm !== false;
  const act = await getActivity(Number(activityId));
  if (!act) return null;

  const allActivities = await getAllActivities();
  const sorted = [...allActivities].sort((a, b) => (a.start_date_local || "").localeCompare(b.start_date_local || ""));

  let rideAwards = [];
  const segmentAwards = [];
  if (act.has_efforts) {
    const resetEvent = await getResetEvent();
    const userConfig = await getUserConfig();
    const refPoints = userConfig.referencePoints || [];
    const segAwards = await computeAwards(act, resetEvent, refPoints);
    segmentAwards.push(...segAwards);
    rideAwards = computeRideLevelAwards(act, sorted, resetEvent);
  }

  const allEfforts = (act.segment_efforts || []).map(e => {
    const slim = slimEffort(e);
    const ea = segmentAwards.filter(a => a.segment_id === e.segment?.id);
    if (ea.length > 0) slim.awards = ea.map(slimAward);
    return slim;
  });
  const efforts = allEfforts.filter(e => e.awards && e.awards.length > 0);

  const ride = {
    name: act.name,
    date: act.start_date_local?.slice(0, 10),
    type: act.sport_type,
    distance_km: +(act.distance / 1000).toFixed(1),
    moving_time_min: Math.round(act.moving_time / 60),
    elapsed_time_min: Math.round((act.elapsed_time || act.moving_time) / 60),
    elevation_m: Math.round(act.total_elevation_gain || 0),
    avg_speed_kph: +((act.average_speed || 0) * 3.6).toFixed(1),
    max_speed_kph: +((act.max_speed || 0) * 3.6).toFixed(1),
    trainer: act.trainer || false,
  };
  if (hasRealPower(act) && act.average_watts) ride.avg_watts = Math.round(act.average_watts);
  if (hasRealPower(act) && act.weighted_average_watts) ride.np_watts = Math.round(act.weighted_average_watts);
  if (act.kilojoules) ride.kj = Math.round(act.kilojoules);
  if (act.has_heartrate && act.average_heartrate) {
    ride.avg_hr = Math.round(act.average_heartrate);
    ride.max_hr = Math.round(act.max_heartrate || 0);
  }
  if (act.suffer_score) ride.suffer_score = act.suffer_score;

  const ctx = {
    generated_at: new Date().toISOString(),
    export_type: "single_ride",
    ride,
    ride_awards: rideAwards.map(slimAward),
    segment_efforts: efforts,
    total_segment_efforts: allEfforts.length,
  };

  if (act.zones && act.zones !== false) {
    ctx.zones = {};
    if (act.zones.heartrate) {
      ctx.zones.heartrate = act.zones.heartrate.map((b, i) => ({
        zone: `Z${i + 1}`,
        time_s: b.time,
        time_min: Math.round(b.time / 60),
        range_bpm: b.max === -1 ? `${b.min}+` : `${b.min}-${b.max}`,
      })).filter(z => z.time_s > 0);
    }
    if (act.zones.power) {
      const ftp = act.power_curve ? estimateFTP(act.power_curve) : null;
      if (ftp) {
        const BOUNDARIES = [0.55, 0.75, 0.90, 1.05, 1.20, 1.50];
        const zoneNames = ["Z1", "Z2", "Z3", "Z4", "Z5", "Z6", "Z7"];
        const mapped = new Array(7).fill(0);
        for (const b of act.zones.power) {
          const mid = (b.min + (b.max === -1 ? b.min + 50 : b.max)) / 2;
          const ratio = mid / ftp;
          let zi = 0;
          for (let i = 0; i < BOUNDARIES.length; i++) {
            if (ratio >= BOUNDARIES[i]) zi = i + 1;
          }
          mapped[zi] += b.time;
        }
        ctx.zones.power = mapped.map((t, i) => ({
          zone: zoneNames[i],
          time_s: t,
          time_min: Math.round(t / 60),
        })).filter(z => z.time_s > 0);
        ctx.zones.ftp = ftp;
      } else {
        ctx.zones.power_raw = act.zones.power.map(b => ({
          range_watts: b.max === -1 ? `${b.min}+` : `${b.min}-${b.max}`,
          time_s: b.time,
          time_min: Math.round(b.time / 60),
        })).filter(z => z.time_s > 0);
      }
    }
  }

  if (includeForm) {
    const [fitness, streakData] = await Promise.all([
      computeFitnessSummary(),
      Promise.resolve(computeStreakData(sorted)),
    ]);
    ctx.form_context = buildFormContext(sorted, act.start_date);
    ctx.fitness = formatFitness(fitness);
    ctx.streaks = formatStreaks(streakData);
  }

  return ctx;
}

export function rideToMarkdown(ctx) {
  if (!ctx) return "";
  const r = ctx.ride;
  const fmtDist = (m) => formatDistance(m).replace("\u00A0", " ");
  const fmtElev = (m) => formatElevation(m).replace("\u00A0", " ");
  const fmtSpd = (mps) => formatSpeed(mps).replace("\u00A0", " ");
  let md = `# Ride: ${r.name}\n`;
  md += `Date: ${r.date} | Type: ${r.type}\n\n`;

  md += `## Ride Summary\n`;
  md += `- Distance: ${fmtDist(r.distance_km * 1000)}\n`;
  md += `- Moving time: ${r.moving_time_min} min (elapsed: ${r.elapsed_time_min} min)\n`;
  md += `- Elevation: ${fmtElev(r.elevation_m)}\n`;
  md += `- Avg speed: ${fmtSpd(r.avg_speed_kph / 3.6)}, Max: ${fmtSpd(r.max_speed_kph / 3.6)}\n`;
  if (r.np_watts) md += `- Normalized Power: ${r.np_watts} W`;
  if (r.avg_watts) md += `${r.np_watts ? ", " : "- "}Avg Power: ${r.avg_watts} W`;
  if (r.np_watts || r.avg_watts) md += `\n`;
  if (r.kj) md += `- Energy: ${r.kj} kJ\n`;
  if (r.avg_hr) md += `- Heart Rate: avg ${r.avg_hr}, max ${r.max_hr}\n`;
  if (r.suffer_score) md += `- Suffer Score: ${r.suffer_score}\n`;
  if (r.trainer) md += `- Indoor trainer ride\n`;
  md += `\n`;

  if (ctx.zones) {
    md += `## Time in Zones\n`;
    if (ctx.zones.heartrate) {
      md += `**Heart Rate Zones:** `;
      md += ctx.zones.heartrate.map(z => `${z.zone}: ${z.time_min}min`).join(", ");
      md += `\n`;
    }
    if (ctx.zones.power) {
      md += `**Power Zones (FTP: ${ctx.zones.ftp}W):** `;
      md += ctx.zones.power.map(z => `${z.zone}: ${z.time_min}min`).join(", ");
      md += `\n`;
    }
    if (ctx.zones.power_raw) {
      md += `**Power Distribution:** `;
      md += ctx.zones.power_raw.map(z => `${z.range_watts}: ${z.time_min}min`).join(", ");
      md += `\n`;
    }
    md += `\n`;
  }

  if (ctx.ride_awards.length > 0) {
    md += `## Ride-Level Awards\n`;
    for (const a of ctx.ride_awards) {
      md += `- **${a.label}**${a.message ? ": " + a.message : ""}\n`;
    }
    md += `\n`;
  }

  if (ctx.segment_efforts.length > 0) {
    const totalCount = ctx.total_segment_efforts || ctx.segment_efforts.length;
    md += `## Segment Efforts with Awards (${ctx.segment_efforts.length} of ${totalCount})\n`;
    const distUnit = unitSystem.value === "imperial" ? "mi" : "km";
    md += `| Segment | Dist (${distUnit}) | Grade | Time (s) | Watts | HR | Awards |\n`;
    md += `|---------|-----------|-------|----------|-------|----|--------|\n`;
    for (const e of ctx.segment_efforts) {
      const dist = unitSystem.value === "imperial" ? +(e.distance_km / 1.609344).toFixed(2) : e.distance_km;
      const awardStr = (e.awards || []).map(a => a.label).join(", ") || "-";
      md += `| ${e.segment} | ${dist} | ${e.grade_pct}% | ${e.elapsed_time_s} | ${e.avg_watts || "-"} | ${e.avg_hr || "-"} | ${awardStr} |\n`;
    }
    md += `\n`;
  }

  if (ctx.form_context) {
    md += `## Form Leading Into This Ride\n`;
    const windows = [
      ["preceding_7_days", "Last 7 days"],
      ["preceding_14_days", "Last 14 days"],
      ["preceding_30_days", "Last 30 days"],
    ];
    for (const [key, label] of windows) {
      const w = ctx.form_context[key];
      if (w) {
        md += `- **${label}**: ${w.rides} rides, ${fmtDist(w.distance_km * 1000)}, ${w.moving_hrs} hrs, ${fmtElev(w.elevation_m)} elev`;
        if (w.avg_np) md += `, avg NP ${w.avg_np} W`;
        if (w.avg_hr) md += `, avg HR ${w.avg_hr}`;
        md += `\n`;
      }
    }
    if (ctx.form_context.recent_rides_before?.length > 0) {
      md += `\nRecent rides before this one:\n`;
      for (const p of ctx.form_context.recent_rides_before) {
        md += `- **${p.date}** ${p.name}: ${fmtDist(p.distance_km * 1000)}, ${p.moving_time_min} min, ${fmtElev(p.elevation_m)} elev`;
        if (p.np_watts) md += `, NP ${p.np_watts} W`;
        if (p.avg_hr) md += `, HR ${p.avg_hr}`;
        if (p.trainer) md += ` [indoor]`;
        md += `\n`;
      }
    }
    md += `\n`;
  }

  if (ctx.fitness && (ctx.fitness.performance_capacity || ctx.fitness.aerobic_efficiency)) {
    md += `## Current Fitness Indicators\n`;
    if (ctx.fitness.performance_capacity) {
      const pc = ctx.fitness.performance_capacity;
      md += `- Performance Capacity: ${pc.score}/100`;
      if (pc.trend != null) md += ` (trend: ${pc.trend > 0 ? "+" : ""}${pc.trend})`;
      md += `\n`;
    }
    if (ctx.fitness.aerobic_efficiency) {
      const ae = ctx.fitness.aerobic_efficiency;
      md += `- Aerobic Efficiency (EF): ${ae.current_ef}`;
      if (ae.trend_pct != null) md += ` (trend: ${ae.trend_pct > 0 ? "+" : ""}${ae.trend_pct}%)`;
      md += `\n`;
    }
    if (ctx.fitness.interpretation) {
      md += `- Interpretation: **${ctx.fitness.interpretation}**\n`;
    }
    md += `\n`;
  }

  if (ctx.streaks?.weekly_streak) {
    const ws = ctx.streaks.weekly_streak;
    md += `## Consistency\n`;
    md += `- Current weekly streak: ${ws.current_weeks} weeks (longest: ${ws.longest_weeks})\n`;
    if (ws.danger) md += `- Warning: ${ws.danger}\n`;
    md += `\n`;
  }

  return md;
}

// ── Single Segment Export ──────────────────────────────────────

function slimSegmentEffort(e, actMap) {
  const out = {
    date: e.start_date_local?.slice(0, 10),
    elapsed_time_s: e.elapsed_time,
    moving_time_s: e.moving_time,
  };
  if (e.device_watts && e.average_watts) out.avg_watts = Math.round(e.average_watts);
  if (e.average_heartrate) out.avg_hr = Math.round(e.average_heartrate);
  if (e.max_heartrate) out.max_hr = Math.round(e.max_heartrate);
  if (e.average_cadence) out.avg_cadence = Math.round(e.average_cadence);
  if (e.pr_rank) out.pr_rank = e.pr_rank;
  if (actMap && e.activity_id) {
    const act = actMap.get(e.activity_id);
    if (act) out.ride_name = act.name;
  }
  return out;
}

export async function buildSegmentExport(segmentId) {
  const seg = await getSegment(Number(segmentId));
  if (!seg || !seg.efforts || seg.efforts.length === 0) return null;

  const allActs = await getAllActivities();
  const actMap = new Map(allActs.map(a => [a.id, a]));

  const efforts = [...seg.efforts]
    .sort((a, b) => (a.start_date_local || "").localeCompare(b.start_date_local || ""))
    .map(e => slimSegmentEffort(e, actMap));

  const times = seg.efforts.map(e => e.elapsed_time).filter(t => t > 0);
  const sortedTimes = [...times].sort((a, b) => a - b);
  const best = sortedTimes[0];
  const worst = sortedTimes[sortedTimes.length - 1];
  const median = sortedTimes[Math.floor(sortedTimes.length / 2)];
  const mean = Math.round(times.reduce((s, t) => s + t, 0) / times.length);

  const withPower = seg.efforts.filter(e => e.device_watts && e.average_watts);
  const withHR = seg.efforts.filter(e => e.average_heartrate);

  const stats = {
    total_efforts: seg.efforts.length,
    best_time_s: best,
    worst_time_s: worst,
    median_time_s: median,
    mean_time_s: mean,
  };
  if (withPower.length > 0) {
    const powers = withPower.map(e => Math.round(e.average_watts));
    stats.best_power_w = Math.max(...powers);
    stats.avg_power_w = Math.round(powers.reduce((s, p) => s + p, 0) / powers.length);
  }
  if (withHR.length > 0) {
    const hrs = withHR.map(e => Math.round(e.average_heartrate));
    stats.avg_hr = Math.round(hrs.reduce((s, h) => s + h, 0) / hrs.length);
  }

  return {
    generated_at: new Date().toISOString(),
    export_type: "segment_history",
    segment: {
      id: seg.id,
      name: seg.name,
      distance_km: +(seg.distance / 1000).toFixed(2),
      average_grade_pct: seg.average_grade,
      elevation_gain_m: Math.round((seg.elevation_high || 0) - (seg.elevation_low || 0)),
      climb_category: seg.climb_category,
    },
    stats,
    efforts,
  };
}

export function segmentToMarkdown(ctx) {
  if (!ctx) return "";
  const s = ctx.segment;
  let md = `# Segment: ${s.name}\n`;
  md += `Distance: ${s.distance_km} km · Grade: ${s.average_grade_pct}% · Elevation gain: ${s.elevation_gain_m} m`;
  if (s.climb_category > 0) md += ` · Cat ${s.climb_category}`;
  md += `\n\n`;

  const st = ctx.stats;
  md += `## Summary Statistics (${st.total_efforts} efforts)\n`;
  md += `- Best time: ${st.best_time_s}s · Worst: ${st.worst_time_s}s · Median: ${st.median_time_s}s · Mean: ${st.mean_time_s}s\n`;
  if (st.best_power_w) md += `- Best power: ${st.best_power_w} W · Avg power: ${st.avg_power_w} W\n`;
  if (st.avg_hr) md += `- Avg HR: ${st.avg_hr} bpm\n`;
  md += `\n`;

  md += `## All Efforts\n`;
  md += `| Date | Time (s) | Moving (s) |`;
  const hasPower = ctx.efforts.some(e => e.avg_watts);
  const hasHR = ctx.efforts.some(e => e.avg_hr);
  const hasCadence = ctx.efforts.some(e => e.avg_cadence);
  if (hasPower) md += ` Watts |`;
  if (hasHR) md += ` HR |`;
  if (hasCadence) md += ` Cadence |`;
  md += ` Ride |\n`;
  md += `|------|----------|------------|`;
  if (hasPower) md += `-------|`;
  if (hasHR) md += `-----|`;
  if (hasCadence) md += `---------|`;
  md += `------|\n`;
  for (const e of ctx.efforts) {
    md += `| ${e.date} | ${e.elapsed_time_s} | ${e.moving_time_s} |`;
    if (hasPower) md += ` ${e.avg_watts || "-"} |`;
    if (hasHR) md += ` ${e.avg_hr || "-"} |`;
    if (hasCadence) md += ` ${e.avg_cadence || "-"} |`;
    md += ` ${e.ride_name || "-"} |\n`;
  }
  md += `\n`;

  return md;
}
