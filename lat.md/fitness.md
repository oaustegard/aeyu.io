# Fitness

Two complementary form indicators computed entirely from local IndexedDB data. No additional API calls — uses segment efforts and activity data already synced. Entry point: [[src/fitness.js#computeFitnessSummary]].

## Critical Power Model

The 2-parameter Critical Power model (CP, W′) is a physiologically grounded alternative to FTP. Fitted from the all-time best power curve by [[src/critical-power.js#estimateCriticalPower]] via linear regression W = CP·t + W′ over 3–30 min bests.

CP marks the boundary between two regimes: below CP, oxygen uptake reaches steady-state and effort is sustainable in principle; above CP, oxygen uptake keeps climbing toward maximum and W′ (a finite work reservoir, in joules) depletes linearly with the power excess. Time-to-exhaustion above CP is t = W′ / (P − CP) — exposed as [[src/critical-power.js#timeToExhaustion]].

CP and W′ are surfaced alongside the existing FTP estimate in the Dashboard Power Curve card and in the AI coach export. FTP (95% of 20-min best) is retained for compatibility with downstream training platforms; it lacks direct physiological grounding (PMC7552657) but remains the lingua franca of consumer cycling tools.

Fit quality requires at least two durations spaced ≥300s apart. With only the standard 5-min and 20-min bests (the production [[src/power-curve.js#POWER_CURVE_DURATIONS]]), the fit is exact-2-point (no R²); when richer curves are available (demo data, future enrichment), the regression returns R² as well.

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

## Within-Ride Durability

Two single-ride fatigue-resistance metrics computed from the per-second watts + heartrate streams during the power-curve sync pass. Entry point: [[src/durability.js#computeDurability]]. Stored on the activity as `durability` (or `false` when power exists but HR does not). Surfaced in the ActivityDetail "Durability" card and the single-ride coach export ([[coaching#Single Ride Export]]).

These are the within-ride analogue of the athlete-level [[fitness#Aerobic Efficiency]] metric: that one trends Efficiency Factor across weeks of rides; these expose how a single ride held up minute to minute, which Strava does not show.

### Aerobic Decoupling

[[src/durability.js#computeDecoupling]] splits the ride in half and compares the power-to-HR ratio (EF) of each half: `decouplingPct = (efFirst − efSecond) / efFirst × 100`. Under ~5% indicates output held against a steady HR cost. Requires ≥600 samples (~10 min) or returns null.

A matched-power refinement centers a ±20% band on whole-ride average power and reports mean HR in that band first half vs second half — isolating drift at comparable output. Reported only when ≥30 samples land in the band in each half (skipped for highly variable interval rides).

### Sustained Blocks

[[src/durability.js#computeSustainedBlocks]] computes, for each HR floor, the longest *unbroken* run at or above it plus cumulative time. Floors derive from observed max HR (0.70/0.80/0.87/0.93 × max, fallback max 185) in [[src/sync.js#hrThresholds]]. The "Time in Zones" card shows cumulative time; this shows the longest stretch actually held — the durability read.
