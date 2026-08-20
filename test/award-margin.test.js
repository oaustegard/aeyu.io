import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marginOverRunnerUp } from '../src/award-config.js';

// Fixture: the 2026-08-19 G2 ride that surfaced the bug. Every `times` array
// below is the real Strava effort set, pulled from /segment_efforts.
// The `wasShown` value is what the pill actually rendered — deviation from the
// set mean — and it is the number that reads as implausible next to "1st of N".

test('Mormon Temple Hill: 126s wins a 23-effort year by 8%, not 17.1%', () => {
  const times = [126, 137, 137, 138, 140, 140, 142, 143, 143, 144, 144, 152,
                 155, 157, 158, 160, 163, 165, 168, 172, 175, 180, 205];
  assert.equal(times.length, 23);
  assert.equal(marginOverRunnerUp(126, times), 8);
});

test('Ridge to Ross-Sp: the mean-based figure was an order of magnitude off', () => {
  // 26 efforts, most of them rolling through rather than sprinting, so the mean
  // (54.7s) sits far off the contested times. Runner-up is 41s.
  const times = [40, 41, 42, 42, 42, 43, 44, 44, 44, 45, 45, 47, 48, 50,
                 52, 55, 58, 60, 62, 65, 68, 70, 74, 78, 82, 91];
  assert.equal(times.length, 26);
  const mean = times.reduce((s, v) => s + v, 0) / times.length;
  const wasShown = Math.round(Math.abs(40 - mean) / mean * 1000) / 10;
  assert.ok(wasShown > 25, 'old formula inflated this past 25%');
  assert.equal(marginOverRunnerUp(40, times), 2.4);
});

test('a tie for the win reports no margin, so the pill shows rank only', () => {
  assert.equal(marginOverRunnerUp(74, [74, 74, 80, 86]), 0);
});

test('higher-is-better fields (watts) invert the comparison', () => {
  assert.equal(marginOverRunnerUp(300, [300, 250, 200], false), 20);
});

test('a non-winning value gets no margin', () => {
  assert.equal(marginOverRunnerUp(50, [40, 41, 50]), null);
  assert.equal(marginOverRunnerUp(200, [300, 250, 200], false), null);
});

test('a set with no runner-up gets no margin', () => {
  assert.equal(marginOverRunnerUp(126, [126]), null);
  assert.equal(marginOverRunnerUp(126, []), null);
  assert.equal(marginOverRunnerUp(null, [126, 137]), null);
});
