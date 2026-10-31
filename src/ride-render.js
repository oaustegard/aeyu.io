/**
 * Ride replay renderers. The ribbon (colour = power) and the translucent
 * curtain under it (height = altitude, tinted on award efforts) are uploaded once; the playhead,
 * camera and focus window are uniforms, so playback re-sends ~100 bytes a
 * frame. The rider and ghost dots are drawn on a 2D overlay by the caller.
 */

import { RIBBON_FLOATS } from "./ride-scene.js";

const STRIDE = RIBBON_FLOATS * 4;

const SHADER = /* wgsl */ `
struct U {
  viewProj: mat4x4f,
  viewport: vec2f,
  playhead: f32,
  width: f32,
  pad: f32,
  focusA: f32,
  focusB: f32,
  context: f32,
};
@group(0) @binding(0) var<uniform> u: U;

struct Seg {
  @location(0) p0: vec3f, @location(1) p1: vec3f,
  @location(2) t: vec2f, @location(3) rgb0: vec3f, @location(4) rgb1: vec3f,
  @location(5) curtain: vec4f,
};
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) rgb: vec3f,
  @location(1) side: f32,
  @location(2) hw: f32,
  @location(3) alpha: f32,
};

const CORNERS = array<vec2f, 6>(
  vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(0.0, 1.0),
  vec2f(0.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));

fn hidden() -> VOut {
  var o: VOut;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  return o;
}

// Fraction of this segment drawn so far; the tip ends exactly at the playhead
fn drawn(s: Seg) -> f32 {
  return clamp((u.playhead - s.t.x) / max(s.t.y - s.t.x, 1e-3), 0.0, 1.0);
}

// 1 inside the focus window, fading to 0 over u.context seconds either side;
// past that the rest of the ride is hidden so it can't sprawl across a
// close-up camera
fn focusFade(s: Seg) -> f32 {
  let gap = max(u.focusA - s.t.y, s.t.x - u.focusB);
  if (gap <= 0.0) { return 1.0; }
  return 0.3 * clamp(1.0 - gap / u.context, 0.0, 1.0);
}

// Dark rim drawn in its own pass under the whole ribbon, so it separates the
// line from the curtain glow without striping the joints between segments
const CASING_RGB = vec3f(0.09, 0.06, 0.043);
fn casingWidth() -> f32 { return max(1.5, u.width * 0.3); }

fn ribbonVert(vi: u32, s: Seg, extra: f32) -> VOut {
  let fade = focusFade(s);
  if (u.playhead < s.t.x || fade <= 0.0) { return hidden(); }
  let q1 = mix(s.p0, s.p1, drawn(s));
  let c0 = u.viewProj * vec4f(s.p0, 1.0);
  let c1 = u.viewProj * vec4f(q1, 1.0);
  let half = u.viewport * 0.5;
  let s0 = c0.xy / c0.w * half;
  let s1 = c1.xy / c1.w * half;
  var d = s1 - s0;
  let len = length(d);
  d = select(vec2f(1.0, 0.0), d / len, len > 1e-4);
  let n = vec2f(-d.y, d.x);
  let c = CORNERS[vi];
  let end = c.x > 0.5;
  let hw = u.width * 0.5 + 0.5 + extra;
  // Overlap ends slightly so joints between segments have no gaps
  let p = select(s0 - d * hw * 0.3, s1 + d * hw * 0.3, end) + n * c.y * hw;
  let clip = select(c0, c1, end);
  var o: VOut;
  o.pos = vec4f(p / half * clip.w, clip.z, clip.w);
  // Dim by darkening, not transparency: overlapping joints would stripe
  o.rgb = select(s.rgb0, s.rgb1, end) * fade;
  o.side = c.y * hw;
  o.hw = hw;
  o.alpha = 1.0;
  return o;
}

@vertex
fn vsRibbon(@builtin(vertex_index) vi: u32, s: Seg) -> VOut {
  return ribbonVert(vi, s, 0.0);
}

@vertex
fn vsCasing(@builtin(vertex_index) vi: u32, s: Seg) -> VOut {
  var o = ribbonVert(vi, s, casingWidth());
  o.alpha = 0.9 * min(1.0, focusFade(s) / 0.3);
  o.rgb = CASING_RGB;
  return o;
}

@fragment
fn fsRibbon(i: VOut) -> @location(0) vec4f {
  let a = clamp(i.hw - abs(i.side), 0.0, 1.0) * i.alpha;
  return vec4f(i.rgb * a, a);
}

@vertex
fn vsCurtain(@builtin(vertex_index) vi: u32, s: Seg) -> VOut {
  let fade = focusFade(s);
  if (u.playhead < s.t.x || fade <= 0.0) { return hidden(); }
  let q1 = mix(s.p0, s.p1, drawn(s));
  let c = CORNERS[vi];
  let top = c.y > 0.0;
  let base = select(s.p0, q1, c.x > 0.5);
  let p = vec3f(base.xy, select(0.0, base.z, top));
  var o: VOut;
  o.pos = u.viewProj * vec4f(p, 1.0);
  o.rgb = s.curtain.rgb;
  o.side = select(0.0, 1.0, top);
  o.alpha = fade * select(0.22, 0.5, s.curtain.a > 0.5);
  return o;
}

@fragment
fn fsCurtain(i: VOut) -> @location(0) vec4f {
  let a = i.side * i.alpha;
  return vec4f(i.rgb * a, a);
}
`;

const BLEND = {
  color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
  alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
};

export async function createRideGPURenderer(canvas, ribbon) {
  if (typeof navigator === "undefined" || !navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext("webgpu");
  if (!ctx) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "premultiplied" });

  const count = ribbon.length / RIBBON_FLOATS;
  const segBuf = device.createBuffer({ size: Math.max(STRIDE, ribbon.byteLength), usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(segBuf, 0, ribbon);
  const uniBuf = device.createBuffer({ size: 96, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const module = device.createShaderModule({ code: SHADER });
  const layout = device.createBindGroupLayout({
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {} }],
  });
  const bind = device.createBindGroup({ layout, entries: [{ binding: 0, resource: { buffer: uniBuf } }] });
  const vertex = (entryPoint) => ({
    module, entryPoint,
    buffers: [{
      arrayStride: STRIDE, stepMode: "instance",
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
        { shaderLocation: 2, offset: 24, format: "float32x2" },
        { shaderLocation: 3, offset: 32, format: "float32x3" },
        { shaderLocation: 4, offset: 44, format: "float32x3" },
        { shaderLocation: 5, offset: 56, format: "float32x4" },
      ],
    }],
  });
  const pipeline = (vs, fs) => device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    vertex: vertex(vs),
    fragment: { module, entryPoint: fs, targets: [{ format, blend: BLEND }] },
    primitive: { topology: "triangle-list" },
  });
  const curtain = pipeline("vsCurtain", "fsCurtain");
  const casing = pipeline("vsCasing", "fsRibbon");
  const ribbonPipe = pipeline("vsRibbon", "fsRibbon");

  const uni = new Float32Array(24);
  return {
    kind: "webgpu",
    render(camera, opts) {
      if (canvas.width === 0 || canvas.height === 0) return;
      uni.set(camera.viewProj, 0);
      uni[16] = canvas.width; uni[17] = canvas.height;
      uni[18] = opts.playhead;
      uni[19] = opts.width;
      uni[21] = opts.focusA ?? -1e9; uni[22] = opts.focusB ?? 1e9; uni[23] = opts.context ?? 1e9;
      device.queue.writeBuffer(uniBuf, 0, uni);
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
      });
      pass.setBindGroup(0, bind);
      pass.setVertexBuffer(0, segBuf);
      pass.setPipeline(curtain);
      pass.draw(6, count);
      pass.setPipeline(casing);
      pass.draw(6, count);
      pass.setPipeline(ribbonPipe);
      pass.draw(6, count);
      pass.end();
      device.queue.submit([enc.finish()]);
    },
    done: () => device.queue.onSubmittedWorkDone(),
    destroy() { segBuf.destroy(); uniBuf.destroy(); device.destroy(); },
  };
}

export function createRideCanvasRenderer(canvas, ribbon) {
  const ctx = canvas.getContext("2d");
  const count = ribbon.length / RIBBON_FLOATS;
  return {
    kind: "canvas2d",
    render(camera, opts) {
      const { playhead, width } = opts;
      const fA = opts.focusA ?? -1e9, fB = opts.focusB ?? 1e9, ctxS = opts.context ?? 1e9;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = "round";
      const pts = [];
      for (let k = 0; k < count; k++) {
        const o = k * RIBBON_FLOATS;
        const t0 = ribbon[o + 6], t1 = ribbon[o + 7];
        if (playhead < t0) break;
        const gap = Math.max(fA - t1, t0 - fB);
        const alpha = gap <= 0 ? 1 : 0.3 * Math.max(0, 1 - gap / ctxS);
        if (alpha <= 0) continue;
        const f = Math.min(1, Math.max(0, (playhead - t0) / Math.max(1e-3, t1 - t0)));
        const x1 = ribbon[o] + (ribbon[o + 3] - ribbon[o]) * f;
        const y1 = ribbon[o + 1] + (ribbon[o + 4] - ribbon[o + 1]) * f;
        const z1 = ribbon[o + 2] + (ribbon[o + 5] - ribbon[o + 2]) * f;
        const a = camera.project(ribbon[o], ribbon[o + 1], ribbon[o + 2]);
        const b = camera.project(x1, y1, z1);
        const ga = camera.project(ribbon[o], ribbon[o + 1], 0);
        const gb = camera.project(x1, y1, 0);
        const css = (i) => [ribbon[i], ribbon[i + 1], ribbon[i + 2]].map((c) => Math.round(c * 255)).join(",");
        pts.push({ a, b, ga, gb, rgb: css(o + 8), curtain: css(o + 14), award: ribbon[o + 17] > 0.5, alpha });
      }
      for (const p of pts) {
        ctx.fillStyle = `rgba(${p.curtain},${(p.award ? 0.18 : 0.07) * p.alpha})`;
        ctx.beginPath();
        ctx.moveTo(p.a[0], p.a[1]); ctx.lineTo(p.b[0], p.b[1]);
        ctx.lineTo(p.gb[0], p.gb[1]); ctx.lineTo(p.ga[0], p.ga[1]);
        ctx.fill();
      }
      ctx.lineWidth = width + 2 * Math.max(1.5, width * 0.3);
      for (const p of pts) {
        ctx.strokeStyle = `rgba(23,15,11,${0.9 * Math.min(1, p.alpha / 0.3)})`;
        ctx.beginPath();
        ctx.moveTo(p.a[0], p.a[1]); ctx.lineTo(p.b[0], p.b[1]);
        ctx.stroke();
      }
      for (const p of pts) {
        ctx.strokeStyle = p.alpha === 1 ? `rgb(${p.rgb})` : `rgb(${p.rgb.split(",").map((c) => Math.round(c * p.alpha)).join(",")})`;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(p.a[0], p.a[1]); ctx.lineTo(p.b[0], p.b[1]);
        ctx.stroke();
      }
    },
    done: () => Promise.resolve(),
    destroy() {},
  };
}
