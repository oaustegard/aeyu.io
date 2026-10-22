// Demo → /power on both engines: no page errors, all four curves, same CP fits.
//   node test/power-page-smoke.mjs [shotDir]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const shots = process.argv[2];
const port = 8000 + Math.floor(Math.random() * 1000);
const server = spawn('python3', ['-m', 'http.server', String(port)], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader',
    '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'],
});
const errors = [];
const results = {};
try {
  for (const [name, gpu, viewport] of [['gpu', true, { width: 1280, height: 900 }], ['cpu', false, { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' });
    if (!gpu) await ctx.addInitScript(() => { delete Navigator.prototype.gpu; });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${name} console: ${m.text()}`); });
    await page.goto(`http://localhost:${port}/demo.html`);
    await page.waitForFunction(() => sessionStorage.getItem('aeyu_demo_active') === 'true', null, { timeout: 30000 });
    await page.goto(`http://localhost:${port}/power.html`);
    try {
      await page.waitForFunction(() => window.__power && window.__power.cp, null, { timeout: 120000 });
    } catch (e) {
      errors.push(`${name}: no curve — ${(await page.textContent('body')).slice(0, 400)}`);
      await ctx.close();
      continue;
    }
    results[name] = await page.evaluate(() => ({ engine: window.__power.engine, rides: window.__power.rides, cp: window.__power.cp }));
    results[name].paths = await page.locator('[data-testid=power-chart] path').count();
    await page.waitForTimeout(1500);
    if (shots) await page.screenshot({ path: `${shots}/power-${name}.png`, fullPage: true });
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(JSON.stringify(results, null, 1));
const same = JSON.stringify(results.gpu?.cp) === JSON.stringify(results.cpu?.cp);
const ok = !errors.length && /webgpu/i.test(results.gpu?.engine) && /cpu/i.test(results.cpu?.engine) && same && results.gpu.paths === 4;
if (errors.length) console.log(errors.join('\n'));
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
