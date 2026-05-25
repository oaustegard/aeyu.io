import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateCriticalPower,
  timeToExhaustion,
  sustainablePower,
  canFitCP,
  CP_FIT_DURATIONS,
} from '../src/critical-power.js';

const synthCurve = (cp, wPrime, durations = CP_FIT_DURATIONS) => {
  const curve = {};
  for (const t of durations) curve[t] = cp + wPrime / t;
  return curve;
};

test('estimateCriticalPower: exact synthetic data recovers CP and W′', () => {
  const r = estimateCriticalPower(synthCurve(250, 20000));
  assert.equal(r.cp, 250);
  assert.equal(r.wPrime, 20000);
  assert.ok(r.rSquared > 0.999, `R² should ≈ 1, got ${r.rSquared}`);
});

test('estimateCriticalPower: 2-point fit (5min + 20min) exact-recovers', () => {
  const r = estimateCriticalPower(synthCurve(280, 18000, [300, 1200]));
  assert.equal(r.cp, 280);
  assert.equal(r.wPrime, 18000);
  assert.equal(r.rSquared, null, '2-point fit has no R²');
  assert.deepEqual(r.fitDurations, [300, 1200]);
});

test('estimateCriticalPower: ignores out-of-range durations', () => {
  const curve = { 5: 800, 30: 600, 60: 450, ...synthCurve(250, 20000, [300, 1200]), 3600: 200 };
  const r = estimateCriticalPower(curve);
  assert.deepEqual(r.fitDurations, [300, 1200]);
  assert.equal(r.cp, 250);
});

test('estimateCriticalPower: null inputs and edge cases return null', () => {
  assert.equal(estimateCriticalPower(null), null);
  assert.equal(estimateCriticalPower(undefined), null);
  assert.equal(estimateCriticalPower({}), null);
  assert.equal(estimateCriticalPower({ 300: 250 }), null, 'single point');
  assert.equal(estimateCriticalPower({ 5: 800, 30: 600 }), null, 'all below fit range');
  assert.equal(estimateCriticalPower({ 300: 0, 1200: 0 }), null, 'zero watts');
});

test('estimateCriticalPower: rejects degenerate spread', () => {
  const r = estimateCriticalPower({ 300: 300, 360: 290 });
  assert.equal(r, null, 'spread < 300s should fail');
});

test('estimateCriticalPower: noisy realistic curve produces sensible fit', () => {
  const noisy = { 5: 526, 15: 495, 30: 323, 60: 285, 120: 291, 300: 227, 600: 218, 1200: 207, 1800: 198 };
  const r = estimateCriticalPower(noisy);
  assert.ok(r.cp > 100 && r.cp < 250, `CP ${r.cp} should be in plausible range`);
  assert.ok(r.wPrime > 5000 && r.wPrime < 30000, `W′ ${r.wPrime} should be in plausible range`);
  assert.ok(r.rSquared > 0.95, `R² ${r.rSquared} should be high for monotone curve`);
});

test('timeToExhaustion: t = W′ / (P − CP) above CP', () => {
  assert.equal(timeToExhaustion(300, 250, 20000), 400);
  assert.equal(timeToExhaustion(350, 250, 20000), 200);
});

test('timeToExhaustion: returns null at or below CP (sustainable in model)', () => {
  assert.equal(timeToExhaustion(250, 250, 20000), null);
  assert.equal(timeToExhaustion(200, 250, 20000), null);
});

test('sustainablePower: P(t) = CP + W′/t', () => {
  assert.equal(sustainablePower(600, 250, 20000), 250 + 20000 / 600);
  assert.equal(sustainablePower(300, 250, 20000), 250 + 20000 / 300);
});

test('sustainablePower: returns null for invalid inputs', () => {
  assert.equal(sustainablePower(0, 250, 20000), null);
  assert.equal(sustainablePower(-100, 250, 20000), null);
});

test('canFitCP: requires ≥2 in-range durations with ≥300s spread', () => {
  assert.equal(canFitCP(null), false);
  assert.equal(canFitCP({}), false);
  assert.equal(canFitCP({ 300: 250 }), false);
  assert.equal(canFitCP({ 5: 800, 30: 600 }), false);
  assert.equal(canFitCP({ 300: 250, 1200: 230 }), true);
  assert.equal(canFitCP({ 300: 250, 360: 245 }), false, 'spread too small');
});
