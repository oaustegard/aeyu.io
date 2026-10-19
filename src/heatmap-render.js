/**
 * Heatmap renderers (#301). WebGPU draws every segment as an instanced quad
 * into a float density texture, then tone-maps it. Filters are uniforms the
 * vertex shader tests against the per-activity buffer, so the segment buffer
 * is uploaded once. Canvas2D is the fallback where WebGPU is unavailable.
 */

import { matchesFilter } from "./heatmap.js";

const SHADER = /* wgsl */ `
struct U {
  center: vec2f,
  scale: vec2f,
  viewport: vec2f,
  lineWidth: f32,
  gain: f32,
  dayMin: f32,
  dayMax: f32,
  speedMin: f32,
  speedMax: f32,
  typeMask: u32,
  gearMask: u32,
  _pad: vec2f,
};
struct Attr { day: f32, speed: f32, typeSlot: u32, gearSlot: u32 };

@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var<storage, read> attrs: array<Attr>;

struct VOut { @builtin(position) pos: vec4f, @location(0) side: f32 };

@vertex
fn vs(@builtin(vertex_index) vi: u32, @location(0) seg: vec4f, @location(1) act: u32) -> VOut {
  var out: VOut;
  let a = attrs[act];
  let keep = a.day >= u.dayMin && a.day <= u.dayMax
    && a.speed >= u.speedMin && a.speed <= u.speedMax
    && ((u.typeMask >> a.typeSlot) & 1u) == 1u
    && ((u.gearMask >> a.gearSlot) & 1u) == 1u;
  if (!keep) {
    out.pos = vec4f(2.0, 2.0, 2.0, 1.0);
    out.side = 0.0;
    return out;
  }
  // Pixel space, so line width stays constant across zoom levels
  let p0 = (seg.xy - u.center) * u.scale;
  let p1 = (seg.zw - u.center) * u.scale;
  var d = p1 - p0;
  let len = length(d);
  d = select(vec2f(1.0, 0.0), d / len, len > 1e-6);
  let n = vec2f(-d.y, d.x);
  let corners = array<vec2f, 6>(
    vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(0.0, 1.0),
    vec2f(0.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let c = corners[vi];
  let hw = u.lineWidth * 0.5 + 0.5;
  // No end caps: consecutive segments of a track would double-count at joints
  let along = select(p0, p1, c.x > 0.5);
  let p = along + n * c.y * hw;
  out.pos = vec4f(p.x * 2.0 / u.viewport.x, -p.y * 2.0 / u.viewport.y, 0.0, 1.0);
  out.side = c.y * hw;
  return out;
}

@fragment
fn fsDensity(in: VOut) -> @location(0) vec4f {
  let cover = clamp(u.lineWidth * 0.5 + 0.5 - abs(in.side), 0.0, 1.0);
  return vec4f(cover, 0.0, 0.0, 0.0);
}

@group(0) @binding(2) var density: texture_2d<f32>;

@vertex
fn vsFull(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let xy = vec2f(f32((vi << 1u) & 2u), f32(vi & 2u));
  return vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
}

fn ramp(t: f32) -> vec3f {
  let bg = vec3f(0.07, 0.065, 0.06);
  let c1 = vec3f(0.55, 0.13, 0.02);
  let c2 = vec3f(0.99, 0.30, 0.01);
  let c3 = vec3f(1.0, 0.78, 0.30);
  let c4 = vec3f(1.0, 0.98, 0.92);
  if (t < 0.25) { return mix(bg, c1, t / 0.25); }
  if (t < 0.5) { return mix(c1, c2, (t - 0.25) / 0.25); }
  if (t < 0.8) { return mix(c2, c3, (t - 0.5) / 0.3); }
  return mix(c3, c4, (t - 0.8) / 0.2);
}

@fragment
fn fsTone(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let d = textureLoad(density, vec2i(pos.xy), 0).r;
  let t = 1.0 - exp(-d * u.gain);
  return vec4f(ramp(t), 1.0);
}
`;

export function webgpuAvailable() {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

export async function createWebGPURenderer(canvas, data) {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return null;
  const device = await adapter.requestDevice();
  const ctx = canvas.getContext("webgpu");
  if (!ctx) return null;
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: "opaque" });

  const module = device.createShaderModule({ code: SHADER });
  const segBuf = device.createBuffer({
    size: Math.max(20, data.segments.byteLength),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(segBuf, 0, data.segments);
  const attrBuf = device.createBuffer({
    size: Math.max(16, data.attrs.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(attrBuf, 0, data.attrs);
  const uniBuf = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const densityPipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: {
      module, entryPoint: "vs",
      buffers: [{
        arrayStride: 20, stepMode: "instance",
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x4" },
          { shaderLocation: 1, offset: 16, format: "uint32" },
        ],
      }],
    },
    fragment: {
      module, entryPoint: "fsDensity",
      targets: [{
        format: "rgba16float",
        blend: {
          color: { srcFactor: "one", dstFactor: "one", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
        },
      }],
    },
    primitive: { topology: "triangle-list" },
  });
  const tonePipeline = device.createRenderPipeline({
    layout: "auto",
    vertex: { module, entryPoint: "vsFull" },
    fragment: { module, entryPoint: "fsTone", targets: [{ format }] },
    primitive: { topology: "triangle-list" },
  });
  const densityBind = device.createBindGroup({
    layout: densityPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: uniBuf } },
      { binding: 1, resource: { buffer: attrBuf } },
    ],
  });

  let densityTex = null, toneBind = null, texW = 0, texH = 0;
  function ensureTarget(w, h) {
    if (densityTex && w === texW && h === texH) return;
    if (densityTex) densityTex.destroy();
    densityTex = device.createTexture({
      size: [w, h], format: "rgba16float",
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    toneBind = device.createBindGroup({
      layout: tonePipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: uniBuf } },
        { binding: 2, resource: densityTex.createView() },
      ],
    });
    texW = w; texH = h;
  }

  const uni = new ArrayBuffer(64);
  const uf = new Float32Array(uni);
  const uu = new Uint32Array(uni);

  return {
    kind: "webgpu",
    render(view, filter, style) {
      const w = canvas.width, h = canvas.height;
      if (w === 0 || h === 0) return;
      ensureTarget(w, h);
      uf[0] = view.cx; uf[1] = view.cy;
      uf[2] = view.scale; uf[3] = view.scale;
      uf[4] = w; uf[5] = h;
      uf[6] = style.lineWidth; uf[7] = style.gain;
      uf[8] = filter.dayMin; uf[9] = filter.dayMax;
      uf[10] = filter.speedMin; uf[11] = filter.speedMax;
      uu[12] = filter.typeMask >>> 0; uu[13] = filter.gearMask >>> 0;
      device.queue.writeBuffer(uniBuf, 0, uni);

      const enc = device.createCommandEncoder();
      const p1 = enc.beginRenderPass({
        colorAttachments: [{ view: densityTex.createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 0] }],
      });
      p1.setPipeline(densityPipeline);
      p1.setBindGroup(0, densityBind);
      p1.setVertexBuffer(0, segBuf);
      if (data.segCount > 0) p1.draw(6, data.segCount);
      p1.end();
      const p2 = enc.beginRenderPass({
        colorAttachments: [{ view: ctx.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: [0, 0, 0, 1] }],
      });
      p2.setPipeline(tonePipeline);
      p2.setBindGroup(0, toneBind);
      p2.draw(3);
      p2.end();
      device.queue.submit([enc.finish()]);
    },
    destroy() {
      segBuf.destroy(); attrBuf.destroy(); uniBuf.destroy();
      if (densityTex) densityTex.destroy();
      device.destroy();
    },
  };
}

export function createCanvasRenderer(canvas, data) {
  const ctx = canvas.getContext("2d");
  const segF = new Float32Array(data.segments);
  const segU = new Uint32Array(data.segments);
  return {
    kind: "canvas2d",
    render(view, filter, style) {
      const w = canvas.width, h = canvas.height;
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "#12110f";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineWidth = style.lineWidth;
      ctx.lineCap = "round";
      ctx.strokeStyle = `rgba(252, 76, 2, ${1 - Math.exp(-style.gain)})`;
      ctx.beginPath();
      let last = -1;
      for (let k = 0; k < data.segCount; k++) {
        const act = segU[k * 5 + 4];
        if (act !== last) {
          if (!matchesFilter(data.meta[act], filter)) {
            while (k + 1 < data.segCount && segU[(k + 1) * 5 + 4] === act) k++;
            continue;
          }
          ctx.stroke();
          ctx.beginPath();
          last = act;
          ctx.moveTo(w / 2 + (segF[k * 5] - view.cx) * view.scale, h / 2 + (segF[k * 5 + 1] - view.cy) * view.scale);
        }
        ctx.lineTo(w / 2 + (segF[k * 5 + 2] - view.cx) * view.scale, h / 2 + (segF[k * 5 + 3] - view.cy) * view.scale);
      }
      ctx.stroke();
    },
    destroy() {},
  };
}
