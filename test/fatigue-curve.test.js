import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DURATIONS, KJ_BINS, NONE, MAX_DURATION,
  packRides, computeTableCPU, reduceCurves, fitBin,
} from '../src/fatigue-curve.js';
import { CP_FIT_DURATIONS } from '../src/critical-power.js';

function rng(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function randomRide(r, n) {
  const w = new Uint16Array(n);
  for (let i = 0; i < n; i++) w[i] = r() < 0.1 ? 0 : Math.floor(100 + 400 * r() * r());
  return { watts: w };
}

function bruteForce(ride, start, d) {
  const w = ride.watts;
  let best = 0;
  for (let i = start; i + d <= w.length; i++) {
    let s = 0;
    for (let j = i; j < i + d; j++) s += w[j];
    if (s > best) best = s;
  }
  return best;
}

test('duration grid: 1 s to 5 h, sorted, every second under a minute, CP fit durations present', () => {
  assert.equal(DURATIONS[0], 1);
  assert.equal(DURATIONS[DURATIONS.length - 1], MAX_DURATION);
  for (let d = 1; d <= 60; d++) assert.equal(DURATIONS[d - 1], d);
  for (let i = 1; i < DURATIONS.length; i++) assert.ok(DURATIONS[i] > DURATIONS[i - 1]);
  for (const d of CP_FIT_DURATIONS) assert.ok(DURATIONS.includes(d), `missing ${d}`);
  assert.ok(DURATIONS.length < 300, `grid has ${DURATIONS.length} durations`);
});

test('packRides: starts mark the first second after each kJ threshold', () => {
  const ride = { watts: new Uint16Array(3000).fill(500) }; // 1.5 MJ total, 500 J/s
  const p = packRides([ride], [0, 1000, 2000]);
  assert.equal(p.starts[0], 0);
  assert.equal(p.starts[1], 2000); // 2000 s × 500 W = 1,000 kJ done before second 2000
  assert.equal(p.starts[2], NONE);
});

test('computeTableCPU matches brute force for every ride, bin and duration', () => {
  const r = rng(7);
  const bins = [0, 100, 250, 600];
  const rides = [randomRide(r, 1200), randomRide(r, 37), randomRide(r, 1), randomRide(r, 2500), randomRide(r, 400)];
  const durs = Uint32Array.from([1, 2, 3, 5, 17, 60, 61, 300, 1199, 1200, 1201, 2500]);
  const p = packRides(rides, bins);
  const t = computeTableCPU(p, durs);
  const D = durs.length, K = bins.length;
  for (let ri = 0; ri < rides.length; ri++) {
    for (let k = 0; k < K; k++) {
      const s = p.starts[ri * K + k];
      for (let di = 0; di < D; di++) {
        const expect = s === NONE ? 0 : bruteForce(rides[ri], s, durs[di]);
        assert.equal(t[(ri * K + k) * D + di], expect, `ride ${ri} bin ${k} d ${durs[di]}`);
      }
    }
  }
});

test('computeTableCPU: a ride range fills only its rides', () => {
  const r = rng(3);
  const rides = [randomRide(r, 500), randomRide(r, 800), randomRide(r, 300)];
  const p = packRides(rides, [0, 50]);
  const durs = Uint32Array.from([1, 30, 299]);
  const full = computeTableCPU(p, durs);
  const parts = new Uint32Array(full.length);
  computeTableCPU(p, durs, 0, 1, parts);
  computeTableCPU(p, durs, 1, 3, parts);
  assert.deepEqual(parts, full);
});

// Mean-max power is not monotone in duration in general ([10, 0, 10]: the
// 3 s best beats the 2 s best), so only the nesting of bins is an invariant
test('each bin sits under the one before', () => {
  const r = rng(11);
  const rides = Array.from({ length: 6 }, () => randomRide(r, 9000 + Math.floor(r() * 9000)));
  const p = packRides(rides);
  const t = computeTableCPU(p);
  const bins = reduceCurves(t, p);
  assert.equal(bins.length, KJ_BINS.length);
  for (let k = 1; k < bins.length; k++) {
    for (let di = 0; di < DURATIONS.length; di++) {
      assert.ok(bins[k].watts[di] <= bins[k - 1].watts[di] + 1e-9);
    }
  }
});

test('reduceCurves: the include mask restricts rides and ride[] points at the winner', () => {
  const easy = { watts: new Uint16Array(600).fill(150) };
  const hard = { watts: new Uint16Array(600).fill(300) };
  const p = packRides([easy, hard], [0]);
  const durs = Uint32Array.from([1, 600, 601]);
  const t = computeTableCPU(p, durs);
  const all = reduceCurves(t, p, null, durs)[0];
  assert.deepEqual(Array.from(all.watts), [300, 300, 0]);
  assert.deepEqual(Array.from(all.ride), [1, 1, -1]);
  const onlyEasy = reduceCurves(t, p, Uint8Array.from([1, 0]), durs)[0];
  assert.deepEqual(Array.from(onlyEasy.watts), [150, 150, 0]);
  assert.deepEqual(Array.from(onlyEasy.ride), [0, 0, -1]);
});

test('fitBin recovers CP and W′ from a ride shaped like the model', () => {
  // One ride containing, for each fit duration, an all-out effort at CP + W′/t
  const cp = 260, wp = 18000;
  const parts = [];
  for (const d of CP_FIT_DURATIONS) {
    parts.push(new Array(d).fill(Math.round(cp + wp / d)), new Array(600).fill(0));
  }
  const ride = { watts: Uint16Array.from(parts.flat()) };
  const p = packRides([ride], [0]);
  const t = computeTableCPU(p);
  const fit = fitBin(reduceCurves(t, p)[0]);
  assert.ok(Math.abs(fit.cp - cp) <= 2, `cp ${fit.cp}`);
  assert.ok(Math.abs(fit.wPrime - wp) <= 600, `W′ ${fit.wPrime}`);
});
