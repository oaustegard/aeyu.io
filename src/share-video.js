/**
 * Share card slideshow (#131).
 *
 * The still card fits four highlight rows and then has to say "+ N more
 * awards". That truncation is the only reason the video exists: it steps
 * through card-sized pages of awards, one slide at a time, at the card's own
 * dimensions. Every frame is a complete, screenshot-able card.
 *
 * Deliberately not: a fade-in of the same four rows (no information the PNG
 * lacks), and not a scroll through one very tall card (the card is usually
 * shorter than a 9:16 frame, so it fits, letterboxes, and never moves).
 *
 * A single page produces no video at all — callers check `slideCount` first.
 *
 * Why not ffmpeg.wasm: the core WASM bundle is 31–32 MB and its multithreaded
 * build needs SharedArrayBuffer, which needs COOP/COEP response headers. aeyu
 * is served from GitHub Pages, which cannot set response headers at all — so
 * cross-origin isolation is not available here without a service-worker header
 * shim. Nothing about this feature needs a transcoder anyway: there is no input
 * media, only frames we draw ourselves. WebCodecs hands those frames to the
 * platform's hardware H.264 encoder with no payload to download.
 *
 * Support: VideoEncoder ships in Chrome 94+, Firefox 130+ desktop, and Safari
 * 16.4+ (16.4–18.7 expose the video interfaces only, no audio — which is fine,
 * these cards are silent). Anything older falls back to MediaRecorder/WebM,
 * offered as a download rather than a share since social targets reject WebM.
 */

/**
 * Frames per second. Low on purpose: this is a slideshow, not motion, and 10fps
 * is the floor that players and social uploads handle without complaint.
 */
export const FPS = 10;
/** Seconds each slide is held. */
const SLIDE_HOLD = 2.4;
/** Seconds of crossfade between slides. */
const SLIDE_FADE = 0.4;
/** Never produce anything longer than this. */
const MAX_DURATION = 30;

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const even = (n) => n + (n % 2);

/** Seconds one slide occupies, including its crossfade into the next. */
const SLIDE_PERIOD = SLIDE_HOLD + SLIDE_FADE;

/** Total duration for a deck of this many slides. */
export function videoDuration(slideCount) {
  const n = Math.max(1, slideCount);
  return +Math.min(MAX_DURATION, n * SLIDE_PERIOD - SLIDE_FADE).toFixed(3);
}

/**
 * Which slides are on screen at time t, and how far the crossfade has got.
 * Returns the outgoing slide index and the incoming one's opacity.
 */
export function slideAt(t, slideCount) {
  const n = Math.max(1, slideCount);
  const i = Math.min(n - 1, Math.floor(t / SLIDE_PERIOD));
  const within = t - i * SLIDE_PERIOD;
  const fade = within <= SLIDE_HOLD || i >= n - 1
    ? 0
    : clamp01((within - SLIDE_HOLD) / SLIDE_FADE);
  return { index: i, next: Math.min(n - 1, i + 1), fade };
}

/**
 * Draw one frame. Slides may differ slightly in height — the last page carries
 * fewer rows — so each is drawn against a matte at the deck's common size.
 */
export function drawFrame(ctx, slides, layout, t) {
  const { width: W, height: H } = layout;
  const { index, next, fade } = slideAt(t, slides.length);

  ctx.globalAlpha = 1;
  ctx.fillStyle = layout.matte || "#4A5759";
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(slides[index], 0, 0);

  if (fade > 0 && next !== index) {
    ctx.globalAlpha = fade;
    ctx.drawImage(slides[next], 0, 0);
    ctx.globalAlpha = 1;
  }
}

/**
 * Sample the card's own border colour so letterboxing matches it. Falls back to
 * the steel blue the card uses if the canvas cannot be read.
 */
function matteColor(canvas) {
  try {
    const [r, g, b] = canvas.getContext("2d").getImageData(1, 1, 1, 1).data;
    return `rgb(${r}, ${g}, ${b})`;
  } catch {
    return "#4A5759";
  }
}

/**
 * Max frame size in macroblocks per H.264 level (Table A-1).
 * The old code hardcoded `avc1.42001f` — Baseline level 3.1, which caps at
 * 3600 macroblocks, i.e. 1280x720. Share cards are 1080 wide and commonly
 * 1400-2400 tall, so every real card was over the level's limit. Chrome's
 * isConfigSupported() does not check dimensions against the level, so it
 * answered `true` and the encoder then died at runtime with the useless
 * "Encoding task failed" (#131).
 */
const H264_LEVELS = [
  ["1e", 1620], ["1f", 3600], ["20", 5120], ["28", 8192],
  ["2a", 8704], ["32", 22080], ["33", 36864], ["34", 36864],
];

/** Codec strings that can hold a frame this size, weakest profile first. */
function codecCandidates(width, height) {
  const mbs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const out = [];
  for (const [lvl, maxFs] of H264_LEVELS) {
    if (maxFs < mbs) continue;
    out.push(`avc1.4200${lvl}`, `avc1.4d00${lvl}`, `avc1.6400${lvl}`);
  }
  return out;
}

/**
 * Find a config this browser will actually accept for these dimensions.
 * Probes at the real frame size — the previous check asked about 1080x1080
 * regardless of the card's actual height, so it was answering a different
 * question from the one that mattered.
 */
export async function pickEncoderConfig(width, height) {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of codecCandidates(width, height)) {
    for (const hardwareAcceleration of ["no-preference", "prefer-software"]) {
      const config = {
        codec, width, height, bitrate: 6_000_000, framerate: FPS,
        avc: { format: "avc" }, hardwareAcceleration,
      };
      try {
        const { supported } = await VideoEncoder.isConfigSupported(config);
        if (supported) return config;
      } catch {
        // Malformed codec string for this browser; try the next.
      }
    }
  }
  return null;
}

/**
 * Render a slideshow of share cards.
 *
 * @param {Array<(canvas: HTMLCanvasElement) => Promise<{width:number,height:number}>>} drawSlides
 *   One draw function per page, each rendering a complete card. Passed in
 *   rather than imported so this module stays independent of the card's own
 *   drawing code.
 * @returns {Promise<{blob: Blob, type: string, extension: string, slides: number}>}
 */
export async function renderShareVideo(drawSlides, { onProgress } = {}) {
  const draws = Array.isArray(drawSlides) ? drawSlides : [drawSlides];
  if (draws.length < 2) {
    throw new Error("Nothing to animate — these awards all fit on one card");
  }

  // Two passes. The first measures — the last page carries fewer rows, so pages
  // differ in natural height. The second re-renders every page at the tallest,
  // so the card is the same object on every slide rather than something that
  // visibly resizes as the deck advances.
  let cardH = 0;
  for (const draw of draws) {
    const probe = document.createElement("canvas");
    const drawn = await draw(probe);
    if (!drawn || !drawn.height) throw new Error("A slide returned no layout metadata");
    cardH = Math.max(cardH, drawn.height);
  }
  cardH = even(cardH);

  const slides = [];
  let W = 0;
  for (const draw of draws) {
    const canvas = document.createElement("canvas");
    const drawn = await draw(canvas, { height: cardH });
    slides.push(canvas);
    W = Math.max(W, drawn.width);
  }

  // H.264 needs even dimensions, nothing more — rounding to a macroblock would
  // leave a visible strip of matte down one edge of a 1080-wide card.
  W = even(W);
  const H = cardH;
  const layout = { width: W, height: H, matte: matteColor(slides[0]) };

  const frame = document.createElement("canvas");
  frame.width = W;
  frame.height = H;
  const ctx = frame.getContext("2d");

  const total = Math.round(videoDuration(slides.length) * FPS);

  // isConfigSupported() is advisory — encoders still fail at runtime — so a
  // failed MP4 attempt degrades to WebM rather than surfacing to the user.
  const config = await pickEncoderConfig(W, H);
  if (config) {
    try {
      const out = await encodeMp4(frame, ctx, slides, layout, total, onProgress, config);
      return { ...out, slides: slides.length };
    } catch (err) {
      console.warn("[aeyu] MP4 encode failed, falling back to WebM:", err);
    }
  }
  const out = await recordWebm(frame, ctx, slides, layout, total, onProgress);
  return { ...out, slides: slides.length };
}

async function encodeMp4(frame, ctx, slides, layout, total, onProgress, config) {
  // Loaded on demand: 69 KB of muxer that only matters once someone actually
  // asks for a video, and keeping it out of the static graph lets the pure
  // animation functions above be tested without a browser.
  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
  const { width: W, height: H } = frame;
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H, frameRate: FPS },
    fastStart: "in-memory", // share sheets and social apps need the moov up front
  });

  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e; },
  });
  encoder.configure(config);

  try {
    for (let i = 0; i < total; i++) {
      if (encodeError) throw encodeError;
      drawFrame(ctx, slides, layout, i / FPS);
      const vf = new VideoFrame(frame, {
        timestamp: Math.round((i / FPS) * 1e6),
        duration: Math.round(1e6 / FPS),
      });
      // Keyframe up front, then roughly every second, so scrubbing works.
      encoder.encode(vf, { keyFrame: i % FPS === 0 });
      vf.close();
      // Wait for the queue to drain rather than calling flush() mid-stream —
      // a mid-stream flush resets some encoders and is itself a plausible
      // source of "Encoding task failed".
      while (encoder.encodeQueueSize > 8 && !encodeError) {
        await new Promise((r) => setTimeout(r, 4));
      }
      onProgress?.((i + 1) / total);
    }
    await encoder.flush();
    if (encodeError) throw encodeError;
    muxer.finalize();
    return {
      blob: new Blob([muxer.target.buffer], { type: "video/mp4" }),
      type: "video/mp4",
      extension: "mp4",
    };
  } finally {
    if (encoder.state !== "closed") encoder.close();
  }
}

/**
 * Fallback for browsers without VideoEncoder. Produces WebM, which most social
 * targets will not accept — callers should offer this as a download.
 */
async function recordWebm(frame, ctx, slides, layout, total, onProgress) {
  if (typeof MediaRecorder === "undefined" || !frame.captureStream) {
    throw new Error("This browser cannot record video");
  }
  const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]
    .find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) throw new Error("This browser cannot record video");

  const stream = frame.captureStream(FPS);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };

  const done = new Promise((resolve, reject) => {
    recorder.onstop = resolve;
    recorder.onerror = reject;
  });

  recorder.start();
  for (let i = 0; i < total; i++) {
    drawFrame(ctx, slides, layout, i / FPS);
    onProgress?.((i + 1) / total);
    // captureStream samples in real time, so this has to play out at wall clock.
    await new Promise((r) => setTimeout(r, 1000 / FPS));
  }
  recorder.stop();
  await done;
  stream.getTracks().forEach((t) => t.stop());

  return {
    blob: new Blob(chunks, { type: mime.split(";")[0] }),
    type: mime.split(";")[0],
    extension: "webm",
  };
}
