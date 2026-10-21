import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRideScene, makeCamera } from '../src/ride-scene.js';
import { planVideo, zoomWeight, clockAt, VIDEO_FPS, VIDEO_SECONDS } from '../src/ride-video.js';

// 2001 points heading east then north, 10 m apart, 2 s apart, one climb in the middle
const N = 2001;
const kx = 111320 * Math.cos((40 * Math.PI) / 180), ky = 110540;
const streams = {
  id: 1,
  latlng: Array.from({ length: N }, (_, i) => i < 1000
    ? [40, -74 + (i * 10) / kx]
    : [40 + ((i - 1000) * 10) / ky, -74 + (1000 * 10) / kx]),
  time: Array.from({ length: N }, (_, i) => i * 2),
  distance: Array.from({ length: N }, (_, i) => i * 10),
  altitude: Array.from({ length: N }, (_, i) => 100 + 40 * Math.exp(-(((i - 1000) / 150) ** 2))),
  velocity_smooth: Array.from({ length: N }, () => 5),
  watts: Array.from({ length: N }, () => 200),
};
const scene = buildRideScene(streams, { start_date: '2026-03-14T10:00:00Z', segment_efforts: [] });
const plan = planVideo(scene);
const span = (b) => Math.max(b.maxX - b.minX, b.maxY - b.minY);

test('one camera per frame for the full 30 s', () => {
  assert.equal(plan.length, VIDEO_FPS * VIDEO_SECONDS);
});

test('opens and closes on the whole route, zoomed in between', () => {
  assert.equal(zoomWeight(0), 0);
  assert.equal(zoomWeight(1), 0);
  assert.equal(zoomWeight(0.5), 1);
  const full = span(scene.bounds);
  assert.ok(Math.abs(span(plan[0].bounds) - full) < 1e-6 * full);
  assert.ok(Math.abs(span(plan.at(-1).bounds) - full) < 1e-6 * full);
  assert.ok(span(plan[Math.round(plan.length / 2)].bounds) < 0.4 * full, 'mid-ride is a close-up');
});

test('the ride finishes before the pull-back and then holds', () => {
  assert.equal(plan[0].clock, scene.t[0]);
  const done = plan.findIndex((f) => f.clock >= scene.duration);
  assert.ok(done > 0 && done < plan.length * 0.85);
  assert.ok(plan.slice(done).every((f) => f.clock === scene.duration));
  assert.equal(clockAt(scene, 2), scene.duration);
});

test('the chase camera follows the rider', () => {
  for (const u of [0.3, 0.5, 0.7]) {
    const f = plan[Math.round(u * (plan.length - 1))];
    const k = scene.t.findIndex((t) => t >= f.clock);
    const { minX, maxX, minY, maxY } = f.bounds;
    assert.ok(scene.x[k] >= minX && scene.x[k] <= maxX && scene.y[k] >= minY && scene.y[k] <= maxY, `rider in frame at u=${u}`);
  }
});

test('camera framing changes smoothly frame to frame', () => {
  for (let i = 1; i < plan.length; i++) {
    const a = span(plan[i - 1].bounds), b = span(plan[i].bounds);
    assert.ok(Math.abs(Math.log(b / a)) < 0.05, `zoom jump at frame ${i}`);
  }
});

test('relief is stretched only in the close-up, and within limits', () => {
  assert.equal(plan[0].zScale, 1);
  assert.equal(plan.at(-1).zScale, 1);
  for (const f of plan) assert.ok(f.zScale >= 1 && f.zScale <= 2.5);
});

test('makeCamera zScale stretches height around the ground plane', () => {
  const b = { minX: -100, maxX: 100, minY: -100, maxY: 100, minZ: 0, maxZ: 20 };
  const flat = makeCamera(b, 800, 600, { pitch: 1.2 });
  const tall = makeCamera(b, 800, 600, { pitch: 1.2, zScale: 2 });
  assert.deepEqual(tall.project(10, 10, 0).map((v) => v.toFixed(3)), flat.project(10, 10, 0).map((v) => v.toFixed(3)));
  assert.deepEqual(tall.project(10, 10, 5).map((v) => v.toFixed(3)), flat.project(10, 10, 10).map((v) => v.toFixed(3)));
});
