// The main flow of aeyu.io in headless Chromium: landing -> "try the demo" -> dashboard ->
// an activity with awards -> back -> exit demo -> demo again. Then the fatigue kernel's
// GPU-vs-CPU differential (test/fatigue-gpu-check.mjs) unless --no-gpu.
//   node .claude/skills/verify/verify.mjs [--no-gpu] [--base URL] [--shots DIR]
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PW = '/opt/node-tools/node_modules';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(join(PW, 'playwright'))); }

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const shots = arg('--shots');
if (shots) mkdirSync(shots, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); return ok; };
const freePort = () => new Promise((ok) => { const s = createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });

let server = null;
let base = arg('--base');
if (!base) {
  const port = await freePort();
  server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 10000;
  for (;;) {
    try { if ((await fetch(base + '/index.html', { method: 'HEAD' })).ok) break; } catch {}
    if (Date.now() > deadline) { console.log('FAIL local server did not start'); process.exit(1); }
    await new Promise((r) => setTimeout(r, 50));
  }
}
const origin = new URL(base).origin;
const t0 = Date.now();
const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
const browser = await chromium.launch({
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader',
    '--use-angle=swiftshader', '--use-webgpu-adapter=swiftshader'],
  proxy: !server && proxy ? { server: proxy } : undefined,
});
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
  // Only the app's own origin loads. Google Fonts and Strava are aborted, so their
  // availability cannot change the result (the demo must work without Strava anyway).
  const strava = [];
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (/(^|\.)strava\.com$/.test(u.hostname)) strava.push(u.pathname);
    return u.origin === origin ? r.continue() : r.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message.split('\n')[0]}`));
  page.on('console', (m) => {
    // aborted third-party requests log "Failed to load resource"; same-origin failures are caught below
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on('response', (r) => { if (r.url().startsWith(origin) && r.status() >= 400) errors.push(`${r.status()} ${new URL(r.url()).pathname}`); });
  const shot = (n) => shots && page.screenshot({ path: join(shots, `${n}.png`), fullPage: false });
  const text = () => page.locator('body').innerText();
  const until = (re, ms = 20000) => page.waitForFunction((src) => new RegExp(src).test(document.body.innerText), re.source, { timeout: ms }).then(() => true, () => false);

  // 1. Landing
  await page.goto(base + '/');
  await until(/or try the demo/, 10000);
  const landing = await text();
  const connect = page.getByAltText('Connect with Strava').first();
  const connectOk = await connect.isVisible().catch(() => false)
    && await connect.evaluate((img) => img.complete && img.naturalWidth > 0).catch(() => false);
  check('landing: renders the pitch, the Connect with Strava button and the demo link',
    /Participation Awards/.test(landing) && connectOk && /or try the demo/.test(landing));
  await shot('1-landing');

  // 2. Demo from the landing page's own button
  let t = Date.now();
  await page.getByText('or try the demo →').first().click();
  const dash = await until(/Recent Activities/);
  check('demo: the landing button reaches the dashboard', dash, dash ? `${Date.now() - t} ms` : `stuck on "${(await text()).slice(0, 60).replace(/\n/g, ' ')}" at ${page.url()}`);
  if (dash) {
    const body = await text();
    const awards = +(body.match(/(\d+)\s*\n\s*Awards/) || [])[1] || 0;
    check('dashboard: demo banner, awards counted', /Demo Mode/.test(body) && awards > 0, `${awards} awards`);
    const cards = page.locator('button', { hasText: '·' });
    check('dashboard: activity cards listed', (await cards.count()) >= 5, `${await cards.count()} cards`);
    await shot('2-dashboard');

    // 3. An activity that earned awards: the first card with award chips
    const withAwards = page.locator('button:has(div.flex.flex-wrap)', { hasText: '·' }).first();
    const name = (await withAwards.locator('div').first().innerText()).trim();
    t = Date.now();
    await withAwards.click();
    const detail = await until(/Segment Efforts/);
    check(`activity "${name}": detail page opens`, detail && /\/activity\?id=/.test(page.url()), `${Date.now() - t} ms, ${page.url().replace(origin, '')}`);
    if (detail) {
      const d = await text();
      check('activity: shows its name and segment efforts', d.includes(name) && /Segment Efforts/.test(d));
      // the replay mounts its canvases once its streams load, after the page itself
      const replay = await page.waitForFunction(() => document.querySelectorAll('canvas').length >= 3 && document.querySelectorAll('canvas').length, null, { timeout: 10000 })
        .then((h) => h.jsonValue(), async () => page.locator('canvas').count());
      check('activity: ride replay canvases mounted', replay >= 3, `${replay} canvases`);
      await shot('3-activity');
    }

    // 4. Back to the dashboard
    await page.goBack();
    check('back: returns to the demo dashboard', await until(/Recent Activities/, 10000));

    // 5. Exit the demo from the avatar menu, then enter it again
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('header button[title$="menu"], header button[title="Menu"]').first().click({ timeout: 5000 }).catch(() => {});
    const exit = page.getByText('Exit Demo').first();
    if (await exit.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) {
      await exit.click();
      const back = await until(/or try the demo/, 10000);
      check('exit demo: back on the landing page', back);
      if (back) {
        t = Date.now();
        await page.getByText('or try the demo →').first().click();
        const again = await until(/Recent Activities/);
        check('demo again after exiting: dashboard loads', again, again ? `${Date.now() - t} ms` : `stuck on "${(await text()).slice(0, 60).replace(/\n/g, ' ')}"`);
      }
    } else {
      check('exit demo: "Exit Demo" found in the avatar menu', false);
    }
  }
  // _FEATURES.md invariant: demo mode needs no Strava token and no Strava API access
  check('no request to Strava during the demo', strava.length === 0, strava.slice(0, 3).join(', '));
  check('no page errors, console errors or failed requests', errors.length === 0, errors.slice(0, 5).join(' | '));
} finally {
  await browser.close();
  server?.kill();
}
console.log(`flow: ${results.filter(Boolean).length}/${results.length} in ${Date.now() - t0} ms`);

// 6. Fatigue kernel: GPU table must equal the CPU reference cell for cell (SwiftShader).
if (!argv.includes('--no-gpu') && !arg('--base')) {
  const nm = join(ROOT, 'node_modules');   // the check imports 'playwright' as ESM, which ignores NODE_PATH
  for (const p of ['playwright', 'playwright-core']) {
    if (!existsSync(join(nm, p)) && existsSync(join(PW, p))) { mkdirSync(nm, { recursive: true }); symlinkSync(join(PW, p), join(nm, p)); }
  }
  const t1 = Date.now();
  const r = spawnSync('node', ['test/fatigue-gpu-check.mjs'], { cwd: ROOT, encoding: 'utf8', timeout: 180000 });
  const last = (r.stdout || '').trim().split('\n').pop();
  check('fatigue kernel: GPU table == CPU reference (test/fatigue-gpu-check.mjs)', r.status === 0 && last === 'PASS',
    `${Date.now() - t1} ms${r.status === 0 ? '' : `; exit ${r.status}: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ')}`}`);
}
const failed = results.filter((x) => !x).length;
console.log(`${failed ? 'FAILED' : 'OK'}: ${results.length - failed}/${results.length} checks in ${Date.now() - t0} ms`);
process.exit(failed ? 1 : 0);
