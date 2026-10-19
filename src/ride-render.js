/**
 * Ride replay renderers. The ribbon (width = power) and the translucent
 * curtain under it (height = altitude) are uploaded once; the playhead,
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
  widthBase: f32,
  widthGain: f32,
  focusA: f32,
  focusB: f32,
  _pad: f32,
};
@group(0) @binding(0) var<uniform> u: U;

struct Seg {
  @location(0) p0: vec3f, @location(1) p1: vec3f,
  @location(2) t: vec2f, @location(3) w: vec2f, @location(4) rgb: vec3f,
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

fn focusAlpha(s: Seg) -> f32 {
  return select(0.22, 1.0, s.t.x >= u.focusA && s.t.y <= u.focusB);
}

@vertex
fn vsRibbon(@builtin(vertex_index) vi: u32, s: Seg) -> VOut {
  if (u.playhead < s.t.x) { return hidden(); }
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
  let wpx = u.widthBase + u.widthGain * select(s.w.x, s.w.y, end);
  let hw = wpx * 0.5 + 0.5;
  // Overlap ends by half a width so joints between segments have no gaps
  let p = select(s0 - d * hw * 0.5, s1 + d * hw * 0.5, end) + n * c.y * hw;
  let clip = select(c0, c1, end);
  var o: VOut;
  o.pos = vec4f(p / half * clip.w, clip.z, clip.w);
  // Dim by darkening, not transparency: overlapping joints would stripe
  o.rgb = s.rgb * mix(0.3, 1.0, (focusAlpha(s) - 0.22) / 0.78);
  o.side = c.y * hw;
  o.hw = hw;
  o.alpha = 1.0;
  return o;
}

@fragment
fn fsRibbon(i: VOut) -> @location(0) vec4f {
  let a = clamp(i.hw - abs(i.side), 0.0, 1.0) * i.alpha;
  return vec4f(i.rgb * a, a);
}

@vertex
fn vsCurtain(@builtin(vertex_index) vi: u32, s: Seg) -> VOut {
  if (u.playhead < s.t.x) { return hidden(); }
  let q1 = mix(s.p0, s.p1, drawn(s));
  let c = CORNERS[vi];
  let top = c.y > 0.0;
  let base = select(s.p0, q1, c.x > 0.5);
  let p = vec3f(base.xy, select(0.0, base.z, top));
  var o: VOut;
  o.pos = u.viewProj * vec4f(p, 1.0);
  o.rgb = s.rgb;
  o.side = select(0.0, 1.0, top);
  o.alpha = focusAlpha(s);
  return o;
}

@fragment
fn fsCurtain(i: VOut) -> @location(0) vec4f {
  let a = 0.16 * i.side * i.alpha;
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
        { shaderLocation: 3, offset: 32, format: "float32x2" },
        { shaderLocation: 4, offset: 40, format: "float32x3" },
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
  const ribbonPipe = pipeline("vsRibbon", "fsRibbon");

  const uni = new Float32Array(24);
  return {
    kind: "webgpu",
    render(camera, opts) {
      if (canvas.width === 0 || canvas.height === 0) return;
      uni.set(camera.viewProj, 0);
      uni[16] = canvas.width; uni[17] = canvas.height;
      uni[18] = opts.playhead;
      uni[19] = opts.widthBase; uni[20] = opts.widthGain;
      uni[21] = opts.focusA ?? -1e9; uni[22] = opts.focusB ?? 1e9;
      device.queue.writeBuffer(uniBuf, 0, uni);
      const enc = device.createCommandEncoder();
      const pass = enc.beginRenderPass({
        colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
      });
      pass.setBindGroup(0, bind);
      pass.setVertexBuffer(0, segBuf);
      pass.setPipeline(curtain);
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
      const { playhead, widthBase, widthGain } = opts;
      const fA = opts.focusA ?? -1e9, fB = opts.focusB ?? 1e9;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineCap = "round";
      const pts = [];
      for (let k = 0; k < count; k++) {
        const o = k * RIBBON_FLOATS;
        const t0 = ribbon[o + 6], t1 = ribbon[o + 7];
        if (playhead < t0) break;
        const f = Math.min(1, Math.max(0, (playhead - t0) / Math.max(1e-3, t1 - t0)));
        const x1 = ribbon[o] + (ribbon[o + 3] - ribbon[o]) * f;
        const y1 = ribbon[o + 1] + (ribbon[o + 4] - ribbon[o + 1]) * f;
        const z1 = ribbon[o + 2] + (ribbon[o + 5] - ribbon[o + 2]) * f;
        const a = camera.project(ribbon[o], ribbon[o + 1], ribbon[o + 2]);
        const b = camera.project(x1, y1, z1);
        const ga = camera.project(ribbon[o], ribbon[o + 1], 0);
        const gb = camera.project(x1, y1, 0);
        const rgb = [ribbon[o + 10], ribbon[o + 11], ribbon[o + 12]].map((c) => Math.round(c * 255)).join(",");
        const alpha = t0 >= fA && t1 <= fB ? 1 : 0.22;
        pts.push({ a, b, ga, gb, rgb, alpha, w: widthBase + widthGain * ribbon[o + 8] });
      }
      for (const p of pts) {
        ctx.fillStyle = `rgba(${p.rgb},${0.07 * p.alpha})`;
        ctx.beginPath();
        ctx.moveTo(p.a[0], p.a[1]); ctx.lineTo(p.b[0], p.b[1]);
        ctx.lineTo(p.gb[0], p.gb[1]); ctx.lineTo(p.ga[0], p.ga[1]);
        ctx.fill();
      }
      for (const p of pts) {
        ctx.strokeStyle = p.alpha === 1 ? `rgb(${p.rgb})` : `rgb(${p.rgb.split(",").map((c) => Math.round(c * 0.3)).join(",")})`;
        ctx.lineWidth = p.w;
        ctx.beginPath();
        ctx.moveTo(p.a[0], p.a[1]); ctx.lineTo(p.b[0], p.b[1]);
        ctx.stroke();
      }
    },
    done: () => Promise.resolve(),
    destroy() {},
  };
}
