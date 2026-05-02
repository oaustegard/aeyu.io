import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bikeStats, gearAwards } from '../src/gear-stats.js';

// ─── Builders ─────────────────────────────────────────────

const activity = (overrides = {}) => ({
  type: 'Ride',
  gear_id: 'b1',
  moving_time: 3600,            // 1 hour
  distance: 16093.44,           // 10 miles
  total_elevation_gain: 100,
  start_date: '2026-04-01T10:00:00Z',
  start_date_local: '2026-04-01T10:00:00',
  ...overrides,
});

const gear = (overrides = {}) => ({
  id: 'b1',
  name: 'Tarmac SL7',
  brand_name: 'Specialized',
  model_name: 'Tarmac SL7',
  retired: false,
  distance: 0,
  ...overrides,
});

// ─── bikeStats: shape ─────────────────────────────────────

test('bikeStats: empty inputs return empty array', () => {
  assert.deepEqual(bikeStats([], []), []);
  assert.deepEqual(bikeStats(undefined, undefined), []);
});

test('bikeStats: aggregates moving_time and distance per gear', () => {
  const acts = [
    activity({ gear_id: 'b1', moving_time: 3600, distance: 16093.44 }),
    activity({ gear_id: 'b1', moving_time: 1800, distance: 8000 }),
    activity({ gear_id: 'b2', moving_time: 7200, distance: 30000 }),
  ];
  const gears = [gear({ id: 'b1' }), gear({ id: 'b2', name: 'Roubaix' })];
  const stats = bikeStats(acts, gears);
  assert.equal(stats.length, 2);

  const b1 = stats.find(s => s.gear_id === 'b1');
  assert.equal(b1.rides, 2);
  assert.equal(b1.moving_seconds, 5400);
  assert.equal(b1.hours, 1.5);
  assert.ok(Math.abs(b1.distance_meters - 24093.44) < 1e-6,
    `distance ${b1.distance_meters} ≉ 24093.44`);

  const b2 = stats.find(s => s.gear_id === 'b2');
  assert.equal(b2.rides, 1);
  assert.equal(b2.moving_seconds, 7200);
});

test('bikeStats: results sorted by moving_seconds descending', () => {
  const acts = [
    activity({ gear_id: 'b1', moving_time: 1800 }),
    activity({ gear_id: 'b2', moving_time: 7200 }),
    activity({ gear_id: 'b3', moving_time: 3600 }),
  ];
  const gears = [gear({ id: 'b1' }), gear({ id: 'b2' }), gear({ id: 'b3' })];
  const stats = bikeStats(acts, gears);
  assert.deepEqual(stats.map(s => s.gear_id), ['b2', 'b3', 'b1']);
});

test('bikeStats: sums elevation_gain in meters', () => {
  const acts = [
    activity({ total_elevation_gain: 250 }),
    activity({ total_elevation_gain: 175 }),
  ];
  const stats = bikeStats(acts, [gear()]);
  assert.equal(stats[0].elevation_meters, 425);
});

// ─── bikeStats: filtering ─────────────────────────────────

test('bikeStats: filters out non-cycling activities', () => {
  const acts = [
    activity({ type: 'Ride', moving_time: 3600 }),
    activity({ type: 'Run', moving_time: 1800 }),
    activity({ type: 'Swim', moving_time: 1800 }),
    activity({ type: 'Walk', moving_time: 1800 }),
  ];
  const stats = bikeStats(acts, [gear()]);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].rides, 1);
});

test('bikeStats: includes Virtual / EBike / Gravel / MTB rides', () => {
  const acts = [
    activity({ type: 'Ride', gear_id: 'b1' }),
    activity({ type: 'VirtualRide', gear_id: 'b1' }),
    activity({ type: 'EBikeRide', gear_id: 'b1' }),
    activity({ type: 'GravelRide', gear_id: 'b1' }),
    activity({ type: 'MountainBikeRide', gear_id: 'b1' }),
  ];
  const stats = bikeStats(acts, [gear()]);
  assert.equal(stats[0].rides, 5);
});

// ─── bikeStats: unit conversions ──────────────────────────

test('bikeStats: distance converts meters → miles correctly', () => {
  const acts = [activity({ distance: 1609.344 })]; // exactly 1 mile
  const stats = bikeStats(acts, [gear()]);
  assert.ok(Math.abs(stats[0].miles - 1) < 1e-6, `got ${stats[0].miles}`);
});

test('bikeStats: moving_seconds converts to hours correctly', () => {
  const acts = [activity({ moving_time: 5400 })]; // 1.5h
  const stats = bikeStats(acts, [gear()]);
  assert.equal(stats[0].hours, 1.5);
});

// ─── bikeStats: dates ─────────────────────────────────────

test('bikeStats: tracks first_used and last_used across rides', () => {
  const acts = [
    activity({ start_date: '2026-01-15T10:00:00Z', start_date_local: '2026-01-15T10:00:00' }),
    activity({ start_date: '2026-04-01T10:00:00Z', start_date_local: '2026-04-01T10:00:00' }),
    activity({ start_date: '2026-02-20T10:00:00Z', start_date_local: '2026-02-20T10:00:00' }),
  ];
  const stats = bikeStats(acts, [gear()]);
  assert.equal(stats[0].first_used, '2026-01-15T10:00:00');
  assert.equal(stats[0].last_used,  '2026-04-01T10:00:00');
});

// ─── bikeStats: edge cases ────────────────────────────────

test('bikeStats: groups unassigned activities under null gear_id', () => {
  const acts = [
    activity({ gear_id: null }),
    activity({ gear_id: undefined }),
    activity({ gear_id: 'b1' }),
  ];
  const stats = bikeStats(acts, [gear()]);
  const unassigned = stats.find(s => s.gear_id === null);
  assert.ok(unassigned, 'expected an unassigned bucket');
  assert.equal(unassigned.rides, 2);
  assert.equal(unassigned.name, 'Unassigned');
});

test('bikeStats: handles unknown gear_id (not in gears list)', () => {
  const acts = [activity({ gear_id: 'b99' })];
  const stats = bikeStats(acts, []);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].gear_id, 'b99');
  assert.match(stats[0].name, /Unknown gear/);
});

test('bikeStats: handles activities missing optional fields', () => {
  const acts = [{ type: 'Ride', gear_id: 'b1' }]; // no moving_time, distance, elevation
  const stats = bikeStats(acts, [gear()]);
  assert.equal(stats[0].moving_seconds, 0);
  assert.equal(stats[0].distance_meters, 0);
  assert.equal(stats[0].elevation_meters, 0);
  assert.equal(stats[0].rides, 1);
});

test('bikeStats: surfaces gear metadata (brand, model, retired)', () => {
  const acts = [activity({ gear_id: 'b1' })];
  const gears = [gear({ id: 'b1', brand_name: 'Trek', model_name: 'Domane', retired: true })];
  const stats = bikeStats(acts, gears);
  assert.equal(stats[0].brand_name, 'Trek');
  assert.equal(stats[0].model_name, 'Domane');
  assert.equal(stats[0].retired, true);
});

// ─── gearAwards ───────────────────────────────────────────

test('gearAwards: empty input → empty awards', () => {
  assert.deepEqual(gearAwards([]), []);
  assert.deepEqual(gearAwards(undefined), []);
});

test('gearAwards: workhorse → bike with most moving_seconds', () => {
  const stats = [
    { gear_id: 'b1', name: 'A', rides: 10, moving_seconds: 36000, distance_meters: 0, elevation_meters: 0 },
    { gear_id: 'b2', name: 'B', rides: 5,  moving_seconds: 50000, distance_meters: 0, elevation_meters: 0 },
  ];
  const w = gearAwards(stats).find(a => a.type === 'gear_workhorse');
  assert.equal(w.gear_id, 'b2');
  assert.equal(w.value, 50000);
});

test('gearAwards: long_hauler → bike with most distance_meters', () => {
  const stats = [
    { gear_id: 'b1', name: 'A', rides: 1, moving_seconds: 1, distance_meters: 50000, elevation_meters: 0 },
    { gear_id: 'b2', name: 'B', rides: 1, moving_seconds: 1, distance_meters: 30000, elevation_meters: 0 },
  ];
  assert.equal(gearAwards(stats).find(a => a.type === 'gear_long_hauler').gear_id, 'b1');
});

test('gearAwards: daily_driver → bike with most rides', () => {
  const stats = [
    { gear_id: 'b1', name: 'A', rides: 5,  moving_seconds: 1, distance_meters: 1, elevation_meters: 0 },
    { gear_id: 'b2', name: 'B', rides: 12, moving_seconds: 1, distance_meters: 1, elevation_meters: 0 },
  ];
  assert.equal(gearAwards(stats).find(a => a.type === 'gear_daily_driver').gear_id, 'b2');
});

test('gearAwards: climber → bike with most elevation_meters', () => {
  const stats = [
    { gear_id: 'b1', name: 'A', rides: 1, moving_seconds: 1, distance_meters: 1, elevation_meters: 5000 },
    { gear_id: 'b2', name: 'B', rides: 1, moving_seconds: 1, distance_meters: 1, elevation_meters: 9000 },
  ];
  assert.equal(gearAwards(stats).find(a => a.type === 'gear_climber').gear_id, 'b2');
});

test('gearAwards: ties broken alphabetically by name', () => {
  const stats = [
    { gear_id: 'b1', name: 'Zebra', rides: 5, moving_seconds: 1000, distance_meters: 1000, elevation_meters: 100 },
    { gear_id: 'b2', name: 'Apple', rides: 5, moving_seconds: 1000, distance_meters: 1000, elevation_meters: 100 },
  ];
  const awards = gearAwards(stats);
  assert.equal(awards.length, 4);
  for (const a of awards) {
    assert.equal(a.gear_id, 'b2', `${a.type} should pick alphabetical first on tie`);
  }
});

test('gearAwards: skips unassigned bucket (null gear_id)', () => {
  const stats = [
    { gear_id: null, name: 'Unassigned', rides: 100, moving_seconds: 100000, distance_meters: 100000, elevation_meters: 100000 },
    { gear_id: 'b1', name: 'Real', rides: 1, moving_seconds: 60, distance_meters: 1000, elevation_meters: 50 },
  ];
  const awards = gearAwards(stats);
  assert.ok(awards.length > 0);
  for (const a of awards) {
    assert.equal(a.gear_id, 'b1', 'unassigned must never win');
  }
});

test('gearAwards: skips zero-value categories', () => {
  // Bike with zero elevation should not get gear_climber even as sole candidate
  const stats = [
    { gear_id: 'b1', name: 'Flat Bike', rides: 5, moving_seconds: 1000, distance_meters: 5000, elevation_meters: 0 },
  ];
  const awards = gearAwards(stats);
  assert.ok(!awards.find(a => a.type === 'gear_climber'),
    'no climber award when elevation is zero');
  assert.ok(awards.find(a => a.type === 'gear_workhorse'),
    'workhorse still fires');
});

test('gearAwards: single bike sweeps all four awards', () => {
  const stats = [
    { gear_id: 'b1', name: 'Only', rides: 10, moving_seconds: 36000, distance_meters: 50000, elevation_meters: 5000 },
  ];
  const awards = gearAwards(stats);
  assert.equal(awards.length, 4);
  for (const a of awards) assert.equal(a.gear_id, 'b1');
  const types = new Set(awards.map(a => a.type));
  assert.deepEqual(types, new Set([
    'gear_workhorse', 'gear_long_hauler', 'gear_daily_driver', 'gear_climber'
  ]));
});
