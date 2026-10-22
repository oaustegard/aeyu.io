// Bytes per ride-hour of stored streams, as IndexedDB reports it in Chromium.
//   node test/stream-storage-measure.mjs
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const port = 8000 + Math.floor(Math.random() * 1000);
const server = spawn('python3', ['-m', 'http.server', String(port)], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`http://localhost:${port}/power-bench.html`);
  const res = await page.evaluate(async () => {
    const { encodeRideStreams, recordBytes } = await import('/src/ride-streams.js');
    let seed = 5;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    // Strava-shaped streams: 1 Hz with a few pauses, noisy power, smooth HR/speed/altitude
    function rawRide(sec) {
      const time = [], watts = [], heartrate = [], cadence = [], velocity_smooth = [], altitude = [];
      let t = 0, hr = 110, v = 8, alt = 120;
      for (let i = 0; i < sec; i++) {
        t += rnd() < 0.002 ? 30 + Math.floor(rnd() * 300) : 1;
        time.push(t);
        const w = rnd() < 0.08 ? 0 : Math.round(200 + 120 * (rnd() - 0.5) + 80 * Math.sin(i / 200));
        watts.push(w);
        hr += ((100 + w / 4) - hr) / 30; heartrate.push(Math.round(hr));
        cadence.push(w ? 80 + Math.floor(rnd() * 15) : 0);
        v += (rnd() - 0.5) * 0.2; v = Math.min(14, Math.max(3, v)); velocity_smooth.push(+v.toFixed(2));
        alt += (rnd() - 0.5) * 0.4 + 0.05 * Math.sin(i / 500); altitude.push(+alt.toFixed(1));
      }
      return Object.fromEntries(Object.entries({ time, watts, heartrate, cadence, velocity_smooth, altitude }).map(([k, d]) => [k, { data: d }]));
    }
    const open = (name) => new Promise((res, rej) => {
      const q = indexedDB.open(name, 1);
      q.onupgradeneeded = () => q.result.createObjectStore('s', { keyPath: 'id' });
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
    const put = (db, recs) => new Promise((res, rej) => {
      const tx = db.transaction('s', 'readwrite');
      for (const r of recs) tx.objectStore('s').put(r);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    const RIDES = 40, HOURS = 2;
    const raws = Array.from({ length: RIDES }, () => rawRide(HOURS * 3600));
    const out = {};
    for (const [label, make] of [
      ['typed', (raw, i) => encodeRideStreams(i, raw)],
      ['json_arrays', (raw, i) => ({ id: i, ...Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.data])) })],
    ]) {
      const before = (await navigator.storage.estimate()).usage;
      const db = await open('measure-' + label);
      const recs = raws.map(make);
      await put(db, recs);
      db.close();
      await new Promise((r) => setTimeout(r, 1500));
      const after = (await navigator.storage.estimate()).usage;
      out[label] = {
        idbBytesPerRideHour: Math.round((after - before) / (RIDES * HOURS)),
        ...(label === 'typed' && { rawBytesPerRideHour: Math.round(recs.reduce((s, r) => s + recordBytes(r), 0) / (RIDES * HOURS)) }),
      };
    }
    return out;
  });
  console.log(JSON.stringify(res, null, 2));
} finally {
  await browser.close();
  server.kill();
}
