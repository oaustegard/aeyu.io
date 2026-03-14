/**
 * LLM Export — Build a compact training context for AI coaching.
 *
 * Aggregates recent rides, pre-computed fitness trends, streak data,
 * and award distributions into a ~2-5KB JSON or markdown payload
 * that fits comfortably in any LLM context window.
 */

import { getAllActivities, getAllSegments, getActivity, getSegment, getResetEvent, getUserConfig } from "./db.js";
import { computeFitnessSummary } from "./fitness.js";
import { computeStreakData, computeAwardsForActivities, computeAwards, computeRideLevelAwards } from "./awards.js";
import { unitSystem } from "./units.js";
import { AWARD_LABELS } from "./award-config.js";

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
    const withPower = acts.filter(a => a.device_watts && a.weighted_average_watts);
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

  const recent = last14.slice(0, 7).map(slimActivity);

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

  const efforts = (act.segment_efforts || []).map(e => {
    const slim = slimEffort(e);
    const ea = segmentAwards.filter(a => a.segment_id === e.segment?.id);
    if (ea.length > 0) slim.awards = ea.map(slimAward);
    return slim;
  });

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
  if (act.device_watts && act.average_watts) ride.avg_watts = Math.round(act.average_watts);
  if (act.device_watts && act.weighted_average_watts) ride.np_watts = Math.round(act.weighted_average_watts);
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
  };

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
  let md = `# Ride: ${r.name}\n`;
  md += `Date: ${r.date} | Type: ${r.type}\n\n`;

  md += `## Ride Summary\n`;
  md += `- Distance: ${r.distance_km} km\n`;
  md += `- Moving time: ${r.moving_time_min} min (elapsed: ${r.elapsed_time_min} min)\n`;
  md += `- Elevation: ${r.elevation_m} m\n`;
  md += `- Avg speed: ${r.avg_speed_kph} km/h, Max: ${r.max_speed_kph} km/h\n`;
  if (r.np_watts) md += `- Normalized Power: ${r.np_watts} W`;
  if (r.avg_watts) md += `${r.np_watts ? ", " : "- "}Avg Power: ${r.avg_watts} W`;
  if (r.np_watts || r.avg_watts) md += `\n`;
  if (r.kj) md += `- Energy: ${r.kj} kJ\n`;
  if (r.avg_hr) md += `- Heart Rate: avg ${r.avg_hr}, max ${r.max_hr}\n`;
  if (r.suffer_score) md += `- Suffer Score: ${r.suffer_score}\n`;
  if (r.trainer) md += `- Indoor trainer ride\n`;
  md += `\n`;

  if (ctx.ride_awards.length > 0) {
    md += `## Ride-Level Awards\n`;
    for (const a of ctx.ride_awards) {
      md += `- **${a.label}**${a.message ? ": " + a.message : ""}\n`;
    }
    md += `\n`;
  }

  if (ctx.segment_efforts.length > 0) {
    md += `## Segment Efforts (${ctx.segment_efforts.length})\n`;
    md += `| Segment | Dist (km) | Grade | Time (s) | Watts | HR | Awards |\n`;
    md += `|---------|-----------|-------|----------|-------|----|--------|\n`;
    for (const e of ctx.segment_efforts) {
      const awardStr = (e.awards || []).map(a => a.label).join(", ") || "-";
      md += `| ${e.segment} | ${e.distance_km} | ${e.grade_pct}% | ${e.elapsed_time_s} | ${e.avg_watts || "-"} | ${e.avg_hr || "-"} | ${awardStr} |\n`;
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
        md += `- **${label}**: ${w.rides} rides, ${w.distance_km} km, ${w.moving_hrs} hrs, ${w.elevation_m} m elev`;
        if (w.avg_np) md += `, avg NP ${w.avg_np} W`;
        if (w.avg_hr) md += `, avg HR ${w.avg_hr}`;
        md += `\n`;
      }
    }
    if (ctx.form_context.recent_rides_before?.length > 0) {
      md += `\nRecent rides before this one:\n`;
      for (const p of ctx.form_context.recent_rides_before) {
        md += `- **${p.date}** ${p.name}: ${p.distance_km} km, ${p.moving_time_min} min, ${p.elevation_m} m`;
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
