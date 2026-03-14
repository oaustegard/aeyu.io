/**
 * LLM Export — Build a compact training context for AI coaching.
 *
 * Aggregates recent rides, pre-computed fitness trends, streak data,
 * and award distributions into a ~2-5KB JSON or markdown payload
 * that fits comfortably in any LLM context window.
 */

import { getAllActivities, getAllSegments } from "./db.js";
import { computeFitnessSummary } from "./fitness.js";
import { computeStreakData, computeAwardsForActivities } from "./awards.js";
import { unitSystem } from "./units.js";

function filterByDays(activities, days) {
  const cutoff = Date.now() - days * 86400000;
  return activities.filter((a) => new Date(a.start_date).getTime() >= cutoff);
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
  if (a.device_watts && a.weighted_average_watts) {
    slim.np_watts = Math.round(a.weighted_average_watts);
  }
  if (a.device_watts && a.average_watts) {
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
    if (!weeks[key]) weeks[key] = { rides: 0, distance_km: 0, elevation_m: 0, moving_min: 0, np_sum: 0, np_count: 0, hr_sum: 0, hr_count: 0, indoor: 0 };
    const w = weeks[key];
    w.rides++;
    w.distance_km += a.distance / 1000;
    w.elevation_m += a.total_elevation_gain || 0;
    w.moving_min += a.moving_time / 60;
    if (a.device_watts && a.weighted_average_watts) { w.np_sum += a.weighted_average_watts; w.np_count++; }
    if (a.has_heartrate && a.average_heartrate) { w.hr_sum += a.average_heartrate; w.hr_count++; }
    if (a.trainer) w.indoor++;
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
      if (w.indoor > 0) r.indoor_rides = w.indoor;
      return r;
    });
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
  const allActs = await getAllActivities();
  const sorted = [...allActs].sort((a, b) => (a.start_date_local || "").localeCompare(b.start_date_local || ""));
  const recent = filterByDays(sorted, days);

  const [fitness, streakData, awardsMap, segments] = await Promise.all([
    computeFitnessSummary(),
    Promise.resolve(computeStreakData(sorted)),
    recent.length > 0 ? computeAwardsForActivities(recent) : Promise.resolve(new Map()),
    getAllSegments(),
  ]);

  const totalRides = sorted.length;
  const firstRide = sorted.length > 0 ? sorted[0].start_date_local?.slice(0, 10) : null;
  const lastRide = sorted.length > 0 ? sorted[sorted.length - 1].start_date_local?.slice(0, 10) : null;
  const hasPower = sorted.some((a) => a.device_watts);
  const hasHR = sorted.some((a) => a.has_heartrate);
  const sportTypes = [...new Set(sorted.map((a) => a.sport_type))];

  const recentDetail = recent.slice(-10).reverse().map(slimActivity);

  return {
    generated_at: new Date().toISOString(),
    window_days: days,
    athlete_summary: {
      total_rides: totalRides,
      first_ride: firstRide,
      last_ride: lastRide,
      segments_ridden: segments.length,
      has_power_meter: hasPower,
      has_heart_rate: hasHR,
      sport_types: sportTypes,
      unit_preference: unitSystem.value,
    },
    fitness: formatFitness(fitness),
    streaks: formatStreaks(streakData),
    weekly_rollups: buildWeeklyRollups(recent),
    monthly_trends: buildMonthlyDeltas(recent),
    recent_rides: recentDetail,
    award_summary: summarizeAwards(awardsMap),
    rides_in_window: recent.length,
  };
}

export function contextToMarkdown(ctx) {
  let md = `# Cycling Training Data (last ${ctx.window_days} days)\n`;
  md += `Generated: ${ctx.generated_at.slice(0, 10)}\n\n`;

  const s = ctx.athlete_summary;
  md += `## Athlete Summary\n`;
  md += `- ${s.total_rides} total rides (${s.first_ride} to ${s.last_ride})\n`;
  md += `- ${s.segments_ridden} unique segments ridden\n`;
  md += `- Sport types: ${s.sport_types.join(", ")}\n`;
  md += `- Power meter: ${s.has_power_meter ? "yes" : "no"}, HR monitor: ${s.has_heart_rate ? "yes" : "no"}\n`;
  md += `- ${ctx.rides_in_window} rides in the last ${ctx.window_days} days\n\n`;

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
    md += `| Week | Rides | Distance (km) | Elevation (m) | Hours |`;
    const hasNP = ctx.weekly_rollups.some((w) => w.avg_np);
    const hasHR = ctx.weekly_rollups.some((w) => w.avg_hr);
    if (hasNP) md += ` Avg NP |`;
    if (hasHR) md += ` Avg HR |`;
    md += `\n`;
    md += `|------|-------|---------------|---------------|-------|`;
    if (hasNP) md += `--------|`;
    if (hasHR) md += `--------|`;
    md += `\n`;
    for (const w of ctx.weekly_rollups) {
      md += `| ${w.week_of} | ${w.rides} | ${w.distance_km} | ${w.elevation_m} | ${w.moving_hrs} |`;
      if (hasNP) md += ` ${w.avg_np || "-"} |`;
      if (hasHR) md += ` ${w.avg_hr || "-"} |`;
      md += `\n`;
    }
    md += `\n`;
  }

  if (ctx.monthly_trends.length > 0) {
    md += `## Monthly Trends\n`;
    for (const m of ctx.monthly_trends) {
      md += `- ${m.month}: ${m.rides} rides, ${m.distance_km}km, ${m.elevation_m}m elev, ${m.moving_hrs}hrs`;
      if (m.distance_delta_pct != null) md += ` (distance ${m.distance_delta_pct > 0 ? "+" : ""}${m.distance_delta_pct}% vs prev)`;
      md += `\n`;
    }
    md += `\n`;
  }

  if (ctx.recent_rides.length > 0) {
    md += `## Last ${ctx.recent_rides.length} Rides\n`;
    for (const r of ctx.recent_rides) {
      md += `- **${r.date}** ${r.name}: ${r.distance_km}km, ${r.moving_time_min}min, ${r.elevation_m}m`;
      if (r.np_watts) md += `, NP ${r.np_watts}W`;
      if (r.avg_hr) md += `, HR ${r.avg_hr}`;
      if (r.trainer) md += ` [indoor]`;
      md += `\n`;
    }
    md += `\n`;
  }

  const awardTypes = Object.entries(ctx.award_summary);
  if (awardTypes.length > 0) {
    md += `## Awards Earned (last ${ctx.window_days} days)\n`;
    awardTypes.sort((a, b) => b[1] - a[1]);
    for (const [type, count] of awardTypes) {
      md += `- ${type}: ${count}\n`;
    }
    md += `\n`;
  }

  return md;
}
