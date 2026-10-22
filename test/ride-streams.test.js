import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  encodeRideStreams, decodeRideStreams, wattsPerSecond, recordBytes, sampleTimes, MAX_HOLD_SECONDS,
} from '../src/ride-streams.js';

const raw = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { data: v }]));

test('encode → decode round-trips within storage resolution', () => {
  const s = {
    time: [0, 1, 2, 5],
    watts: [250, null, 1800, 0],
    heartrate: [120, 121, 300, 140],
    cadence: [90, 91, 0, 85],
    velocity_smooth: [8.123, 8.2, 9.99, 0],
    altitude: [-12.34, 0, 2250.55, 2250.5],
  };
  const rec = encodeRideStreams(42, raw(s));
  assert.equal(rec.id, 42);
  assert.equal(rec.n, 4);
  assert.ok(rec.watts instanceof Uint16Array);
  assert.deepEqual(Array.from(rec.time_jumps), [0, 0, 3, 5]);
  const d = decodeRideStreams(rec);
  assert.deepEqual(d.time, s.time);
  assert.deepEqual(d.watts, [250, 0, 1800, 0]);
  assert.deepEqual(d.heartrate, [120, 121, 255, 140]); // clamped to Uint8
  assert.deepEqual(d.cadence, s.cadence);
  d.velocity_smooth.forEach((v, i) => assert.ok(Math.abs(v - s.velocity_smooth[i]) <= 0.005));
  d.altitude.forEach((v, i) => assert.ok(Math.abs(v - s.altitude[i]) <= 0.05, `${v} vs ${s.altitude[i]}`));
  assert.equal(recordBytes(rec), 4 * 4 + 4 * 2 + 4 + 4 + 4 * 2 + 4 * 2);
})

test('time jumps: contiguous clock stores one pair, odd clocks round-trip', () => {
  const one = encodeRideStreams(1, raw({ time: [7, 8, 9, 10] }));
  assert.deepEqual(Array.from(one.time_jumps), [0, 7]);
  for (const time of [[0], [3, 3, 4, 10, 11, 12, 500], [0, 2, 4, 6]]) {
    const rec = encodeRideStreams(1, raw({ time }));
    assert.deepEqual(Array.from(sampleTimes(rec)), time);
  }
});

test('encode: missing streams stay null, no time stream means no record', () => {
  const rec = encodeRideStreams(1, raw({ time: [0, 1], watts: [100, 200] }));
  assert.equal(rec.heartrate, null);
  assert.equal(rec.altitude, null);
  assert.equal(encodeRideStreams(2, raw({ watts: [1, 2] })), null);
  assert.equal(encodeRideStreams(3, {}), null);
});

test('wattsPerSecond: contiguous recording is unchanged', () => {
  const rec = encodeRideStreams(1, raw({ time: [0, 1, 2, 3], watts: [1, 2, 3, 4] }));
  assert.deepEqual(Array.from(wattsPerSecond(rec)), [1, 2, 3, 4]);
});

test('wattsPerSecond: short gaps are back-filled, long gaps are stops at 0 W', () => {
  const rec = encodeRideStreams(1, raw({
    time: [10, 11, 14, 14 + MAX_HOLD_SECONDS + 5, 14 + MAX_HOLD_SECONDS + 6],
    watts: [100, 200, 300, 400, 500],
  }));
  const w = Array.from(wattsPerSecond(rec));
  assert.equal(w.length, MAX_HOLD_SECONDS + 11); // clock starts at the first sample
  assert.deepEqual(w.slice(0, 5), [100, 200, 300, 300, 300]);
  assert.ok(w.slice(5, MAX_HOLD_SECONDS + 9).every((v) => v === 0));
  assert.deepEqual(w.slice(-2), [400, 500]);
});

test('wattsPerSecond: no power stream gives null', () => {
  assert.equal(wattsPerSecond(encodeRideStreams(1, raw({ time: [0, 1] }))), null);
});
