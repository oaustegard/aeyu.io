# Fitness

Two complementary form indicators computed entirely from local IndexedDB data. No additional API calls — uses segment efforts and activity data already synced. Entry point: [[src/fitness.js#computeFitnessSummary]].

## Performance Capacity

Measures what the athlete's body can produce on the bike. Uses climb segment performance over time to produce a 0-100 index relative to the athlete's own all-time range. Does not require heart rate or power meter data.

Algorithm in [[src/fitness.js#computePerformanceCapacity]]:

1. Filter segments to climbs (≥4% grade or Strava climb category) with ≥3 efforts
2. For each qualifying segment, compute estimated W/kg per effort using the Ferrari formula (VAM / (200 + 10 × gradient)), or actual watts if a power meter is present
3. Rank recent efforts (last 90 days) against all-time history as percentiles
4. Weight by recency using exponential decay (30-day half-life)
5. Composite score: average across all qualifying segments

**Score** is a 90-day composite across ALL qualifying climb segments. **Trend** is derived from the rolling history — comparing the latest 4-week rolling score to the score 42 days prior.

The rolling history (built by `buildRollingHistory`) steps backwards weekly over 6 months, computing the same recency-weighted percentile at each point. This feeds the sparkline chart in the Dashboard.

## Aerobic Efficiency

Measures what that output costs the athlete. Uses Efficiency Factor (NP/HR) per Friel/TrainingPeaks methodology. Only meaningful for steady-state rides with a power meter and heart rate monitor.

Algorithm in [[src/fitness.js#computeAerobicEfficiency]]:

1. Filter to cycling rides ≥30 minutes with power meter AND heart rate data
2. Exclude high-variability rides (Variability Index > 1.25) — interval sessions skew EF
3. Compute EF = Normalized Power / avg heart rate for each qualifying ride
4. Average recent EF (last 6 weeks) vs prior 6 weeks for trend
5. Build monthly history for chart display (capped to 12 months)

Higher EF = more output per heartbeat = fitter. VirtualRide power is treated as device power since it always comes from a trainer.

When the athlete has power-metered rides but no heart rate data in the recent window, the system still reports power-only statistics so the UI can show partial information rather than nothing.

## Interpretation

[[src/fitness.js#computeFitnessSummary]] combines both indicators and produces a contextual interpretation based on trend directions:

**ideal** — both trending up. **pushing** — capacity up, efficiency flat. **building** — efficiency up, capacity flat. **overreaching** — capacity up but efficiency dropping. **detraining** — both declining. **maintaining** — stable.

Season context (northern hemisphere cycling seasons) is included for UI display.
