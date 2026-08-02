/**
 * Animated share cards (#131).
 *
 * Encodes the existing canvas share card into a short MP4 by rendering it once
 * to an offscreen canvas and then revealing its bands over time.
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
/** Seconds each band takes to ease in. */
const BAND_FADE = 0.45;
/** Seconds between successive bands starting. */
const BAND_STAGGER = 0.18;
/** Seconds the finished card holds before the video ends. */
const HOLD = 1.6;
/** How far a band slides up as it fades in, in canvas px. */
const SLIDE = 18;

const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Total duration in seconds for a card with this many bands. */
export function videoDuration(bandCount) {
  const last = Math.max(0, bandCount - 1) * BAND_STAGGER + BAND_FADE;
  return +(last + HOLD).toFixed(3);
}

/**
 * Per-band progress at time t. Bands enter in document order, which is the
 * order awards were ranked — so on a well-scored card the reveal reads as a
 * countdown to the thing that mattered most.
 */
function bandProgress(index, t) {
  return easeOut(clamp01((t - index * BAND_STAGGER) / BAND_FADE));
}

/** Draw one frame of the animation into ctx. */
export function drawFrame(ctx, still, layout, t) {
  const { width: W, height: H } = layout;
  ctx.clearRect(0, 0, W, H);
  // Chrome first — border, paper, topo texture, watermark — captured by the
  // card renderer before any content was drawn on it.
  ctx.drawImage(layout.chrome, 0, 0);

  layout.bands.forEach((b, i) => {
    const p = bandProgress(i, t);
    if (p <= 0) return;
    const h = b.y1 - b.y0;
    if (h <= 0) return;
    ctx.globalAlpha = p;
    ctx.drawImage(still, 0, b.y0, W, h, 0, b.y0 + (1 - p) * SLIDE, W, h);
  });
  ctx.globalAlpha = 1;
}

/** True when the browser can produce a real MP4. */
export async function canEncodeMp4() {
  if (typeof VideoEncoder === "undefined") return false;
  try {
    const { supported } = await VideoEncoder.isConfigSupported({
      codec: "avc1.42001f", width: 1080, height: 1080,
      bitrate: 6_000_000, framerate: FPS,
    });
    return !!supported;
  } catch {
    return false;
  }
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
  const layout = await drawStill(still);
  if (!layout || !layout.bands || !layout.chrome) {
    throw new Error("drawStill returned no layout metadata");
  }

  // H.264 requires even dimensions; pad rather than scale so nothing softens.
  const W = still.width + (still.width % 2);
  const H = still.height + (still.height % 2);

  const frame = document.createElement("canvas");
  frame.width = W;
  frame.height = H;
  const ctx = frame.getContext("2d");

  const duration = videoDuration(layout.bands.length);
  const total = Math.round(duration * FPS);

  if (await canEncodeMp4()) {
    return encodeMp4(frame, ctx, still, layout, total, onProgress);
  }
  return recordWebm(frame, ctx, still, layout, total, onProgress);
}

async function encodeMp4(frame, ctx, still, layout, total, onProgress) {
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
  encoder.configure({
    codec: "avc1.42001f", width: W, height: H,
    bitrate: 6_000_000, framerate: FPS,
    avc: { format: "avc" },
  });

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
      // Let the encoder drain instead of queueing every frame at once.
      if (encoder.encodeQueueSize > 8) await encoder.flush();
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
