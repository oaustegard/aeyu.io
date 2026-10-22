/**
 * WebGPU version of computeTableCPU (fatigue-curve.js). One thread per
 * (ride, duration) walks that ride's window starts backward with a running
 * integer window sum, so the result is bit-identical to the CPU table.
 */

import { DURATIONS } from "./fatigue-curve.js";

const SHADER = /* wgsl */ `
struct Params { rideBase: u32, rideCount: u32, nDur: u32, K: u32 }

@group(0) @binding(0) var<storage, read> watts: array<u32>;
@group(0) @binding(1) var<storage, read> offsets: array<u32>;
@group(0) @binding(2) var<storage, read> lengths: array<u32>;
@group(0) @binding(3) var<storage, read> starts: array<u32>;
@group(0) @binding(4) var<storage, read> durs: array<u32>;
@group(0) @binding(5) var<storage, read_write> table: array<u32>;
@group(0) @binding(6) var<uniform> P: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let di = gid.x;
  if (di >= P.nDur || gid.y >= P.rideCount) { return; }
  let r = P.rideBase + gid.y;
  let base = offsets[r];
  let n = lengths[r];
  let d = durs[di];
  let o = r * P.K * P.nDur + di;
  for (var kk = 0u; kk < P.K; kk++) { table[o + kk * P.nDur] = 0u; }
  if (d > n) { return; }
  var k = i32(P.K) - 1;
  loop {
    if (k < 0 || starts[r * P.K + u32(k)] <= n - d) { break; }
    k--;
  }
  if (k < 0) { return; }
  var s = 0u;
  for (var j = base + n - d; j < base + n; j++) { s += watts[j]; }
  var best = 0u;
  var i = n - d;
  loop {
    best = max(best, s);
    loop {
      if (k < 0 || starts[r * P.K + u32(k)] != i) { break; }
      table[o + u32(k) * P.nDur] = best;
      k--;
    }
    if (i == 0u || k < 0) { break; }
    s = s - watts[base + i - 1u + d] + watts[base + i - 1u];
    i--;
  }
}
`;

// Samples per submit: enough to fill the GPU, small enough that no single
// submit runs long enough to trip a watchdog on a large history
const SAMPLES_PER_DISPATCH = 1 << 21;

export function webgpuAvailable() {
  return typeof navigator !== "undefined" && !!navigator.gpu;
}

// groupSamples lowers the per-binding sample cap so tests can exercise the split
export async function createFatigueGPU({ groupSamples = Infinity } = {}) {
  const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
  if (!adapter) return null;
  const maxBinding = adapter.limits.maxStorageBufferBindingSize;
  const device = await adapter.requestDevice({
    requiredLimits: { maxStorageBufferBindingSize: maxBinding, maxBufferSize: adapter.limits.maxBufferSize },
  });
  const pipeline = device.createComputePipeline({
    layout: "auto",
    compute: { module: device.createShaderModule({ code: SHADER }), entryPoint: "main" },
  });
  const maxSamples = Math.min(Math.floor(maxBinding / 4), 1 << 26, groupSamples);

  const storage = (src) => {
    const buf = device.createBuffer({
      size: Math.max(16, Math.ceil(src.byteLength / 4) * 4),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    if (src.byteLength) device.queue.writeBuffer(buf, 0, src);
    return buf;
  };

  // One group of whole rides whose samples fit a single storage binding
  async function runGroup(packed, durs, durBuf, r0, r1, out) {
    const { K } = packed;
    const D = durs.length;
    const first = packed.offsets[r0];
    const end = r1 < packed.count ? packed.offsets[r1] : packed.total;
    const offsets = packed.offsets.slice(r0, r1).map((o) => o - first);
    const bufs = [
      storage(packed.watts.subarray(first, end)),
      storage(offsets),
      storage(packed.lengths.subarray(r0, r1)),
      storage(packed.starts.subarray(r0 * K, r1 * K)),
    ];
    const tableBytes = (r1 - r0) * K * D * 4;
    const table = device.createBuffer({ size: tableBytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const params = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [...bufs, durBuf, table, params].map((buffer, binding) => ({ binding, resource: { buffer } })),
    });

    for (let a = r0; a < r1; ) {
      let b = a, samples = 0;
      while (b < r1 && b - a < 65535 && (b === a || samples + packed.lengths[b] <= SAMPLES_PER_DISPATCH)) {
        samples += packed.lengths[b++];
      }
      device.queue.writeBuffer(params, 0, Uint32Array.of(a - r0, b - a, D, K));
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(Math.ceil(D / 64), b - a);
      pass.end();
      device.queue.submit([enc.finish()]);
      a = b;
    }

    const read = device.createBuffer({ size: tableBytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = device.createCommandEncoder();
    enc.copyBufferToBuffer(table, 0, read, 0, tableBytes);
    device.queue.submit([enc.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    out.set(new Uint32Array(read.getMappedRange()), r0 * K * D);
    read.unmap();
    for (const buf of [...bufs, table, params, read]) buf.destroy();
  }

  return {
    kind: "webgpu",
    adapterInfo: adapter.info || null,
    async computeTable(packed, durations = DURATIONS) {
      const D = durations.length;
      const out = new Uint32Array(packed.count * packed.K * D);
      if (packed.count === 0) return out;
      const durBuf = storage(durations);
      const maxRides = Math.floor(maxBinding / (packed.K * D * 4));
      for (let r0 = 0; r0 < packed.count; ) {
        let r1 = r0 + 1, samples = packed.lengths[r0];
        while (r1 < packed.count && r1 - r0 < maxRides && samples + packed.lengths[r1] <= maxSamples) {
          samples += packed.lengths[r1++];
        }
        await runGroup(packed, durations, durBuf, r0, r1, out);
        r0 = r1;
      }
      durBuf.destroy();
      return out;
    },
    destroy() { device.destroy(); },
  };
}
