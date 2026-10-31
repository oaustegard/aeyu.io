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
    results[name].paths = await page.locator('[data-testid=power-chart] path[fill=none]').count();
    try {
      await page.waitForFunction(() => window.__power.wbal, null, { timeout: 60000 });
      results[name].wbal = await page.evaluate(() => window.__power.wbal);
      results[name].wbalCardCp = Number(await page.locator('[data-testid=wbal-cp]').textContent());
    } catch (e) {
      errors.push(`${name}: no W′ balance fit`);
    }
    await page.waitForTimeout(1500);
    if (shots) await page.screenshot({ path: `${shots}/power-${name}.png`, fullPage: true });
    const chart = page.locator('[data-testid=power-chart]');
    if (name === 'gpu') {
      await page.evaluate(() => document.querySelector('[data-testid=power-chart]').scrollIntoView({ block: 'center' }));
      const box = await chart.boundingBox();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
      for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -300);
      await page.waitForTimeout(300);
      results[name].zoomReset = await page.locator('[data-testid=power-reset-zoom]').count();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.4);
      await page.waitForTimeout(200);
      if (shots) await page.screenshot({ path: `${shots}/power-gpu-zoomed.png` });
      await page.locator('[data-testid=power-reset-zoom]').click();
      results[name].zoomResetGone = (await page.locator('[data-testid=power-reset-zoom]').count()) === 0;
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(200);
      const href = await page.locator('[data-testid=wbal-ride]').getAttribute('href');
      await page.locator('[data-testid=wbal-ride]').click();
      try {
        // The ride that sets the fit is indoor (no replay), so it gets the card
        await page.waitForSelector('[data-testid=wbal-card] [data-testid=wbal-cp]', { timeout: 30000 });
        await page.locator('[data-testid=wbal-card] [data-testid=help-wbal]').click();
        const cardHelp = await page.locator('[data-testid=help-wbal-text]').first().textContent();
        results[name].card = { href, cp: Number(await page.locator('[data-testid=wbal-cp]').textContent()), help: /W′ is the amount of work/.test(cardHelp) };
        // An outdoor ride gets W′ balance as a strip under the replay's elevation profile
        await page.goto(`http://localhost:${port}/activity.html?id=20000902`);
        await page.waitForSelector('[data-testid=replay-wbal] path', { timeout: 60000 });
        results[name].cardOnReplayRide = await page.locator('[data-testid=wbal-card]').count();
        const strip = page.locator('[data-testid=replay-wbal]');
        await strip.scrollIntoViewIfNeeded();
        const box = await strip.boundingBox();
        await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.7);
        await page.waitForTimeout(300);
        await page.locator('[data-testid=replay-wbal] [data-testid=help-wbal]').click();
        const helpText = await page.locator('[data-testid=help-wbal-text]').first().textContent();
        results[name].activity = { readout: await strip.textContent(), help: /W′ is the amount of work/.test(helpText) };
        await page.waitForTimeout(300);
        if (shots) await page.screenshot({ path: `${shots}/activity-wbal.png`, fullPage: true });
      } catch (e) {
        errors.push(`${name}: no W′ balance strip in the replay (${href}): ${e.message}`);
      }
    } else {
      await page.locator('[data-testid=power-fullscreen]').click();
      await page.waitForTimeout(500);
      const box = await chart.boundingBox();
      await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.5);
      await page.waitForTimeout(200);
      results[name].fullTooltip = await page.locator('[data-testid=power-tooltip]').count();
      if (shots) await page.screenshot({ path: `${shots}/power-cpu-fullscreen.png` });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      results[name].fullExited = (await chart.boundingBox()).height < 400;
    }
    await ctx.close();
  }
} finally {
  await browser.close();
  server.kill();
}
console.log(JSON.stringify(results, null, 1));
const same = JSON.stringify(results.gpu?.cp) === JSON.stringify(results.cpu?.cp);
const ok = !errors.length && /webgpu/i.test(results.gpu?.engine) && /cpu/i.test(results.cpu?.engine) && same && results.gpu.paths === 4
  && results.gpu.wbal && results.cpu.wbal && results.gpu.zoomReset === 1 && results.gpu.zoomResetGone
  && results.gpu.activity?.help && results.gpu.card?.help && results.gpu.cardOnReplayRide === 0 && /\d \/ \d/.test(results.gpu.activity.readout) && results.cpu.fullTooltip === 1 && results.cpu.fullExited;
if (errors.length) console.log(errors.join('\n'));
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
