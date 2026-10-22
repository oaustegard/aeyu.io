import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wbalSeries, maxDeficit, pickFitRides, fitWbal } from '../src/wbal.js';
import { packRides, computeTableCPU, reduceCurves, fitBin, DURATIONS } from '../src/fatigue-curve.js';

const block = (p, s) => new Array(s).fill(p);
const ride = (...parts) => Uint16Array.from(parts.flat());

test('wbalSeries: drains linearly above CP, recovers exponentially below', () => {
  const cp = 250, wp = 20000;
  const b = wbalSeries(ride(block(350, 100), block(150, 200)), cp, wp);
  assert.equal(b[99], wp - 100 * 100);
  const deficit = 100 * 100 * Math.exp(-(100 / wp) * 200);
  assert.ok(Math.abs(b[299] - (wp - deficit)) < 1);
  assert.equal(wbalSeries(ride(block(200, 50)), cp, wp)[49], wp);
});

test('maxDeficit: finds the deepest point and when', () => {
  const r = ride(block(100, 60), block(400, 120), block(100, 300), block(400, 60));
  const { max, at } = maxDeficit(r, 300, 20000);
  assert.equal(max, 120 * 100);
  assert.equal(at, 179);
});

// A model athlete: every hard effort is sized from the W′ actually left at its
// start, so each ride ends its last effort on empty under the true CP and W′
function athleteRide(cp, wp, efforts, gap, easy = 0.55) {
  const parts = [block(Math.round(cp * easy), 900)];
  let deficit = 0;
  efforts.forEach((p, i) => {
    const left = wp - deficit;
    const s = Math.floor(left / (p - cp));
    parts.push(block(p, s));
    deficit += s * (p - cp);
    if (i < efforts.length - 1) {
      parts.push(block(Math.round(cp * easy), gap));
      deficit *= Math.exp(-(cp - Math.round(cp * easy)) * gap / wp);
    }
  });
  parts.push(block(Math.round(cp * easy), 1200));
  return ride(...parts);
}

test('fitWbal recovers CP and W′ from repeated efforts the MMP fit misreads', () => {
  const cp = 270, wp = 22000;
  const rides = [
    athleteRide(cp, wp, [380], 0),
    athleteRide(cp, wp, [330], 0),
    athleteRide(cp, wp, [300], 0),
    athleteRide(cp, wp, [420, 360, 330], 240),
    athleteRide(cp, wp, [350, 350, 350, 350], 300),
    ride(block(200, 3600)),
  ];
  const fit = fitWbal(rides, 260);
  assert.ok(Math.abs(fit.cp - cp) <= 3, `cp ${fit.cp}`);
  assert.ok(Math.abs(fit.wPrime - wp) <= 1500, `W′ ${fit.wPrime}`);
  for (const r of fit.perRide.slice(0, 5)) assert.ok(r.minBalance > -0.05 * wp, `overdrawn ${r.minBalance}`);
  assert.equal(fit.perRide.length, rides.length);
  const mmp = fitBin(reduceCurves(computeTableCPU(packRides(rides.map((watts) => ({ watts })))), packRides(rides.map((watts) => ({ watts }))))[0]);
  assert.ok(Math.abs(mmp.cp - cp) + Math.abs(mmp.wPrime - wp) / 100 > Math.abs(fit.cp - cp) + Math.abs(fit.wPrime - wp) / 100,
    `MMP fit ${mmp.cp} W / ${mmp.wPrime} J should be further off than ${fit.cp} / ${fit.wPrime}`);
});

test('fitWbal: too few rides or no seed gives null', () => {
  assert.equal(fitWbal([ride(block(300, 600))], 250), null);
  assert.equal(fitWbal([ride(block(300, 600)), ride(block(300, 600))], null), null);
});

test('pickFitRides: top rides per CP fit duration, respecting the mask', () => {
  const flat = (p, s) => ({ watts: Uint16Array.from(block(p, s)) });
  const rides = [flat(200, 2000), flat(300, 2000), flat(250, 2000), flat(220, 2000), flat(400, 100)];
  const p = packRides(rides, [0]);
  const t = computeTableCPU(p);
  assert.deepEqual(pickFitRides(t, p, DURATIONS).sort(), [1, 2, 3]);
  assert.deepEqual(pickFitRides(t, p, DURATIONS, Uint8Array.from([1, 0, 1, 1, 1])).sort(), [0, 2, 3]);
  assert.deepEqual(pickFitRides(t, p, DURATIONS, null, 1), [1]);
});
