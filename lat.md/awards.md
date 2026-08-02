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

**All-time standing**: All-Time Top 3 (2nd or 3rd fastest effort ever on a segment, read from Strava's own `pr_rank` where present, else recomputed from local history), Near KOM (within 15% of the course record, checked only on efforts that are already a personal top 3).

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

Priority is one table — `AWARD_PRIORITY` in [[src/award-config.js]] — read by both [[src/awards.js#rankSegmentAwards]] and the share card.

It replaced two tables that disagreed: a 5→1 `AWARD_TIER` in awards.js that rated Closing In equal to Year Best, and a private 20→3 map inside ActivityDetail that rated it seven points lower. The card used the second, so a near-PR effort could lose its slot to a merely-best-this-year one.

Ordering principle: **all-time standing beats calendar-window standing.** One second off a PR outranks the fastest you have gone since January.

Priority alone still says nothing about magnitude, so [[src/award-config.js#awardStrength]] scores how big an instance an award is, in [0,1), from the effort's all-time rank percentile and its proximity to the PR (whichever reads higher). [[src/award-config.js#awardScore]] adds the two. Strength is capped below 1 so it can never promote an award past the next priority band — a large Beat Median stays a Beat Median.

The standing fields strength reads (`all_time_rank`, `effort_count`, `pr_gap_pct`) are annotated onto every segment award by [[src/awards.js#computeAwards]] after the effort loop, along with the effort's wall-clock span.

[[src/awards.js#rankSegmentAwards]] marks headline awards per segment. Comeback awards are ranked separately from regular awards to avoid comparison across contexts.

Display labels and colors are also defined in [[src/award-config.js]], the single source of truth for Dashboard and ActivityDetail rendering.

## Share Card Selection

The card has four highlight slots, filled by `buildShareCardHighlights` in [[src/components/ActivityDetail.js]]:

1. Best award per segment, by `awardScore`.
2. **Overlapping efforts collapse.** Strava segments nest and overlap — three separate segments can cover one climb, each earning its own award, between them consuming three of four slots. Efforts whose wall-clock spans intersect are reduced to their best award. Dedupe used to key on `segment_id` alone, which does not catch this.
3. Sort by `awardScore`, take four. Ties are broken by magnitude rather than, as before, by array order — which was ride order, so an effort late in a ride lost to an earlier one for reasons unrelated to merit.

## Course Records

Strava does not expose segment leaderboards through its API. The only public standing available is `xoms` on the segment detail endpoint — the KOM, QOM and overall times.

[[src/sync.js#enrichCourseRecords]] fetches it lazily and caches via [[src/db.js#setSegmentKom]], gated on `pr_rank <= 3`: the question "how do I stand against the course record" is only asked once an effort is near the athlete's own ceiling, which keeps this to a handful of extra API calls rather than dozens per activity.

Failures are swallowed — a missing KOM suppresses one optional award and never fails a sync.
