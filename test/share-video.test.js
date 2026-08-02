import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FPS, videoDuration, drawFrame, pickEncoderConfig } from '../src/share-video.js';

// A card shaped like the 2026-08-02 ride: header, title, meta, one pill row,
// four highlight rows, tagline.
const layout = {
  width: 1080,
  height: 1400,
  chrome: { __chrome: true },
  bands: [
    { y0: 0, y1: 96 },
    { y0: 168, y1: 250 },
    { y0: 258, y1: 300 },
    { y0: 320, y1: 376 },
    { y0: 400, y1: 446 },
    { y0: 452, y1: 498 },
    { y0: 504, y1: 550 },
    { y0: 556, y1: 602 },
    { y0: 1340, y1: 1386 },
  ],
};

/** Minimal 2D context recorder — no DOM needed. */
function fakeCtx() {
  const calls = [];
  return {
    calls,
    globalAlpha: 1,
    clearRect: (...a) => calls.push({ op: 'clear', a }),
    drawImage(...a) {
      calls.push({ op: 'draw', img: a[0], args: a.slice(1), alpha: this.globalAlpha });
    },
  };
}

const drawn = (ctx) => ctx.calls.filter((c) => c.op === 'draw' && c.img !== layout.chrome);

test('duration scales with band count and includes the hold', () => {
  const short = videoDuration(1);
  const long = videoDuration(9);
  assert.ok(long > short);
  assert.ok(short >= 1.6, 'even a one-band card holds on the finished frame');
  assert.ok(long < 5, 'a full card stays short enough to share');
});

test('frame count is a whole number of frames', () => {
  const total = Math.round(videoDuration(layout.bands.length) * FPS);
  assert.ok(Number.isInteger(total));
  assert.ok(total > 0);
});

test('chrome is painted on every frame, including the first', () => {
  for (const t of [0, 0.5, 2, videoDuration(layout.bands.length)]) {
    const ctx = fakeCtx();
    drawFrame(ctx, {}, layout, t);
    assert.ok(ctx.calls.some((c) => c.op === 'draw' && c.img === layout.chrome),
      `chrome missing at t=${t}`);
  }
});

test('nothing but chrome is visible at t=0', () => {
  const ctx = fakeCtx();
  drawFrame(ctx, {}, layout, 0);
  assert.equal(drawn(ctx).length, 0);
});

test('bands arrive in order', () => {
  const ctx = fakeCtx();
  drawFrame(ctx, {}, layout, 0.3);
  const visible = drawn(ctx);
  assert.ok(visible.length > 0 && visible.length < layout.bands.length,
    'a mid-reveal frame shows some but not all bands');
  // Whatever is visible must be a prefix of the band list
  visible.forEach((c, i) => assert.equal(c.args[1], layout.bands[i].y0));
});

test('every band is fully opaque and in place by the end', () => {
  const ctx = fakeCtx();
  drawFrame(ctx, {}, layout, videoDuration(layout.bands.length));
  const visible = drawn(ctx);
  assert.equal(visible.length, layout.bands.length);
  visible.forEach((c, i) => {
    assert.ok(Math.abs(c.alpha - 1) < 1e-9, `band ${i} not opaque`);
    // destination y equals source y once settled
    assert.ok(Math.abs(c.args[5] - layout.bands[i].y0) < 1e-6, `band ${i} not settled`);
  });
});

test('a band slides up as it fades in', () => {
  const ctx = fakeCtx();
  drawFrame(ctx, {}, layout, 0.15);
  const first = drawn(ctx)[0];
  assert.ok(first.alpha > 0 && first.alpha < 1);
  assert.ok(first.args[5] > layout.bands[0].y0, 'mid-fade band should be offset downward');
});

test('zero-height bands are skipped rather than drawn', () => {
  const degenerate = { ...layout, bands: [{ y0: 100, y1: 100 }, { y0: 200, y1: 240 }] };
  const ctx = fakeCtx();
  drawFrame(ctx, {}, degenerate, 99);
  assert.equal(drawn(ctx).length, 1);
});

test('a card with no bands still renders chrome', () => {
  const ctx = fakeCtx();
  drawFrame(ctx, {}, { ...layout, bands: [] }, 1);
  assert.ok(ctx.calls.some((c) => c.img === layout.chrome));
  assert.equal(drawn(ctx).length, 0);
});

// --- Encoder configuration (#131) ---
// The original bug: avc1.42001f is Baseline level 3.1, which tops out at 3600
// macroblocks (1280x720). Every real share card is taller than that.

test('no encoder config is offered when VideoEncoder is absent', async () => {
  assert.equal(typeof VideoEncoder, 'undefined');
  assert.equal(await pickEncoderConfig(1080, 1560), null);
});

test('level 3.1 cannot hold a real share card', () => {
  // 1080x1560 -> 68 x 98 macroblocks
  const mbs = Math.ceil(1080 / 16) * Math.ceil(1560 / 16);
  assert.equal(mbs, 6664);
  assert.ok(mbs > 3600, 'this is the frame size the old hardcoded level rejected');
});

test('candidate levels cover the tallest cards we produce', () => {
  // A card with many awards can reach ~2400px tall -> 68 x 150 = 10200 MBs,
  // which needs level 5.0 or better.
  const mbs = Math.ceil(1080 / 16) * Math.ceil(2400 / 16);
  assert.ok(mbs <= 36864, 'level 5.1/5.2 must still have headroom');
});
