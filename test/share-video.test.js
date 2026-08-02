import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FPS, VIEW_H, VIEW_W, videoDuration, maxScroll, scrollAt, drawFrame, pickEncoderConfig }
  from '../src/share-video.js';

// A card with every award shown rather than the still card's four — the whole
// reason the video exists. Roughly what a 12-award ride produces.
const TALL = { width: VIEW_W, height: 4200 };
const SHORT = { width: VIEW_W, height: 1200 };
const layoutFor = (card) => ({ ...card, viewW: VIEW_W, viewH: VIEW_H, matte: '#4A5759' });

function fakeCtx() {
  const calls = [];
  return {
    calls, fillStyle: '',
    fillRect: (...a) => calls.push({ op: 'fill', a }),
    drawImage: (...a) => calls.push({ op: 'draw', a }),
  };
}
const lastDraw = (ctx) => ctx.calls.filter((c) => c.op === 'draw').at(-1);

test('a card taller than the viewport scrolls the whole way', () => {
  assert.equal(maxScroll(TALL.height), TALL.height - VIEW_H);
  assert.equal(scrollAt(0, TALL.height), 0);
  const end = videoDuration(TALL.height);
  assert.ok(Math.abs(scrollAt(end, TALL.height) - maxScroll(TALL.height)) < 1e-6,
    'the last frame must show the bottom of the card');
});

test('a card shorter than the viewport does not scroll', () => {
  assert.equal(maxScroll(SHORT.height), 0);
  assert.equal(scrollAt(2, SHORT.height), 0);
  assert.equal(videoDuration(SHORT.height), 3);
});

test('duration grows with the number of awards but stays bounded', () => {
  assert.ok(videoDuration(4200) > videoDuration(2400));
  assert.ok(videoDuration(2400) > videoDuration(1200));
  assert.ok(videoDuration(40000) <= 30, 'a pathological card must not run forever');
});

test('scroll holds at the top before moving', () => {
  assert.equal(scrollAt(0.5, TALL.height), 0, 'still holding at 0.5s');
  assert.ok(scrollAt(1.6, TALL.height) > 0, 'moving by 1.6s');
});

test('scroll is monotonic — never jumps backwards', () => {
  const end = videoDuration(TALL.height);
  let prev = -1;
  for (let t = 0; t <= end; t += 1 / FPS) {
    const y = scrollAt(t, TALL.height);
    assert.ok(y >= prev - 1e-9, `went backwards at t=${t}`);
    prev = y;
  }
});

test('the frame is a fixed 9:16 viewport whatever the card height', () => {
  assert.equal(VIEW_W / VIEW_H, 1080 / 1920);
  for (const card of [SHORT, TALL, { width: VIEW_W, height: 12000 }]) {
    const ctx = fakeCtx();
    drawFrame(ctx, {}, layoutFor(card), 1);
    const fill = ctx.calls.find((c) => c.op === 'fill');
    assert.deepEqual(fill.a, [0, 0, VIEW_W, VIEW_H]);
  }
});

test('a short card is centred, not pinned to the top', () => {
  const ctx = fakeCtx();
  drawFrame(ctx, {}, layoutFor(SHORT), 1);
  assert.equal(lastDraw(ctx).a[2], (VIEW_H - SHORT.height) / 2);
});

test('a tall card is drawn at the current scroll offset', () => {
  const ctx = fakeCtx();
  drawFrame(ctx, {}, layoutFor(TALL), 2.5);
  assert.equal(lastDraw(ctx).a[2], -scrollAt(2.5, TALL.height));
});

test('the matte is painted before the card so short cards letterbox', () => {
  const ctx = fakeCtx();
  drawFrame(ctx, {}, layoutFor(SHORT), 0);
  assert.equal(ctx.calls[0].op, 'fill');
});

// --- Encoder configuration (#131) ---
// avc1.42001f is Baseline level 3.1 — 3600 macroblocks, or 1280x720. The fixed
// 1080x1920 viewport is 8160, so the level must be derived, not hardcoded.

test('no encoder config is offered when VideoEncoder is absent', async () => {
  assert.equal(typeof VideoEncoder, 'undefined');
  assert.equal(await pickEncoderConfig(VIEW_W, VIEW_H), null);
});

test('the viewport exceeds the level that used to be hardcoded', () => {
  const mbs = Math.ceil(VIEW_W / 16) * Math.ceil(VIEW_H / 16);
  assert.equal(mbs, 8160);
  assert.ok(mbs > 3600, 'level 3.1 could never have encoded this');
  assert.ok(mbs <= 8192, 'level 4.0 can');
});

test('the encoder frame size no longer varies with award count', () => {
  // Whatever the card height, the video is always the same dimensions — so the
  // encoder config is chosen once and cannot drift out of level range.
  assert.equal(VIEW_W, 1080);
  assert.equal(VIEW_H, 1920);
});
