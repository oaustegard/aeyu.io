// GPU vs CPU equality for the fatigue curve table, in headless Chromium on
// SwiftShader. Correctness only: SwiftShader timings say nothing about a real GPU.
//   node test/fatigue-gpu-check.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = 8000 + Math.floor(Math.random() * 1000);
const server = spawn('python3', ['-m', 'http.server', String(port)], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));

const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader',
    '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'],
});
let failed = false;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => { console.error('pageerror:', e.message); failed = true; });
  await page.goto(`http://localhost:${port}/power-bench.html`);
  const res = await page.evaluate(async () => {
    const fc = await import('/src/fatigue-curve.js');
    const { createFatigueGPU } = await import('/src/fatigue-gpu.js');
    const gpu = await createFatigueGPU();
    if (!gpu) return { error: 'no adapter' };
    let seed = 99;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const ride = (n, hi = 1200) => ({ watts: Uint16Array.from({ length: n }, () => (rnd() < 0.1 ? 0 : Math.floor(rnd() * hi))) });
    const cases = {
      // lengths straddling durations, the 5 h maximum, and a 1-sample ride
      edges: [ride(1), ride(2), ride(59), ride(60), ride(61), ride(1199), ride(18000), ride(18001), ride(21000), ride(5)],
      // power near the Uint16 ceiling over the longest window: sums near 2^30
      big: [ride(18000, 65535), ride(20000, 65535)],
      many: Array.from({ length: 300 }, () => ride(200 + Math.floor(rnd() * 9000))),
      empty: [],
    };
    const out = {};
    for (const [name, rides] of Object.entries(cases)) {
      for (const bins of [fc.KJ_BINS, [0, 50, 100, 200, 400, 800, 1600]]) {
        const p = fc.packRides(rides, bins);
        const cpu = fc.computeTableCPU(p);
        const g = await gpu.computeTable(p);
        let bad = 0, first = -1;
        for (let i = 0; i < cpu.length; i++) if (cpu[i] !== g[i]) { bad++; if (first < 0) first = i; }
        out[`${name}/K${bins.length}`] = { cells: cpu.length, mismatches: bad, first, len: g.length === cpu.length };
      }
    }
    gpu.destroy();
    // Small groups and dispatches: rides split across storage bindings
    const split = await createFatigueGPU({ groupSamples: 20000 });
    const p = fc.packRides(cases.many.slice(0, 60));
    const cpu = fc.computeTableCPU(p);
    const g = await split.computeTable(p);
    out['many/split-groups'] = { cells: cpu.length, mismatches: cpu.filter((v, i) => v !== g[i]).length, first: -1, len: g.length === cpu.length };
    split.destroy();
    return out;
  });
  console.log(JSON.stringify(res, null, 1));
  if (res.error) failed = true;
  for (const v of Object.values(res)) if (v.mismatches || !v.len) failed = true;

  await page.goto(`http://localhost:${port}/power-bench.html?quick`);
  await page.click('#run');
  await page.waitForFunction(() => !document.getElementById('copy').disabled, null, { timeout: 120000 });
  const bench = JSON.parse(await page.textContent('#out'));
  console.log('bench page:', JSON.stringify(bench.runs.map((r) => ({ rides: r.rides, match: r.match }))));
  if (!bench.runs.every((r) => r.match)) failed = true;
} finally {
  await browser.close();
  server.kill();
}
console.log(failed ? 'FAIL' : 'PASS');
process.exit(failed ? 1 : 0);
