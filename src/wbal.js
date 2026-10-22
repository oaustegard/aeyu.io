/**
 * W′ balance (Skiba 2015 differential form, after Froncioni and Clarke) and a
 * CP/W′ fit from it. Above CP the reservoir drains by P − CP each second;
 * below CP the deficit decays by exp(−(CP − P)/W′) each second.
 *
 * The MMP fit in critical-power.js treats every best effort as if it started
 * fresh. This fit replays whole rides instead, so efforts that began with W′
 * already part spent count for what they were: CP and W′ are chosen so the
 * hardest rides drain W′ to about zero and no ride drains it below.
 */

import { CP_FIT_DURATIONS } from "./critical-power.js";

export function wbalSeries(watts, cp, wPrime) {
  const out = new Float32Array(watts.length);
  let deficit = 0;
  for (let i = 0; i < watts.length; i++) {
    const p = watts[i];
    if (p > cp) deficit += p - cp;
    else deficit *= Math.exp(-(cp - p) / wPrime);
    out[i] = wPrime - deficit;
  }
  return out;
}

/**
 * Deepest deficit over the ride, in joules, and the second it occurred.
 * Watts are integers, so the per-second recovery factor is a table lookup.
 */
export function maxDeficit(watts, cp, wPrime, decay = recoveryTable(cp, wPrime)) {
  let deficit = 0, max = 0, at = 0;
  for (let i = 0; i < watts.length; i++) {
    const p = watts[i];
    if (p > cp) {
      deficit += p - cp;
      if (deficit > max) { max = deficit; at = i; }
    } else if (deficit > 0) {
      deficit *= decay[p];
      if (deficit < 0.5) deficit = 0;
    }
  }
  return { max, at };
}

function recoveryTable(cp, wPrime) {
  const t = new Float64Array(Math.floor(cp) + 1);
  for (let p = 0; p < t.length; p++) t[p] = Math.exp(-(cp - p) / wPrime);
  return t;
}

/**
 * Rides holding the best efforts at the CP fit durations, top `perDuration`
 * each, from bin 0 of the fatigue table. Returns ride indices.
 */
export function pickFitRides(table, packed, durations, include = null, perDuration = 3) {
  const { K, count } = packed;
  const D = durations.length;
  const picked = new Set();
  for (const d of CP_FIT_DURATIONS) {
    const di = durations.indexOf(d);
    if (di < 0) continue;
    const top = [];
    for (let r = 0; r < count; r++) {
      if (include && !include[r]) continue;
      const v = table[r * K * D + di];
      if (v > 0) top.push([v, r]);
    }
    top.sort((a, b) => b[0] - a[0]);
    for (const [, r] of top.slice(0, perDuration)) picked.add(r);
  }
  return [...picked];
}

// Going below zero is a contradiction (more work above CP than W′ holds);
// stopping short of zero only means the ride wasn't all-out
const OVERDRAW_WEIGHT = 20;

function loss(rides, cp, wPrime) {
  const decay = recoveryTable(cp, wPrime);
  let s = 0;
  for (const w of rides) {
    const g = 1 - maxDeficit(w, cp, wPrime, decay).max / wPrime;
    s += g < 0 ? OVERDRAW_WEIGHT * g * g : g * g;
  }
  return s;
}

function search(rides, cps, wps) {
  let best = null;
  for (const cp of cps) {
    for (const wp of wps) {
      const l = loss(rides, cp, wp);
      if (!best || l < best.loss) best = { cp, wPrime: wp, loss: l };
    }
  }
  return best;
}

const range = (lo, hi, step) => {
  const out = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(v);
  return out;
};

/**
 * rides: per-second watts arrays (Uint16Array). cpGuess seeds the search
 * window, usually the MMP fit. Three passes, each centred on the last best:
 * 8 W × 2 kJ, then 2 W × 500 J, then 1 W × 100 J. Returns null with fewer
 * than two rides.
 */
export function fitWbal(rides, cpGuess) {
  if (rides.length < 2 || !(cpGuess > 0)) return null;
  let best = search(
    rides,
    range(Math.round(cpGuess * 0.7), Math.round(cpGuess * 1.3), 8),
    range(4000, 50000, 2000),
  );
  for (const [dc, cs, dw, ws] of [[8, 2, 2000, 500], [2, 1, 500, 100]]) {
    best = search(
      rides,
      range(best.cp - dc, best.cp + dc, cs),
      range(Math.max(1000, best.wPrime - dw), best.wPrime + dw, ws),
    );
  }
  const perRide = rides.map((w) => {
    const { max, at } = maxDeficit(w, best.cp, best.wPrime);
    return { minBalance: best.wPrime - max, at };
  });
  return { cp: best.cp, wPrime: Math.round(best.wPrime), loss: best.loss, perRide };
}

let worker = null;
let seq = 0;

/**
 * fitWbal off the main thread when module workers are available, so a filter
 * drag doesn't stall on the ~0.5 s search. Resolves to the same result.
 */
export function fitWbalAsync(rides, cpGuess) {
  if (typeof Worker === "undefined") return Promise.resolve(fitWbal(rides, cpGuess));
  try {
    worker = worker || new Worker(new URL("./wbal-worker.js", import.meta.url), { type: "module" });
  } catch (e) {
    console.warn("W′ balance worker unavailable:", e);
    return Promise.resolve(fitWbal(rides, cpGuess));
  }
  const id = ++seq;
  return new Promise((resolve) => {
    const done = (fit) => {
      worker.removeEventListener("message", onMsg);
      worker.removeEventListener("error", onErr);
      resolve(fit);
    };
    const onMsg = (e) => { if (e.data.id === id) done(e.data.fit); };
    const onErr = (e) => {
      console.warn("W′ balance worker failed:", e.message);
      worker = null;
      done(fitWbal(rides, cpGuess));
    };
    worker.addEventListener("message", onMsg);
    worker.addEventListener("error", onErr);
    worker.postMessage({ id, rides: rides.map((w) => w.slice()), cpGuess });
  });
}
