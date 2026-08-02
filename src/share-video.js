/**
 * Animated share cards (#131).
 *
 * The still card can only fit four highlight rows before it has to fall back to
 * "+ N more awards". That truncation is the whole reason to make a video: the
 * card is rendered with NO highlight limit, however tall that makes it, and the
 * video pans down through it. A video that merely faded in the same four rows
 * would carry no information the PNG does not already carry.
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

export const FPS = 30;
/** Story-native 9:16 viewport. Constant regardless of how tall the card is. */
export const VIEW_W = 1080;
export const VIEW_H = 1920;
/** Seconds held on the top of the card before the pan starts. */
const HOLD_TOP = 0.9;
/** Seconds held on the bottom after the pan finishes. */
const HOLD_END = 1.5;
/** Reading pace, canvas px per second. */
const SCROLL_SPEED = 430;
/** Never produce anything longer than this, however many awards there are. */
const MAX_DURATION = 30;
/** A card shorter than the viewport does not scroll; it just holds. */
const STATIC_DURATION = 3;

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** How far the card has to travel for all of it to be seen. */
export function maxScroll(cardHeight, viewH = VIEW_H) {
  return Math.max(0, cardHeight - viewH);
}

/** Total duration in seconds for a card of this height. */
export function videoDuration(cardHeight, viewH = VIEW_H) {
  const travel = maxScroll(cardHeight, viewH);
  if (travel === 0) return STATIC_DURATION;
  const panning = travel / SCROLL_SPEED;
  return +Math.min(MAX_DURATION, HOLD_TOP + panning + HOLD_END).toFixed(3);
}

/**
 * Scroll offset in canvas px at time t. Holds at the top, eases through the
 * pan so it does not start and stop abruptly, then holds on the last frame so
 * the final awards stay readable.
 */
export function scrollAt(t, cardHeight, viewH = VIEW_H) {
  const travel = maxScroll(cardHeight, viewH);
  if (travel === 0) return 0;
  const duration = videoDuration(cardHeight, viewH);
  const panning = Math.max(0.001, duration - HOLD_TOP - HOLD_END);
  return travel * easeInOut(clamp01((t - HOLD_TOP) / panning));
}

/**
 * Draw one frame: the card, offset upward by the current scroll.
 * Areas above or below the card are filled with its own background colour so
 * short cards letterbox cleanly instead of showing black.
 */
export function drawFrame(ctx, still, layout, t) {
  const viewH = layout.viewH ?? VIEW_H;
  const viewW = layout.viewW ?? VIEW_W;
  ctx.fillStyle = layout.matte || "#4A5759";
  ctx.fillRect(0, 0, viewW, viewH);

  const y = -scrollAt(t, layout.height, viewH);
  // Centre a card shorter than the viewport rather than pinning it to the top.
  const offset = layout.height < viewH ? (viewH - layout.height) / 2 : y;
  ctx.drawImage(still, 0, offset, layout.width, layout.height);
}

/**
 * Sample the card's own border colour so letterboxing matches it. Falls back to
 * the steel blue the card uses if the canvas cannot be read.
 */
function matteColor(still) {
  try {
    const [r, g, b] = still.getContext("2d").getImageData(1, 1, 1, 1).data;
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
 * Render an animated share card.
 *
 * @param {(canvas: HTMLCanvasElement) => Promise<object>} drawStill — renders
 *   the still card and returns its layout metadata. Passed in rather than
 *   imported so this module stays independent of the card's own drawing code.
 * @returns {Promise<{blob: Blob, type: string, extension: string}>}
 */
export async function renderShareVideo(drawStill, { onProgress } = {}) {
  const still = document.createElement("canvas");
  const drawn = await drawStill(still);
  if (!drawn || !drawn.height) throw new Error("drawStill returned no layout metadata");

  // The frame is a fixed 9:16 viewport whatever the card's height. That keeps
  // the output share-ready, and it keeps the encoder config constant instead of
  // scaling with the number of awards.
  const W = VIEW_W;
  const H = VIEW_H;
  const layout = { ...drawn, viewW: W, viewH: H, matte: matteColor(still) };

  const frame = document.createElement("canvas");
  frame.width = W;
  frame.height = H;
  const ctx = frame.getContext("2d");

  const total = Math.round(videoDuration(layout.height, H) * FPS);

  // isConfigSupported() is advisory — encoders still fail at runtime — so a
  // failed MP4 attempt degrades to WebM rather than surfacing to the user.
  const config = await pickEncoderConfig(W, H);
  if (config) {
    try {
      return await encodeMp4(frame, ctx, still, layout, total, onProgress, config);
    } catch (err) {
      console.warn("[aeyu] MP4 encode failed, falling back to WebM:", err);
    }
  }
  return recordWebm(frame, ctx, still, layout, total, onProgress);
}

async function encodeMp4(frame, ctx, still, layout, total, onProgress, config) {
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
      drawFrame(ctx, still, layout, i / FPS);
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
async function recordWebm(frame, ctx, still, layout, total, onProgress) {
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
    drawFrame(ctx, still, layout, i / FPS);
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
