import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWARD_PRIORITY, AWARD_LABELS, awardStrength, awardScore, isCapReinstatable, ALL_TIME_PRIORITY_FLOOR } from '../src/award-config.js';

// Fixture: the 2026-08-02 ride that surfaced all of this (#131).
// Four segments tied at year_best; three of them cover the same Kendale climb.
const t0 = Date.parse('2026-08-02T11:00:00Z');
const s = (ms) => t0 + ms * 1000;

const ANGLERS = {
  type: 'year_best', segment: 'Anglers Hill (climb only)', segment_id: 1,
  time: 256, all_time_rank: 12, effort_count: 54, pr_gap_pct: 0.31,
  effort_start_ms: s(3751), effort_end_ms: s(4007),
};
const KENDALE_LONG = {
  type: 'year_best', segment: 'Kendale: Bradley - Kentsdale', segment_id: 2,
  time: 129, all_time_rank: 1, effort_count: 49, pr_gap_pct: 0,
  effort_start_ms: s(4829), effort_end_ms: s(4958),
};
const KENDALE_MID = {
  type: 'year_best', segment: 'Over the Hill to Ken(ts)Dale', segment_id: 3,
  time: 229, all_time_rank: 2, effort_count: 49, pr_gap_pct: 0.02,
  effort_start_ms: s(4831), effort_end_ms: s(5060),
};
const KENDALE_CLIMB = {
  type: 'year_best', segment: 'Kendale Climb', segment_id: 4,
  time: 68, all_time_rank: 2, effort_count: 49, pr_gap_pct: 1 / 67,
  effort_start_ms: s(4887), effort_end_ms: s(4955),
};
const A_QUARTILE = {
  type: 'top_quartile', segment: '185 to Maple', segment_id: 5,
  time: 67, all_time_rank: 10, effort_count: 49, pr_gap_pct: 0.18,
  effort_start_ms: s(1276), effort_end_ms: s(1343),
};

test('every award type has a priority and a label', () => {
  for (const type of Object.keys(AWARD_LABELS)) {
    assert.ok(AWARD_PRIORITY[type] > 0, `${type} has no priority`);
  }
  for (const type of Object.keys(AWARD_PRIORITY)) {
    assert.ok(AWARD_LABELS[type], `${type} has no label`);
  }
});

test('all-time standing outranks calendar-window standing', () => {
  assert.ok(AWARD_PRIORITY.matched_pr > AWARD_PRIORITY.year_best);
  assert.ok(AWARD_PRIORITY.all_time_top3 > AWARD_PRIORITY.year_best);
  assert.ok(AWARD_PRIORITY.closing_in > AWARD_PRIORITY.year_best);
  assert.ok(AWARD_PRIORITY.year_best > AWARD_PRIORITY.monthly_best);
  // near_kom must clear closing_in or the 2-per-segment cap drops it every
  // time both fire, which is every time near_kom fires at all.
  assert.ok(AWARD_PRIORITY.near_kom > AWARD_PRIORITY.closing_in);
});

test('strength rises with all-time rank and PR proximity', () => {
  assert.ok(awardStrength(KENDALE_CLIMB) > awardStrength(ANGLERS));
  assert.ok(awardStrength(KENDALE_CLIMB) > 0.9);
  assert.ok(awardStrength(A_QUARTILE) < awardStrength(KENDALE_CLIMB));
});

test('strength is bounded below 1 so it cannot jump a priority band', () => {
  const perfect = { type: 'beat_median', all_time_rank: 1, effort_count: 200, pr_gap_pct: 0 };
  assert.ok(awardStrength(perfect) < 1);
  assert.ok(awardScore(perfect) < AWARD_PRIORITY.top_quartile);
});

test('missing standing fields score zero strength, not NaN', () => {
  const rideLevel = { type: 'distance_record' };
  assert.equal(awardStrength(rideLevel), 0);
  assert.equal(awardScore(rideLevel), AWARD_PRIORITY.distance_record);
});

test('same-type awards no longer tie — magnitude breaks it', () => {
  assert.ok(awardScore(KENDALE_CLIMB) > awardScore(ANGLERS),
    'a 2nd-of-49 year best must outrank a 12th-of-54 year best');
});

// Mirror of buildShareCardHighlights, which lives in a Preact component and
// cannot be imported under node:test without a DOM.
function selectHighlights(awards, slots = 4) {
  const bySegment = new Map();
  for (const a of awards) {
    const key = a.segment_id != null ? `seg:${a.segment_id}` : `ride:${a.type}`;
    const prev = bySegment.get(key);
    if (!prev || awardScore(a) > awardScore(prev)) bySegment.set(key, a);
  }
  const segmentAwards = [...bySegment.values()]
    .filter((a) => a.segment_id != null && a.effort_start_ms != null)
    .sort((a, b) => awardScore(b) - awardScore(a));
  const rideAwards = [...bySegment.values()]
    .filter((a) => a.segment_id == null || a.effort_start_ms == null);
  const kept = [];
  for (const a of segmentAwards) {
    const overlaps = kept.some(
      (k) => a.effort_start_ms < k.effort_end_ms && k.effort_start_ms < a.effort_end_ms
    );
    if (!overlaps) kept.push(a);
  }
  return [...kept, ...rideAwards]
    .sort((a, b) => awardScore(b) - awardScore(a))
    .slice(0, slots);
}

test('overlapping segments collapse to one highlight', () => {
  const picked = selectHighlights([ANGLERS, KENDALE_LONG, KENDALE_MID, KENDALE_CLIMB, A_QUARTILE]);
  const kendale = picked.filter((a) => a.segment.toLowerCase().includes('ken'));
  assert.equal(kendale.length, 1, 'one climb, one slot');
});

test('the effort that actually mattered makes the card', () => {
  const picked = selectHighlights([ANGLERS, KENDALE_LONG, KENDALE_MID, KENDALE_CLIMB, A_QUARTILE]);
  assert.ok(picked.some((a) => a.segment === 'Kendale: Bradley - Kentsdale' || a.segment === 'Kendale Climb'));
  assert.ok(picked.length <= 4);
});

test('an all-time top 3 beats a year best on the same card', () => {
  const top3 = { ...KENDALE_CLIMB, type: 'all_time_top3' };
  const picked = selectHighlights([ANGLERS, A_QUARTILE, top3]);
  assert.equal(picked[0].type, 'all_time_top3');
});

test('ride order does not decide ties', () => {
  const early = { ...ANGLERS, effort_start_ms: s(100), effort_end_ms: s(356) };
  const late = { ...KENDALE_CLIMB, effort_start_ms: s(9000), effort_end_ms: s(9068) };
  assert.equal(selectHighlights([early, late])[0].segment, 'Kendale Climb');
  assert.equal(selectHighlights([late, early])[0].segment, 'Kendale Climb');
});

// The per-activity type cap emptied a segment on 2026-08-08 "N ½": "1 Ln Bridge
// to Store", 3rd-fastest of 39 efforts, ranked 6th of 6 all_time_top3 (cap 5)
// and 4th of 4 ytd_best_power (cap 3), so it vanished from the ride entirely.
const STRANDED_TOP3 = {
  type: 'all_time_top3', segment: '1 Ln Bridge to Store', segment_id: 648837,
  time: 557, all_time_rank: 3, effort_count: 39, pr_gap_pct: 13 / 544,
  _isHeadline: true,
};

test('a headline all-time standing is reinstated when the type cap empties its segment', () => {
  assert.equal(isCapReinstatable(STRANDED_TOP3), true);
});

test('a calendar-window headline stays capped', () => {
  for (const type of ['year_best', 'beat_median', 'top_quartile', 'monthly_best']) {
    assert.ok(AWARD_PRIORITY[type] < ALL_TIME_PRIORITY_FLOOR, `${type} is not all-time standing`);
    assert.equal(isCapReinstatable({ ...STRANDED_TOP3, type }), false, type);
  }
});

test('only the headline is reinstated, never a second award on the same segment', () => {
  const secondary = { ...STRANDED_TOP3, type: 'ytd_best_power', _isHeadline: false };
  assert.equal(isCapReinstatable(secondary), false);
});

test('the all-time band is exactly the top of the priority table', () => {
  const allTime = Object.entries(AWARD_PRIORITY)
    .filter(([, p]) => p >= ALL_TIME_PRIORITY_FLOOR)
    .map(([t]) => t)
    .sort();
  assert.deepEqual(allTime, ['all_time_top3', 'closing_in', 'comeback_full', 'curve_all_time', 'matched_pr', 'near_kom']);
});
