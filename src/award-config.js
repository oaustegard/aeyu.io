/**
 * Award Labels and Colors — Single source of truth
 * Extracted from Dashboard.js and ActivityDetail.js (#74).
 *
 * Each entry has: label (display name), dot (accent color), bg, text, border.
 * AWARD_COLORS is derived from AWARD_LABELS for share card rendering.
 */

export const AWARD_LABELS = {
  season_first:       { label: "Season First",      dot: "#3D7A4A", bg: "#E8F2E6", text: "#1E4D28", border: "#C0D8B8" },
  year_best:          { label: "Year Best",          dot: "#B8862E", bg: "#FBF0D8", text: "#6E5010", border: "#E8D4A0" },
  recent_best:        { label: "Recent Best",        dot: "#4882A8", bg: "#E4EEF6", text: "#2A5470", border: "#B8D0E4" },
  beat_median:        { label: "Beat Median",        dot: "#7A5C8A", bg: "#ECE4F0", text: "#4A3060", border: "#CCC0D8" },
  top_quartile:       { label: "Top Quartile",       dot: "#5B6CA0", bg: "#E4E8F2", text: "#34406A", border: "#BCC4DC" },
  top_decile:         { label: "Top 10%",            dot: "#B85A28", bg: "#F8E4D4", text: "#7A3418", border: "#E8C0A4" },
  consistency:        { label: "Metronome",          dot: "#6B6260", bg: "#ECEAE6", text: "#3E3A36", border: "#D4D0C8" },
  monthly_best:       { label: "Monthly Best",       dot: "#C08020", bg: "#FAF0D8", text: "#785010", border: "#E8D8A8" },
  improvement_streak: { label: "On a Roll",          dot: "#3D7A4A", bg: "#E4F0E4", text: "#204E28", border: "#B8D4B0" },
  comeback:           { label: "Comeback",           dot: "#A05060", bg: "#F4E4E8", text: "#6E2E3C", border: "#DCC0C8" },
  milestone:          { label: "Milestone",          dot: "#8C7A30", bg: "#F4EEDA", text: "#5C5018", border: "#DCD4A8" },
  best_month_ever:    { label: "Best Month Ever",    dot: "#8C7A30", bg: "#F4EEDA", text: "#5C5018", border: "#DCD4A8" },
  closing_in:         { label: "Closing In",         dot: "#A04880", bg: "#F2E0EC", text: "#6A2858", border: "#D8B8D0" },
  anniversary:        { label: "Anniversary",        dot: "#6B5CA0", bg: "#E8E4F4", text: "#3E3070", border: "#C4BCD8" },
  distance_record:    { label: "Longest Ride",       dot: "#4882A8", bg: "#E4EEF6", text: "#2A5470", border: "#B8D0E4" },
  elevation_record:   { label: "Most Climbing",      dot: "#6B6260", bg: "#ECEAE6", text: "#3E3A36", border: "#D4D0C8" },
  segment_count:      { label: "Most Segments",      dot: "#6B6260", bg: "#ECEAE6", text: "#3E3A36", border: "#D4D0C8" },
  endurance_record:   { label: "Longest by Time",    dot: "#6B6260", bg: "#ECEAE6", text: "#3E3A36", border: "#D4D0C8" },
  ytd_best_time:      { label: "YTD Best",           dot: "#9C6E18", bg: "#F8ECD0", text: "#5E4010", border: "#E0CCA0" },
  ytd_best_power:     { label: "YTD Power",          dot: "#B85030", bg: "#F6DED4", text: "#7A2E18", border: "#E4B8A4" },
  // Comeback mode (#60)
  comeback_pb:        { label: "Comeback PB",        dot: "#A05060", bg: "#F4E4E8", text: "#6E2E3C", border: "#DCC0C8" },
  recovery_milestone: { label: "Recovery",           dot: "#A05060", bg: "#F4E4E8", text: "#6E2E3C", border: "#DCC0C8" },
  comeback_full:      { label: "You're Back!",       dot: "#3D7A4A", bg: "#E8F2E6", text: "#1E4D28", border: "#C0D8B8" },
  comeback_distance:  { label: "Comeback Distance",  dot: "#A05060", bg: "#F4E4E8", text: "#6E2E3C", border: "#DCC0C8" },
  comeback_elevation: { label: "Comeback Climbing",  dot: "#A05060", bg: "#F4E4E8", text: "#6E2E3C", border: "#DCC0C8" },
  comeback_endurance: { label: "Comeback Endurance",  dot: "#A05060", bg: "#F4E4E8", text: "#6E2E3C", border: "#DCC0C8" },
  reference_best:     { label: "Reference Best",     dot: "#6B6260", bg: "#ECEAE6", text: "#3E3A36", border: "#D4D0C8" },
  // Route-level Season First (#59)
  route_season_first: { label: "Route Season First", dot: "#3D7A4A", bg: "#E8F2E6", text: "#1E4D28", border: "#C0D8B8" },
  // Activity-level power awards (#45)
  season_first_power: { label: "First Power Ride",   dot: "#3D7A4A", bg: "#E8F2E6", text: "#1E4D28", border: "#C0D8B8" },
  np_year_best:       { label: "NP Year Best",       dot: "#B8862E", bg: "#FBF0D8", text: "#6E5010", border: "#E8D4A0" },
  np_recent_best:     { label: "NP Recent Best",     dot: "#4882A8", bg: "#E4EEF6", text: "#2A5470", border: "#B8D0E4" },
  work_year_best:     { label: "Work Year Best",     dot: "#C08020", bg: "#FAF0D8", text: "#785010", border: "#E8D8A8" },
  work_recent_best:   { label: "Work Recent Best",   dot: "#C08020", bg: "#FAF0D8", text: "#785010", border: "#E8D8A8" },
  peak_power:         { label: "Peak Power",         dot: "#A03020", bg: "#F6DCD4", text: "#6E1810", border: "#E4B0A4" },
  peak_power_recent:  { label: "Peak Recent",        dot: "#A03020", bg: "#F6DCD4", text: "#6E1810", border: "#E4B0A4" },
  // Indoor training awards (#46)
  indoor_np_year_best:  { label: "Indoor NP Best",   dot: "#B85A28", bg: "#F8E4D4", text: "#7A3418", border: "#E8C0A4" },
  indoor_work_year_best:{ label: "Indoor Work Best",  dot: "#B85A28", bg: "#F8E4D4", text: "#7A3418", border: "#E8C0A4" },
  trainer_streak:       { label: "Trainer Streak",    dot: "#B85A28", bg: "#F8E4D4", text: "#7A3418", border: "#E8C0A4" },
  indoor_vs_outdoor:    { label: "Indoor vs Outdoor", dot: "#4882A8", bg: "#E4EEF6", text: "#2A5470", border: "#B8D0E4" },
  // Streak & consistency awards (#58)
  weekly_streak:        { label: "Ride Streak",       dot: "#3D7A4A", bg: "#E8F2E6", text: "#1E4D28", border: "#C0D8B8" },
  group_consistency:    { label: "Group Ride",        dot: "#5B6CA0", bg: "#E4E8F2", text: "#34406A", border: "#BCC4DC" },
  // Power trend & milestone awards (#47)
  watt_milestone:       { label: "Watt Milestone",    dot: "#A03020", bg: "#F6DCD4", text: "#6E1810", border: "#E4B0A4" },
  kj_milestone:         { label: "kJ Milestone",      dot: "#B85A28", bg: "#F8E4D4", text: "#7A3418", border: "#E8C0A4" },
  power_progression:    { label: "Power Up",          dot: "#3D7A4A", bg: "#E4F0E4", text: "#204E28", border: "#B8D4B0" },
  power_consistency:    { label: "Steady Power",      dot: "#6B6260", bg: "#ECEAE6", text: "#3E3A36", border: "#D4D0C8" },
  ftp_milestone:        { label: "FTP Milestone",     dot: "#A03020", bg: "#F6DCD4", text: "#6E1810", border: "#E4B0A4" },
  // Power curve awards (#48)
  curve_year_best:      { label: "Curve Year Best",   dot: "#B8862E", bg: "#FBF0D8", text: "#6E5010", border: "#E8D4A0" },
  curve_all_time:       { label: "Curve Record",      dot: "#A03020", bg: "#F6DCD4", text: "#6E1810", border: "#E4B0A4" },
};

// Share card colors derived from AWARD_LABELS
export const AWARD_COLORS = Object.fromEntries(
  Object.entries(AWARD_LABELS).map(([k, v]) => [k, { bg: v.bg, text: v.text, accent: v.dot, border: v.border }])
);
