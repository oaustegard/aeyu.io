import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeDecoupling, computeSustainedBlocks, computeDurability } from '../src/durability.js';

// ─── Builders ─────────────────────────────────────────────

// constant streams of length n
const flat = (n, val) => new Array(n).fill(val);

// ─── computeDecoupling: guards ────────────────────────────

test('computeDecoupling: null inputs return null', () => {
  assert.equal(computeDecoupling(null, null), null);
  assert.equal(computeDecoupling([1], null), null);
});

test('computeDecoupling: too few samples returns null', () => {
  assert.equal(computeDecoupling(flat(100, 200), flat(100, 140)), null);
});

// ─── computeDecoupling: math ──────────────────────────────

test('computeDecoupling: perfectly steady ride has ~0% decoupling', () => {
  const r = computeDecoupling(flat(1200, 200), flat(1200, 140));
  assert.ok(r);
  assert.equal(r.decouplingPct, 0);
  assert.equal(r.firstHalfEf, 1.43); // 200/140
  assert.equal(r.secondHalfEf, 1.43);
});

test('computeDecoupling: HR rising at constant power yields positive decoupling', () => {
  const n = 1200;
  const watts = flat(n, 200);
  const hr = [];
  for (let i = 0; i < n; i++) hr.push(i < n / 2 ? 140 : 150); // +10bpm second half
  const r = computeDecoupling(watts, hr);
  assert.ok(r.decouplingPct > 0, 'positive decoupling expected');
  // EF: 200/140=1.4286 -> 200/150=1.3333 ; drop ~6.7%
  assert.ok(Math.abs(r.decouplingPct - 6.7) < 0.2, `got ${r.decouplingPct}`);
});

test('computeDecoupling: matched-power block reports HR cost when enough samples', () => {
  const n = 1200;
  const watts = flat(n, 200); // all in the ±20% band around avg 200
  const hr = [];
  for (let i = 0; i < n; i++) hr.push(i < n / 2 ? 140 : 144);
  const r = computeDecoupling(watts, hr);
  assert.ok(r.matched, 'matched block expected');
  assert.equal(r.matched.hrFirst, 140);
  assert.equal(r.matched.hrSecond, 144);
  assert.ok(r.matched.nFirst >= 30 && r.matched.nSecond >= 30);
});

test('computeDecoupling: matched is null when power too variable to populate band', () => {
  const n = 1200;
  // alternate far-low / far-high so almost nothing sits in the ±20% band
  const watts = [];
  for (let i = 0; i < n; i++) watts.push(i % 2 ? 20 : 400);
  const hr = flat(n, 140);
  const r = computeDecoupling(watts, hr);
  assert.ok(r); // EF split still computes
  assert.equal(r.matched, null);
});

// ─── computeSustainedBlocks ───────────────────────────────

test('computeSustainedBlocks: guards', () => {
  assert.equal(computeSustainedBlocks(null, [140]), null);
  assert.equal(computeSustainedBlocks([140], null), null);
  assert.equal(computeSustainedBlocks([], [140]), null);
});

test('computeSustainedBlocks: longest unbroken run vs cumulative', () => {
  // 140 for 5, drop, 140 for 3  -> longest 5, total 8 at >=140
  const hr = [140,140,140,140,140, 100, 140,140,140];
  const r = computeSustainedBlocks(hr, [140]);
  assert.equal(r.byThreshold[0].longestSec, 5);
  assert.equal(r.byThreshold[0].totalSec, 8);
});

test('computeSustainedBlocks: monotone thresholds, higher floor = shorter blocks', () => {
  const hr = [130,145,155,155,145,130];
  const r = computeSustainedBlocks(hr, [150, 140, 120]); // unsorted input
  const t = Object.fromEntries(r.byThreshold.map(b => [b.threshold, b]));
  assert.equal(t[120].totalSec, 6);
  assert.equal(t[140].totalSec, 4);
  assert.equal(t[150].longestSec, 2);
  // returned ascending
  assert.deepEqual(r.byThreshold.map(b => b.threshold), [120, 140, 150]);
});

test('computeSustainedBlocks: nulls in stream break runs', () => {
  const hr = [140,140,null,140,140,140];
  const r = computeSustainedBlocks(hr, [140]);
  assert.equal(r.byThreshold[0].longestSec, 3);
  assert.equal(r.byThreshold[0].totalSec, 5);
});

// ─── computeDurability: composition ───────────────────────

test('computeDurability: combines both, null when neither computable', () => {
  const r = computeDurability(flat(1200, 200), flat(1200, 140), [120, 140]);
  assert.ok(r.decoupling);
  assert.ok(r.blocks);
  assert.equal(computeDurability(flat(50, 200), flat(50, 140), null), null);
});

test('computeDurability: blocks only when no thresholds but HR present is null-safe', () => {
  const r = computeDurability(flat(1200, 200), flat(1200, 140), null);
  assert.ok(r.decoupling);
  assert.equal(r.blocks, null);
});
