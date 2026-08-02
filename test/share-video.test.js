import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FPS, videoDuration, slideAt, drawFrame, pickEncoderConfig }
  from '../src/share-video.js';

const layout = { width: 1088, height: 1600, matte: '#4A5759' };
const deck = (n) => Array.from({ length: n }, (_, i) => ({ slide: i }));

function fakeCtx() {
  const calls = [];
  return {
    calls, fillStyle: '', globalAlpha: 1,
    fillRect: (...a) => calls.push({ op: 'fill', a }),
    drawImage(img) { calls.push({ op: 'draw', img, alpha: this.globalAlpha }); },
  };
}
const drawn = (ctx) => ctx.calls.filter((c) => c.op === 'draw');

test('duration scales with the number of slides', () => {
  assert.ok(videoDuration(4) > videoDuration(3));
  assert.ok(videoDuration(3) > videoDuration(2));
  assert.ok(videoDuration(50) <= 30, 'a pathological deck must not run forever');
});

test('every slide gets screen time', () => {
  const slides = deck(4);
  const seen = new Set();
  const end = videoDuration(slides.length);
  for (let t = 0; t <= end; t += 1 / FPS) seen.add(slideAt(t, slides.length).index);
  assert.deepEqual([...seen].sort((a, b) => a - b), [0, 1, 2, 3]);
});

test('slides advance in order and never go backwards', () => {
  const n = 5, end = videoDuration(n);
  let prev = -1;
  for (let t = 0; t <= end; t += 1 / FPS) {
    const { index } = slideAt(t, n);
    assert.ok(index >= prev, `slide went backwards at t=${t}`);
    prev = index;
  }
});

test('the deck opens on the familiar card and ends on the last page', () => {
  const n = 3;
  assert.equal(slideAt(0, n).index, 0);
  assert.equal(slideAt(videoDuration(n), n).index, n - 1);
});

test('the last slide holds without fading into nothing', () => {
  const n = 3, end = videoDuration(n);
  for (let t = end - 0.5; t <= end; t += 1 / FPS) {
    assert.equal(slideAt(t, n).fade, 0, 'nothing to cross-fade to after the last page');
  }
});

test('consecutive slides cross-fade rather than cutting', () => {
  const n = 3, end = videoDuration(n);
  let sawFade = false;
  for (let t = 0; t <= end; t += 1 / FPS) {
    const { index, next, fade } = slideAt(t, n);
    if (fade > 0) { sawFade = true; assert.equal(next, index + 1); }
    assert.ok(fade >= 0 && fade <= 1);
  }
  assert.ok(sawFade, 'a multi-slide deck must cross-fade somewhere');
});

test('a frame paints matte, then the current slide, then the incoming one', () => {
  const slides = deck(3);
  const ctx = fakeCtx();
  // Find a moment mid-crossfade
  const end = videoDuration(3);
  let t = 0;
  for (let u = 0; u <= end; u += 1 / FPS) if (slideAt(u, 3).fade > 0) { t = u; break; }
  drawFrame(ctx, slides, layout, t);
  assert.equal(ctx.calls[0].op, 'fill');
  const d = drawn(ctx);
  assert.equal(d.length, 2);
  assert.equal(d[0].alpha, 1);
  assert.ok(d[1].alpha > 0 && d[1].alpha < 1);
});

test('outside a crossfade only one slide is drawn', () => {
  const ctx = fakeCtx();
  drawFrame(ctx, deck(3), layout, 0.2);
  assert.equal(drawn(ctx).length, 1);
  assert.equal(drawn(ctx)[0].alpha, 1);
});

test('the frame keeps the card dimensions', () => {
  const ctx = fakeCtx();
  drawFrame(ctx, deck(2), layout, 0);
  assert.deepEqual(ctx.calls[0].a, [0, 0, layout.width, layout.height]);
});

test('the frame rate is slow enough to read but not so slow players choke', () => {
  assert.ok(FPS >= 10 && FPS <= 15);
});

// --- Encoder configuration (#131) ---
// avc1.42001f is Baseline level 3.1 — 3600 macroblocks. Card-sized frames
// exceed it, so the level has to be derived rather than hardcoded.

test('no encoder config is offered when VideoEncoder is absent', async () => {
  assert.equal(typeof VideoEncoder, 'undefined');
  assert.equal(await pickEncoderConfig(1088, 1600), null);
});

test('a card-sized frame exceeds the level that used to be hardcoded', () => {
  const mbs = Math.ceil(1088 / 16) * Math.ceil(1600 / 16);
  assert.equal(mbs, 6800);
  assert.ok(mbs > 3600, 'level 3.1 could never have encoded this');
});
