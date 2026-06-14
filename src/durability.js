/**
 * Durability — within-ride fatigue-resistance metrics (#TBD)
 *
 * Two metrics Strava does not surface, both computed from the per-second
 * watts + heartrate streams already fetched during sync:
 *
 *   1. Aerobic decoupling — matched-power HR cost, first half vs second half.
 *      The within-ride analogue of the athlete-level Efficiency Factor in
 *      fitness.js. A low number means power held steady against a steady HR
 *      cost: the signature of a durable aerobic engine.
 *
 *   2. Longest sustained block per HR zone — the longest *unbroken* stretch
 *      at or above each zone floor. The "Time in Zones" card shows cumulative
 *      time; this shows how long the rider can actually sit there.
 */

const MIN_SAMPLES = 600; // ~10 min; below this, within-ride splits are noise

function mean(arr) {
  let sum = 0, n = 0;
  for (const v of arr) {
    if (v != null) { sum += v; n++; }
  }
  return n ? sum / n : null;
}

/**
 * Matched-power decoupling: at a comparable power band, does the same output
 * cost more heartbeats late in the ride than early? Falls back to the
 * efficiency-factor split (avg power / avg HR per half) when too few samples
 * land in the matched band.
 *
 * @param {number[]} watts per-second power
 * @param {number[]} hr    per-second heart rate (same length / index as watts)
 * @returns {Object|null} { decouplingPct, firstHalfEf, secondHalfEf,
 *                          matched: { band, hrFirst, hrSecond, nFirst, nSecond } | null }
 */
export function computeDecoupling(watts, hr) {
  if (!watts || !hr) return null;
  const n = Math.min(watts.length, hr.length);
  if (n < MIN_SAMPLES) return null;

  const half = Math.floor(n / 2);
  const efFirst = ef(watts, hr, 0, half);
  const efSecond = ef(watts, hr, half, n);
  if (efFirst == null || efSecond == null || efFirst === 0) return null;

  const result = {
    decouplingPct: round1(((efFirst - efSecond) / efFirst) * 100),
    firstHalfEf: round2(efFirst),
    secondHalfEf: round2(efSecond),
    matched: null,
  };

  // Matched-power refinement: center a ±20% band on whole-ride average power.
  const avgW = mean(watts.slice(0, n));
  if (avgW && avgW > 0) {
    const lo = avgW * 0.8, hi = avgW * 1.2;
    const m = matchedHr(watts, hr, n, half, lo, hi);
    if (m && m.nFirst >= 30 && m.nSecond >= 30) {
      result.matched = {
        band: [Math.round(lo), Math.round(hi)],
        hrFirst: Math.round(m.hrFirst),
        hrSecond: Math.round(m.hrSecond),
        nFirst: m.nFirst,
        nSecond: m.nSecond,
      };
    }
  }
  return result;
}

function ef(watts, hr, a, b) {
  const w = mean(watts.slice(a, b));
  const h = mean(hr.slice(a, b));
  if (w == null || h == null || h === 0) return null;
  return w / h;
}

function matchedHr(watts, hr, n, half, lo, hi) {
  let s1 = 0, c1 = 0, s2 = 0, c2 = 0;
  for (let i = 0; i < n; i++) {
    const w = watts[i], h = hr[i];
    if (w == null || h == null || w < lo || w >= hi) continue;
    if (i < half) { s1 += h; c1++; } else { s2 += h; c2++; }
  }
  if (!c1 || !c2) return null;
  return { hrFirst: s1 / c1, hrSecond: s2 / c2, nFirst: c1, nSecond: c2 };
}

/**
 * Longest unbroken run (in samples ~= seconds) at or above each threshold,
 * plus cumulative seconds above each threshold.
 *
 * @param {number[]} hr           per-second heart rate
 * @param {number[]} thresholds   HR floors, ascending (e.g. [120,140,150,160])
 * @returns {Object|null} { byThreshold: [{ threshold, longestSec, totalSec }] }
 */
export function computeSustainedBlocks(hr, thresholds) {
  if (!hr || !hr.length || !thresholds || !thresholds.length) return null;
  const sorted = [...thresholds].sort((a, b) => a - b);
  const byThreshold = sorted.map((threshold) => {
    let longest = 0, run = 0, total = 0;
    for (const v of hr) {
      if (v != null && v >= threshold) {
        run++; total++;
        if (run > longest) longest = run;
      } else {
        run = 0;
      }
    }
    return { threshold, longestSec: longest, totalSec: total };
  });
  return { byThreshold };
}

function round1(x) { return Math.round(x * 10) / 10; }
function round2(x) { return Math.round(x * 100) / 100; }

/**
 * Convenience: compute both metrics from aligned streams in one pass.
 * Called by sync.js with the same streams used for the power curve.
 */
export function computeDurability(watts, hr, hrThresholds) {
  const decoupling = computeDecoupling(watts, hr);
  const blocks = hr && hrThresholds ? computeSustainedBlocks(hr, hrThresholds) : null;
  if (!decoupling && !blocks) return null;
  return { decoupling, blocks };
}
