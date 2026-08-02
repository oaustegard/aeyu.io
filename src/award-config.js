/**
 * Award Labels and Colors — Single source of truth
 * Extracted from Dashboard.js and ActivityDetail.js (#74).
 *
 * Each entry has: label (display name), dot (accent color), bg, text, border.
 * AWARD_COLORS is derived from AWARD_LABELS for share card rendering.
 */

export const AWARD_LABELS = {
  season_first:       { label: "Season First",      tip: "First effort on a segment this calendar year", dot: "#3D7A4A", bg: "#E8F2E6", text: "#1E4D28", border: "#C0D8B8" },
  year_best:          { label: "Year Best",          tip: "Fastest time on a segment this year", dot: "#B8862E", bg: "#FBF0D8", text: "#6E5010", border: "#E8D4A0" },
  recent_best:        { label: "Recent Best",        tip: "Fastest of your last 5 attempts", dot: "#4882A8", bg: "#E4EEF6", text: "#2A5470", border: "#B8D0E4" },
  beat_median:        { label: "Beat Median",        tip: "Beat your median time by 2%+", dot: "#7A5C8A", bg: "#ECE4F0", text: "#4A3060", border: "#CCC0D8" },
  top_quartile:       { label: "Top Quartile",       tip: "In the top 25% of your history", dot: "#5B6CA0", bg: "#E4E8F2", text: "#34406A", border: "#BCC4DC" },
  top_decile:         { label: "Top 10%",            tip: "In the top 10% of your history", dot: "#B85A28", bg: "#F8E4D4", text: "#7A3418", border: "#E8C0A4" },
  consistency:        { label: "Metronome",          tip: "Remarkably consistent — low variance across last 8 efforts", dot: "#6B6260", bg: "#ECEAE6", text: "#3E3A36", border: "#D4D0C8" },
  monthly_best:       { label: "Monthly Best",       tip: "Fastest time on a segment this month", dot: "#C08020", bg: "#FAF0D8", text: "#785010", border: "#E8D8A8" },
  improvement_streak: { label: "On a Roll",          tip: "3+ consecutive improving times", dot: "#3D7A4A", bg: "#E4F0E4", text: "#204E28", border: "#B8D4B0" },
  comeback:           { label: "Comeback",           tip: "Beat your median after 3+ slower efforts", dot: "#A05060", bg: "#F4E4E8", text: "#6E2E3C", border: "#DCC0C8" },
  milestone:          { label: "Milestone",          tip: "Round-number attempt (10th, 25th, 50th…)", dot: "#8C7A30", bg: "#F4EEDA", text: "#5C5018", border: "#DCD4A8" },
  best_month_ever:    { label: "Best Month Ever",    tip: "Fastest time in this calendar month across all years", dot: "#8C7A30", bg: "#F4EEDA", text: "#5C5018", border: "#DCD4A8" },
  closing_in:         { label: "Closing In",         tip: "Within 5% of your all-time PR", dot: "#A04880", bg: "#F2E0EC", text: "#6A2858", border: "#D8B8D0" },
  matched_pr:         { label: "Matched PR",         tip: "Tied your all-time personal record", dot: "#C84040", bg: "#F8E0E0", text: "#7A2020", border: "#E4B0B0" },
  all_time_top3:      { label: "All-Time Top 3",     tip: "2nd or 3rd fastest you have ever ridden this segment", dot: "#C84040", bg: "#F8E0E0", text: "#7A2020", border: "#E4B0B0" },
  near_kom:           { label: "Near KOM",           tip: "Within 15% of the segment's all-time course record", dot: "#7A2E8A", bg: "#F0E2F4", text: "#4A1858", border: "#D4B8DC" },
  anniversary:        { label: "Anniversary",        tip: "Rode this segment on the same date in a previous year", dot: "#6B5CA0", bg: "#E8E4F4", text: "#3E3070", border: "#C4BCD8" },
  distance_record:    { label: "Longest Ride",       tip: "Longest ride of the year by distance", dot: "#4882A8", bg: "#E4EEF6", text: "#2A5470", border: "#B8D0E4" },
  elevation_record:   { label: "Most Climbing",      tip: "Most elevation gain in a single ride this year", dot: "#6B6260", bg: "#ECEAE6", text: "#3E3A36", border: "#D4D0C8" },
  segment_count:      { label: "Most Segments",      tip: "Most segments hit in a single ride this year", dot: "#6B6260", bg: "#ECEAE6", text: "#3E3A36", border: "#D4D0C8" },
  endurance_record:   { label: "Longest by Time",    tip: "Longest ride by moving time this year", dot: "#6B6260", bg: "#ECEAE6", text: "#3E3A36", border: "#D4D0C8" },
  ytd_best_time:      { label: "YTD Best",           tip: "Fastest by this date across multiple years", dot: "#9C6E18", bg: "#F8ECD0", text: "#5E4010", border: "#E0CCA0" },
  ytd_best_power:     { label: "YTD Power",          tip: "Highest measured power by this date across years", dot: "#B85030", bg: "#F6DED4", text: "#7A2E18", border: "#E4B8A4" },
  // Comeback mode (#60)
  comeback_pb:        { label: "Comeback PB",        tip: "Post-injury personal best on a segment", dot: "#A05060", bg: "#F4E4E8", text: "#6E2E3C", border: "#DCC0C8" },
  recovery_milestone: { label: "Recovery",           tip: "Reached 80%, 90%, or 95% of pre-injury best", dot: "#A05060", bg: "#F4E4E8", text: "#6E2E3C", border: "#DCC0C8" },
  comeback_full:      { label: "You're Back!",       tip: "Matched or beaten your pre-injury best", dot: "#3D7A4A", bg: "#E8F2E6", text: "#1E4D28", border: "#C0D8B8" },
  comeback_distance:  { label: "Comeback Distance",  tip: "Post-injury distance record", dot: "#A05060", bg: "#F4E4E8", text: "#6E2E3C", border: "#DCC0C8" },
  comeback_elevation: { label: "Comeback Climbing",  tip: "Post-injury climbing record", dot: "#A05060", bg: "#F4E4E8", text: "#6E2E3C", border: "#DCC0C8" },
  comeback_endurance: { label: "Comeback Endurance",  tip: "Post-injury endurance record", dot: "#A05060", bg: "#F4E4E8", text: "#6E2E3C", border: "#DCC0C8" },
  reference_best:     { label: "Reference Best",     tip: "Best within a user-defined window", dot: "#6B6260", bg: "#ECEAE6", text: "#3E3A36", border: "#D4D0C8" },
  // Route-level Season First (#59)
  route_season_first: { label: "Season First",       tip: "First time riding this route this year", dot: "#3D7A4A", bg: "#E8F2E6", text: "#1E4D28", border: "#C0D8B8" },
  route_season_first_more: { label: "Season First",  tip: "More segments ridden for the first time on this route this year", dot: "#6A9E74", bg: "#EEF5EC", text: "#2E5E38", border: "#C8DCC2" },
  // Activity-level power awards (#45)
  season_first_power: { label: "First Power Ride",   tip: "First ride with power data this year", dot: "#3D7A4A", bg: "#E8F2E6", text: "#1E4D28", border: "#C0D8B8" },
  np_year_best:       { label: "NP Year Best",       tip: "Highest Normalized Power this year", dot: "#B8862E", bg: "#FBF0D8", text: "#6E5010", border: "#E8D4A0" },
  np_recent_best:     { label: "NP Recent Best",     tip: "Highest NP in recent rides", dot: "#4882A8", bg: "#E4EEF6", text: "#2A5470", border: "#B8D0E4" },
  work_year_best:     { label: "Work Year Best",     tip: "Most total work (kJ) this year", dot: "#C08020", bg: "#FAF0D8", text: "#785010", border: "#E8D8A8" },
  work_recent_best:   { label: "Work Recent Best",   tip: "Most total work (kJ) in recent rides", dot: "#C08020", bg: "#FAF0D8", text: "#785010", border: "#E8D8A8" },
  peak_power:         { label: "Peak Power",         tip: "Highest max power this year", dot: "#A03020", bg: "#F6DCD4", text: "#6E1810", border: "#E4B0A4" },
  peak_power_recent:  { label: "Peak Recent",        tip: "Highest max power in recent rides", dot: "#A03020", bg: "#F6DCD4", text: "#6E1810", border: "#E4B0A4" },
  // Indoor training awards (#46)
  indoor_np_year_best:  { label: "Indoor NP Best",   tip: "Highest indoor Normalized Power this year", dot: "#B85A28", bg: "#F8E4D4", text: "#7A3418", border: "#E8C0A4" },
  indoor_work_year_best:{ label: "Indoor Work Best",  tip: "Most indoor work (kJ) this year", dot: "#B85A28", bg: "#F8E4D4", text: "#7A3418", border: "#E8C0A4" },
  trainer_streak:       { label: "Trainer Streak",    tip: "Consecutive weeks with indoor rides", dot: "#B85A28", bg: "#F8E4D4", text: "#7A3418", border: "#E8C0A4" },
  indoor_vs_outdoor:    { label: "Indoor vs Outdoor", tip: "Comparing indoor and outdoor performance", dot: "#4882A8", bg: "#E4EEF6", text: "#2A5470", border: "#B8D0E4" },
  // Streak & consistency awards (#58)
  weekly_streak:        { label: "Ride Streak",       tip: "Consecutive weeks with at least one ride", dot: "#3D7A4A", bg: "#E8F2E6", text: "#1E4D28", border: "#C0D8B8" },
  group_consistency:    { label: "Group Ride",        tip: "Recurring ride detected by day, time, and location", dot: "#5B6CA0", bg: "#E4E8F2", text: "#34406A", border: "#BCC4DC" },
  // Power trend & milestone awards (#47)
  watt_milestone:       { label: "Watt Milestone",    tip: "Average power exceeds a new threshold", dot: "#A03020", bg: "#F6DCD4", text: "#6E1810", border: "#E4B0A4" },
  kj_milestone:         { label: "kJ Milestone",      tip: "Total ride energy exceeds a new threshold", dot: "#B85A28", bg: "#F8E4D4", text: "#7A3418", border: "#E8C0A4" },
  power_progression:    { label: "Power Up",          tip: "Normalized Power trending upward over last 10 rides", dot: "#3D7A4A", bg: "#E4F0E4", text: "#204E28", border: "#B8D4B0" },
  power_consistency:    { label: "Steady Power",      tip: "Low NP variation across last 10 rides", dot: "#6B6260", bg: "#ECEAE6", text: "#3E3A36", border: "#D4D0C8" },
  ftp_milestone:        { label: "FTP Milestone",     tip: "Estimated FTP crosses a new threshold", dot: "#A03020", bg: "#F6DCD4", text: "#6E1810", border: "#E4B0A4" },
  cp_milestone:         { label: "CP Milestone",      tip: "Critical Power (fit from 3–30 min bests) crosses a new threshold", dot: "#6B4F8F", bg: "#ECE4F0", text: "#3D2A60", border: "#CCC0D8" },
  // Power curve awards (#48)
  curve_year_best:      { label: "Curve Year Best",   tip: "Year's best power at a standard duration", dot: "#B8862E", bg: "#FBF0D8", text: "#6E5010", border: "#E8D4A0" },
  curve_all_time:       { label: "Curve Record",      tip: "All-time personal record at a power curve duration", dot: "#A03020", bg: "#F6DCD4", text: "#6E1810", border: "#E4B0A4" },
};

// Share card colors derived from AWARD_LABELS
export const AWARD_COLORS = Object.fromEntries(
  Object.entries(AWARD_LABELS).map(([k, v]) => [k, { bg: v.bg, text: v.text, accent: v.dot, border: v.border }])
);

/**
 * Award priority — the SINGLE source of truth for "which award matters more".
 *
 * Higher wins. Previously this lived in two places that disagreed: `AWARD_TIER`
 * in awards.js (5→1 buckets, where closing_in tied year_best) and a private
 * `TIER` map in ActivityDetail.js (20→3, where year_best outranked closing_in
 * by seven points). The share card used the second one, so a near-PR effort
 * lost its slot to a merely-best-this-year effort on a segment ridden three
 * times. Both consumers now read this table.
 *
 * Ordering principle: all-time standing beats calendar-window standing. Being
 * one second off a PR is a bigger deal than being the fastest you have gone
 * since January.
 */
export const AWARD_PRIORITY = {
  // All-time standing on a segment
  matched_pr:           96,
  all_time_top3:        94,
  // Above closing_in deliberately: being near the course record is rarer and
  // says something closing_in cannot, and MAX_AWARDS_PER_SEGMENT is 2 — at
  // 86 it was capped out of every segment where it fired (caught by the
  // harness audit, #131).
  near_kom:             92,
  closing_in:           90,
  curve_all_time:       88,
  comeback_full:        88,
  // Season / calendar-window bests
  route_season_first:   80,
  year_best:            78,
  ytd_best_time:        74,
  ytd_best_power:       74,
  np_year_best:         72,
  peak_power:           72,
  curve_year_best:      72,
  best_month_ever:      68,
  top_decile:           66,
  distance_record:      66,
  elevation_record:     64,
  ftp_milestone:        64,
  cp_milestone:         64,
  endurance_record:     62,
  work_year_best:       60,
  comeback_pb:          60,
  improvement_streak:   58,
  recovery_milestone:   56,
  route_season_first_more: 56,
  watt_milestone:       54,
  top_quartile:         52,
  comeback:             50,
  kj_milestone:         50,
  indoor_np_year_best:  50,
  recent_best:          48,
  np_recent_best:       48,
  indoor_work_year_best: 46,
  monthly_best:         44,
  work_recent_best:     44,
  peak_power_recent:    44,
  power_progression:    42,
  trainer_streak:       40,
  beat_median:          38,
  indoor_vs_outdoor:    36,
  season_first:         34,
  season_first_power:   34,
  comeback_distance:    34,
  comeback_elevation:   34,
  comeback_endurance:   34,
  reference_best:       32,
  consistency:          30,
  power_consistency:    30,
  weekly_streak:        30,
  milestone:            20,
  group_consistency:    18,
  anniversary:          16,
  segment_count:        14,
};

/** Efforts within this fraction of the PR count as "essentially a PR" for strength. */
const STRENGTH_PR_WINDOW = 0.10;

/**
 * How big an instance of an award this is, in [0, 1).
 *
 * Award type alone says what KIND of thing happened; it says nothing about
 * magnitude. "Year Best" on a segment ridden 3 times and "Year Best" that is
 * also your 2nd-fastest of 49 attempts were previously indistinguishable, and
 * ties broke on array order — i.e. on where the segment fell in the ride.
 *
 * Strength is derived from two independent readings of the same effort, and
 * takes the more flattering:
 *   - all-time rank percentile among your own efforts on that segment
 *   - proximity to your PR (linear over a 10% window)
 *
 * Segment awards get these fields annotated by computeAwards; ride-level
 * awards have none and score 0, which only ever affects tie-breaks within
 * their own priority band.
 */
export function awardStrength(award) {
  if (!award) return 0;
  let s = 0;
  if (award.all_time_rank > 0 && award.effort_count > 0) {
    s = Math.max(s, 1 - (award.all_time_rank - 1) / award.effort_count);
  }
  if (award.pr_gap_pct != null && award.pr_gap_pct >= 0) {
    s = Math.max(s, 1 - award.pr_gap_pct / STRENGTH_PR_WINDOW);
  }
  return Math.min(Math.max(s, 0), 1) * 0.999;
}

/**
 * Sortable score: priority band, then magnitude within the band.
 * Strength is capped below 1 so it can never promote an award past the next
 * band up — a huge Beat Median stays a Beat Median.
 */
export function awardScore(award) {
  return (AWARD_PRIORITY[award?.type] || 0) + awardStrength(award);
}

// Grouped award types for settings toggles — each group can be toggled as a unit
// or individual types within can be toggled. Descriptions match FAQ.
export const AWARD_GROUPS = [
  {
    group: "Segment Awards",
    types: [
      { type: "season_first", desc: "First effort on a segment this calendar year." },
      { type: "year_best", desc: "Fastest time on a segment this year (after March, with 3+ efforts)." },
      { type: "ytd_best_time", desc: "Fastest time by this date across multiple years — your best performance at this point in the season." },
      { type: "ytd_best_power", desc: "Highest measured power by this date across multiple years. Only counts power meter data." },
      { type: "recent_best", desc: "Fastest of your last 5 attempts on a segment." },
      { type: "beat_median", desc: "Beat your median time by 2%+ on a segment (requires 5+ efforts)." },
      { type: "top_quartile", desc: "In the top 25% of your own history on this segment (requires 5+ efforts)." },
      { type: "top_decile", desc: "In the top 10% of your own history. Supersedes Top Quartile and Beat Median." },
      { type: "consistency", desc: "Remarkably consistent — low variance across your last 8 efforts (CV < 3%)." },
      { type: "monthly_best", desc: "Fastest time on a segment this calendar month." },
      { type: "improvement_streak", desc: "3+ consecutive improving times on a segment — each ride faster than the last." },
      { type: "comeback", desc: "Beat your median after 3+ slower efforts in a row." },
      { type: "closing_in", desc: "Within 5% of your all-time PR on a segment — you're close to a personal best." },
      { type: "matched_pr", desc: "Tied your all-time PR on a segment. Strava doesn't give you a trophy for ties — aeyu does." },
      { type: "all_time_top3", desc: "2nd or 3rd fastest effort you have ever put out on a segment. Strava shows this as a small silver or bronze medal and nothing else." },
      { type: "near_kom", desc: "Within 15% of the segment's course record. Only checked when the effort is already one of your all-time top 3." },
      { type: "best_month_ever", desc: "Fastest time in this calendar month across all years — your best March ever, for example." },
      { type: "milestone", desc: "Round-number attempt on a segment (10th, 25th, 50th, 100th, etc.)." },
      { type: "anniversary", desc: "Rode this segment on the same date in a previous year." },
      { type: "reference_best", desc: "Best effort within a user-defined window — since a date, in last N efforts, or since turning an age." },
    ],
  },
  {
    group: "Ride Awards",
    types: [
      { type: "distance_record", desc: "Your longest ride of the year by distance." },
      { type: "elevation_record", desc: "Most elevation gain in a single ride this year." },
      { type: "segment_count", desc: "Most segments hit in a single ride this year." },
      { type: "endurance_record", desc: "Longest ride by moving time this year — your biggest endurance effort." },
      { type: "route_season_first", desc: "First time riding a known route this year." },
      { type: "route_season_first_more", desc: "More segments ridden for the first time on a route you've already started this year." },
    ],
  },
  {
    group: "Streaks & Consistency",
    types: [
      { type: "weekly_streak", desc: "Consecutive weeks with at least one ride. One missed week is forgiven — two consecutive misses break the streak." },
      { type: "group_consistency", desc: "Detects recurring rides by day, time, and location. Tracks your attendance streak on each group ride." },
    ],
  },
  {
    group: "Power Awards",
    types: [
      { type: "season_first_power", desc: "First ride with power data this year." },
      { type: "np_year_best", desc: "Highest Normalized Power this year." },
      { type: "np_recent_best", desc: "Highest NP in recent rides." },
      { type: "work_year_best", desc: "Most total work (kJ) this year." },
      { type: "work_recent_best", desc: "Most total work (kJ) in recent rides." },
      { type: "peak_power", desc: "Highest max power this year." },
      { type: "peak_power_recent", desc: "Highest max power in recent rides." },
      { type: "watt_milestone", desc: "First ride where your average power exceeds a threshold (100W, 150W, ... 350W)." },
      { type: "kj_milestone", desc: "First ride exceeding an energy threshold (500kJ, 1000kJ, ... 3000kJ)." },
      { type: "power_progression", desc: "Your Normalized Power is trending upward over your last 10 rides." },
      { type: "power_consistency", desc: "Low variation in NP across your last 10 rides — steady, repeatable power output." },
      { type: "ftp_milestone", desc: "Your estimated FTP crosses a threshold (150W, 200W, ... 400W). Requires power curve data." },
      { type: "cp_milestone", desc: "Your Critical Power (fit from all-time 3–30 min bests) crosses a threshold (150W, 200W, ... 400W). Requires multiple power-metered rides." },
    ],
  },
  {
    group: "Power Curve",
    types: [
      { type: "curve_year_best", desc: "Year's best power at a standard duration (5s sprint, 1min anaerobic, 5min VO2max, 20min FTP, etc)." },
      { type: "curve_all_time", desc: "All-time personal record at a standard power curve duration. Your best ever." },
    ],
  },
  {
    group: "Indoor Training",
    types: [
      { type: "indoor_np_year_best", desc: "Highest indoor Normalized Power this year." },
      { type: "indoor_work_year_best", desc: "Most indoor work (kJ) this year." },
      { type: "trainer_streak", desc: "Consecutive weeks with indoor rides." },
      { type: "indoor_vs_outdoor", desc: "Comparing indoor and outdoor performance." },
    ],
  },
  {
    group: "Comeback Mode",
    types: [
      { type: "comeback_pb", desc: "Post-injury personal best on a segment. Only appears when Comeback Mode is active." },
      { type: "recovery_milestone", desc: "You've reached 80%, 90%, or 95% of your pre-injury best on a segment." },
      { type: "comeback_full", desc: "You've matched or beaten your pre-injury best. Full recovery on this segment." },
      { type: "comeback_distance", desc: "Post-injury distance record." },
      { type: "comeback_elevation", desc: "Post-injury climbing record." },
      { type: "comeback_endurance", desc: "Post-injury endurance record." },
    ],
  },
];
