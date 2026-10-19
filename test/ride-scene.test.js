import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRideScene, sampleAt, pointAtDistance, packRibbon, RIBBON_FLOATS, buildGhostRace, standings, makeCamera, sideOnYaw, crowdDensity } from '../src/ride-scene.js';

// 101 points due east, 10 m apart, 2 s apart, climbing 1 m per point
const streams = (overrides = {}) => ({
  id: 1,
  latlng: Array.from({ length: 101 }, (_, i) => [40, -74 + (i * 10) / (111320 * Math.cos((40 * Math.PI) / 180))]),
  time: Array.from({ length: 101 }, (_, i) => i * 2),
  distance: Array.from({ length: 101 }, (_, i) => i * 10),
  altitude: Array.from({ length: 101 }, (_, i) => 100 + i),
  velocity_smooth: Array.from({ length: 101 }, () => 5),
  watts: Array.from({ length: 101 }, (_, i) => (i < 50 ? 100 : 300)),
  grade_smooth: Array.from({ length: 101 }, () => 10),
  ...overrides,
});
const activity = {
  start_date: '2026-03-14T10:00:00Z',
  segment_efforts: [{ id: 7, segment: { id: 70, name: 'Hill' }, start_date: '2026-03-14T10:01:00Z', elapsed_time: 60 }],
};

test('projects to metres along the route', () => {
  const s = buildRideScene(streams(), activity);
  assert.ok(Math.abs(s.x[100] - s.x[0] - 1000) < 1);
  assert.ok(Math.abs(s.y[100] - s.y[0]) < 1);
  assert.equal(s.distance, 1000);
  assert.equal(s.duration, 200);
});

test('places efforts on the stream clock from their start time', () => {
  const s = buildRideScene(streams(), activity);
  assert.deepEqual([s.efforts[0].tA, s.efforts[0].tB], [60, 120]);
});

test('award colour marks only the effort stretch of the ribbon', () => {
  const s = buildRideScene(streams(), activity, new Map([[70, [{ type: 'year_best' }]]]), { year_best: '#ff0000' });
  const r = packRibbon(s);
  const rgbAt = (k) => [...r.slice(k * RIBBON_FLOATS + 10, k * RIBBON_FLOATS + 13)];
  assert.deepEqual(rgbAt(35), [1, 0, 0]);
  assert.notDeepEqual(rgbAt(10), [1, 0, 0]);
});

test('ribbon width follows smoothed power', () => {
  const s = buildRideScene(streams(), activity);
  const r = packRibbon(s);
  assert.ok(r[90 * RIBBON_FLOATS + 8] > r[10 * RIBBON_FLOATS + 8]);
});

test('constant width without a power meter', () => {
  const s = buildRideScene(streams({ watts: null }), activity);
  assert.equal(s.hasPower, false);
  const r = packRibbon(s);
  assert.equal(r[8], r[50 * RIBBON_FLOATS + 8]);
});

test('no GPS means no scene', () => {
  assert.equal(buildRideScene({ id: 1, latlng: null, time: null }, activity), null);
});

test('samples interpolate between stream points', () => {
  const s = buildRideScene(streams(), activity);
  assert.equal(sampleAt(s, 3).d, 15);
  assert.equal(pointAtDistance(s, 505).t, 101);
});

test('ghosts pace by elapsed time and finish in order', () => {
  const s = buildRideScene(streams(), activity);
  const history = [
    { effort_id: 7, elapsed_time: 60, start_date: '2026-03-14' },
    { effort_id: 8, elapsed_time: 40, start_date: '2025-01-01' },
    { effort_id: 9, elapsed_time: 90, start_date: '2024-01-01' },
  ];
  const race = buildGhostRace(s, s.efforts[0], history);
  assert.equal(race.dB - race.dA, 300);
  const fast = race.ghosts.find((g) => g.effort_id === 8);
  assert.ok(fast.isBest);
  assert.equal(race.progress(fast, 20), 150);
  const order = standings(race, 200).map((x) => x.g.effort_id);
  assert.deepEqual(order, [8, 7, 9]);
});

test('camera frames the scene inside the viewport', () => {
  const s = buildRideScene(streams(), activity);
  const cam = makeCamera(s.bounds, 800, 600, { yaw: sideOnYaw(s), pitch: 0.9 });
  for (const k of [0, 50, 100]) {
    const [px, py, w] = cam.project(s.x[k], s.y[k], s.z[k]);
    assert.ok(w > 0 && px >= 0 && px <= 800 && py >= 0 && py <= 600, `point ${k} at ${px},${py}`);
  }
});

test('colours only the best few non-overlapping award efforts', () => {
  const efforts = Array.from({ length: 12 }, (_, i) => ({
    id: 100 + i, segment: { id: 200 + i, name: `S${i}` },
    start_date: new Date(Date.parse('2026-03-14T10:00:00Z') + (i % 6) * 30000).toISOString(),
    elapsed_time: 20,
  }));
  const awards = new Map(efforts.map((e, i) => [e.segment.id, [{ type: 'year_best', score: i }]]));
  const s = buildRideScene(streams(), { ...activity, segment_efforts: efforts }, awards, { year_best: '#ff0000' }, (a) => a.score);
  const lit = s.efforts.filter((e) => e.color);
  assert.ok(lit.length <= 5);
  for (const a of lit) for (const b of lit) if (a !== b) assert.ok(a.tB <= b.tA || b.tB <= a.tA);
  assert.ok(lit.some((e) => e.effort_id === 111), 'highest score kept');
});

test('marks today, best, P25 and median; everyone else is glow only', () => {
  const s = buildRideScene(streams(), activity);
  const history = Array.from({ length: 20 }, (_, i) => ({ effort_id: 100 + i, elapsed_time: 40 + i * 3, start_date: '2025-01-01' }));
  history.push({ effort_id: 7, elapsed_time: 60, start_date: '2026-03-14' });
  const race = buildGhostRace(s, s.efforts[0], history);
  assert.equal(race.ghosts.length, 21);
  const marked = race.ghosts.filter((g) => g.marked);
  assert.equal(marked.length, 4);
  assert.equal(marked.find((g) => g.isBest).elapsed, 40);
  assert.equal(marked.find((g) => g.isP25).elapsed, 55);
  assert.equal(marked.find((g) => g.isMedian).elapsed, 67);
});

test('crowd glow peaks where the ghosts are and empties as they finish', () => {
  const s = buildRideScene(streams(), activity);
  const history = Array.from({ length: 10 }, (_, i) => ({ effort_id: 100 + i, elapsed_time: 50 + i, start_date: '2025-01-01' }));
  const race = buildGhostRace(s, s.efforts[0], history);
  const mid = crowdDensity(race, 30);
  const peak = mid.d[mid.a.indexOf(Math.max(...mid.a))];
  const positions = race.ghosts.map((g) => race.progress(g, 30));
  assert.ok(peak >= Math.min(...positions) - 20 && peak <= Math.max(...positions) + 20);
  assert.ok(mid.a[0] < Math.max(...mid.a) / 4, 'start of segment is dim once the field has moved on');
  assert.equal(crowdDensity(race, 1000).riding, 0);
});

test('a slow outlier does not stretch the race clock', () => {
  const s = buildRideScene(streams(), activity);
  const history = Array.from({ length: 19 }, (_, i) => ({ effort_id: 100 + i, elapsed_time: 50 + i, start_date: '2025-01-01' }));
  history.push({ effort_id: 999, elapsed_time: 1800, start_date: '2025-02-01' });
  const race = buildGhostRace(s, s.efforts[0], history);
  assert.ok(race.longest < 100);
});
