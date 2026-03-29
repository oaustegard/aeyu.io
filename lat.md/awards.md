# Awards

The core domain logic. Computes 30+ personal award types from segment effort history and ride-level statistics, entirely client-side against IndexedDB data. Entry point: [[src/awards.js]].

## Award Computation

Awards are computed per-activity by [[src/awards.js#computeAwards]] (segment-level) and [[src/awards.js#computeRideLevelAwards]] (ride-level). The top-level [[src/awards.js#computeAwardsForActivities]] orchestrates both across all activities.

Segment awards compare the current effort against the athlete's own history on that segment. Ride-level awards compare whole-ride metrics (distance, elevation, duration) against the athlete's year or recent rides.

## Data Quality Rules

Filters that prevent meaningless awards on thin data. These are the non-obvious invariants that protect signal quality.

**Minimum efforts**: Comparative awards (Year Best, Recent Best, Beat Median, Top Quartile, Monthly Best, YTD Best) require ≥3 total efforts on a segment. Season First and Milestone are exempt.

**Calendar gate**: Year Best is suppressed before March 1 to avoid trivially winning "best this year" in January with thin data.

**CV filter**: Segments with coefficient of variation > 0.5 (requiring ≥5 efforts) are classified as traffic-dominated. All awards except Season First and Milestone are suppressed. This catches segments where stop lights dominate timing variance.

**Power validation**: Power awards require `device_watts === true` — estimated power from speed/weight is excluded. Indoor awards additionally require `trainer === true`.

## Segment Awards

Per-effort awards comparing against the athlete's history on a specific segment.

**Temporal bests**: Year Best (fastest this calendar year), Monthly Best (fastest this month), Recent Best (best of last 5 attempts, requires 3+ history), YTD Best Time/Power (fastest by this calendar date across all years).

**Statistical**: Beat Median, Top Quartile, Top 10% — only the highest tier is awarded (superseding hierarchy). Requires ≥5 efforts for statistical significance.

**Patterns**: Consistency/Metronome (CV < 0.03 across 8+ recent efforts), Improvement Streak (3+ consecutively faster times), Comeback (beat median after 3+ sub-median efforts).

**Milestones**: Round-number attempt counts, Anniversary (same segment on same calendar date N years later), Best Month Ever (best effort this month across all years), Closing In (within 5% of all-time PR).

**Reference Best**: Comparing against named reference points (e.g., a training partner's time).

## Ride-Level Awards

Per-activity awards computed by [[src/awards.js#computeRideLevelAwards]]. Distance Record, Elevation Record, Segment Count, Endurance Record — each tracking the year's best for that metric.

Power awards form a separate category: NP Year/Recent Best, Work Year/Recent Best, Peak Power, plus indoor-specific variants. Power trend awards use linear regression over the last 10 rides.

## Comeback Mode

When a reset event is active (injury, long break), the engine uses smart fading to avoid demoralizing comparisons against pre-injury performance.

**Recovery zone** (>15% slower than pre-injury best): Suppresses normal comparative awards. Shows comeback-scoped awards instead — Comeback PB, Recovery Milestone (crossed 80/90/95% of pre-injury best).

**Transition zone** (0-15% slower): Shows both normal and comeback awards.

**Recovered** (at or better than pre-injury): Normal awards plus "You're Back!" celebration.

Reset events are stored via [[src/db.js#setResetEvent]] and recovery milestones via [[src/db.js#recordRecoveryMilestone]].

## Streaks

Weekly riding streaks and group ride consistency, computed by [[src/awards.js#computeWeeklyStreaks]] and [[src/awards.js#detectGroupRides]].

Weekly streaks support a mulligan (one missed week doesn't break the streak). Group ride detection uses [[routes]] to identify recurring group rides and track attendance. Streak Danger warns when an active streak is at risk of breaking.

## Award Ranking

[[src/awards.js#rankSegmentAwards]] sorts awards by tier (defined in `AWARD_TIER`) and marks headline awards per segment. Comeback awards are ranked separately from regular awards to avoid tier comparison across contexts.

Display labels and colors are defined in [[src/award-config.js]] as the single source of truth for both Dashboard and ActivityDetail rendering.
