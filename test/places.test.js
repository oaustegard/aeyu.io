import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tilesForTracks, placesNearTracks, placeCounts, layoutLabels, unproject } from '../src/places.js';
import { buildHeatmapData, encodePolyline } from '../src/heatmap.js';

const ride = (id, pts, overrides = {}) => ({
  id, sport_type: 'Ride', start_date_local: '2025-06-01T08:00:00', average_speed: 8, gear_id: 'b1',
  summary_polyline: encodePolyline(pts), ...overrides,
});
const all = (d) => ({ dayMin: -1e9, dayMax: 1e9, speedMin: 0, speedMax: Infinity, typeMask: 0xffffffff, gearMask: 0xffffffff });

test('unproject inverts the heatmap projection', () => {
  const d = buildHeatmapData([ride(1, [[38.98, -77.1], [39.02, -77.2]])]);
  const [lat, lng] = unproject(d.meta[0].bbox[0] + d.origin[0], d.meta[0].bbox[3] + d.origin[1]);
  assert.ok(Math.abs(lat - 38.98) < 1e-4 && Math.abs(lng + 77.2) < 1e-4);
});

test('picks the 10° tiles the tracks touch, including across a boundary', () => {
  const d = buildHeatmapData([ride(1, [[38.98, -77.1], [39.02, -77.2]]), ride(2, [[59.9, 10.7], [60.1, 10.8]])]);
  assert.deepEqual(tilesForTracks(d.meta, d.origin).sort(), ['30_-80', '50_10', '60_10']);
});

test('keeps only places near a ride, with the rides that pass them', () => {
  const d = buildHeatmapData([ride(1, [[38.98, -77.10], [39.02, -77.20]]), ride(2, [[39.08, -77.15], [39.09, -77.16]], { start_date_local: '2024-01-01T08:00:00' })]);
  const rows = [['Bethesda', 38.9807, -77.1003, 60858], ['Rockville', 39.084, -77.1528, 66980], ['Baltimore', 39.29, -76.61, 600000]];
  const places = placesNearTracks(rows, d.meta, d.origin);
  assert.deepEqual(places.map((p) => p.name), ['Bethesda', 'Rockville']);
  assert.deepEqual(placeCounts(places, d.meta, all(d)), [1, 1]);
  const day2025 = d.meta[0].day;
  assert.deepEqual(placeCounts(places, d.meta, { ...all(d), dayMin: day2025 }), [1, 0]);
  assert.deepEqual(placeCounts(places, d.meta, all(d), day2025 - 1), [0, 1], 'playback hides towns not yet ridden');
});

test('labels never overlap and the most-ridden place wins a clash', () => {
  const places = [
    { name: 'Smallville', x: 0, y: 0, pop: 5000 },
    { name: 'Busytown', x: 0.0000001, y: 0, pop: 5000 },
    { name: 'Far', x: 0.01, y: 0, pop: 5000 },
  ];
  const view = { cx: 0.005, cy: 0, scale: 50000 };
  const out = layoutLabels(places, [1, 9, 1], view, 1000, 400, (s) => [s.length * 7, 11]);
  assert.deepEqual(out.map((l) => l.p.name).sort(), ['Busytown', 'Far']);
});

test('labels stay out of reserved panel areas', () => {
  const places = [{ name: 'Under', x: 0, y: 0, pop: 5000 }];
  const view = { cx: 0, cy: 0, scale: 1 };
  assert.equal(layoutLabels(places, [3], view, 400, 400, () => [40, 11]).length, 1);
  assert.equal(layoutLabels(places, [3], view, 400, 400, () => [40, 11], { reserved: [[150, 150, 300, 260]] }).length, 0);
});
