import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePolyline, encodePolyline, buildHeatmapData, matchesFilter, fitBounds, NO_GEAR } from '../src/heatmap.js';

const ride = (overrides = {}) => ({
  id: 1,
  sport_type: 'Ride',
  start_date_local: '2025-06-01T08:00:00',
  average_speed: 8,
  gear_id: 'b1',
  summary_polyline: encodePolyline([[40.75, -73.98], [40.76, -73.97], [40.77, -73.99]]),
  ...overrides,
});

const allPass = (d) => ({
  dayMin: d.dayRange[0], dayMax: d.dayRange[1],
  speedMin: 0, speedMax: Infinity, typeMask: 0xffffffff, gearMask: 0xffffffff,
});

test('decodes the reference polyline from Google\'s spec', () => {
  assert.deepEqual(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [
    [38.5, -120.2], [40.7, -120.95], [43.252, -126.453],
  ]);
});

test('encode/decode round-trips at 1e-5 precision', () => {
  const pts = [[59.91, 10.75], [59.9123, 10.7489], [-33.8688, 151.2093]];
  assert.deepEqual(decodePolyline(encodePolyline(pts)), pts);
});

test('one segment per consecutive point pair, tagged with its activity', () => {
  const d = buildHeatmapData([ride({ id: 1 }), ride({ id: 2 })]);
  assert.equal(d.segCount, 4);
  const u = new Uint32Array(d.segments);
  assert.deepEqual([u[4], u[9], u[14], u[19]], [0, 0, 1, 1]);
});

test('skips activities without a track', () => {
  const d = buildHeatmapData([ride(), ride({ id: 2, summary_polyline: null }), ride({ id: 3, summary_polyline: undefined })]);
  assert.equal(d.meta.length, 1);
});

test('missing gear gets its own slot', () => {
  const d = buildHeatmapData([ride({ gear_id: 'b1' }), ride({ id: 2, gear_id: null })]);
  assert.ok(d.gears.includes(NO_GEAR));
});

test('filters on date, speed, type and gear', () => {
  const d = buildHeatmapData([
    ride({ id: 1 }),
    ride({ id: 2, start_date_local: '2024-03-01T08:00:00', average_speed: 5, sport_type: 'GravelRide', gear_id: 'b2' }),
  ]);
  const f = allPass(d);
  const [a, b] = d.meta;
  assert.ok(matchesFilter(a, f) && matchesFilter(b, f));
  assert.ok(!matchesFilter(b, { ...f, dayMin: a.day }));
  assert.ok(!matchesFilter(b, { ...f, speedMin: 6 }));
  assert.ok(!matchesFilter(b, { ...f, typeMask: ~(1 << b.typeSlot) >>> 0 }));
  assert.ok(!matchesFilter(b, { ...f, gearMask: ~(1 << b.gearSlot) >>> 0 }));
  assert.ok(matchesFilter(a, { ...f, gearMask: ~(1 << b.gearSlot) >>> 0 }));
});

test('fit ignores a lone far-away trip', () => {
  const home = Array.from({ length: 30 }, (_, i) => ride({ id: i }));
  const trip = ride({ id: 99, summary_polyline: encodePolyline([[-33.86, 151.2], [-33.87, 151.21]]) });
  const d = buildHeatmapData([...home, trip]);
  const b = fitBounds(d.meta, allPass(d));
  assert.ok(b[2] - b[0] < 0.001, 'bounds should stay around home');
});

test('fit returns null when nothing matches', () => {
  const d = buildHeatmapData([ride()]);
  assert.equal(fitBounds(d.meta, { ...allPass(d), speedMin: 100 }), null);
});
