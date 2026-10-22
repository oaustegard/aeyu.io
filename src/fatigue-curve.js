/**
 * Fatigue-adjusted power curve (#302): best mean power at every duration from
 * 1 s to 5 h, split by how much work the ride had already done when the
 * effort started. Bin k holds efforts that began after at least KJ_BINS[k] kJ,
 * so bin 0 is the ordinary power curve and each later bin sits under it.
 *
 * The expensive step is one table per ride: for every (ride, bin, duration)
 * the best window sum in integer joules. The WebGPU kernel in fatigue-gpu.js
 * computes exactly the same table; filters only reduce it, so they are cheap.
 */

import { CP_FIT_DURATIONS, estimateCriticalPower } from "./critical-power.js";
import { POWER_CURVE_DURATIONS } from "./power-curve.js";

export const KJ_BINS = [0, 1000, 2000, 3000];
export const MAX_DURATION = 5 * 3600;
export const NONE = 0xffffffff;

// Every second to a minute, then ~4% steps to 5 h, plus the durations the
// CP fit and the existing power curve read
function durationGrid() {
  const set = new Set([...CP_FIT_DURATIONS, ...POWER_CURVE_DURATIONS]);
  for (let d = 1; d <= 60; d++) set.add(d);
  for (let d = 60; d < MAX_DURATION; d *= 1.04) {
    const step = d < 600 ? 5 : d < 3600 ? 30 : 60;
    set.add(Math.round(d / step) * step);
  }
  set.add(MAX_DURATION);
  return Uint32Array.from([...set].sort((a, b) => a - b));
}

export const DURATIONS = durationGrid();

/**
 * Concatenate rides into the flat buffers both engines read.
 * rides: [{ watts: Uint16Array one value per second }]
 * starts[r*K + k] is the first second at which ride r has done KJ_BINS[k] kJ,
 * or NONE if it never does.
 */
export function packRides(rides, kjBins = KJ_BINS) {
  const K = kjBins.length;
  const count = rides.length;
  const offsets = new Uint32Array(count);
  const lengths = new Uint32Array(count);
  let total = 0;
  for (let r = 0; r < count; r++) {
    offsets[r] = total;
    lengths[r] = rides[r].watts.length;
    total += lengths[r];
  }
  const watts = new Uint32Array(total);
  const starts = new Uint32Array(count * K).fill(NONE);
  for (let r = 0; r < count; r++) {
    const w = rides[r].watts;
    watts.set(w, offsets[r]);
    let work = 0, k = 0;
    for (let i = 0; i < w.length && k < K; i++) {
      while (k < K && work >= kjBins[k] * 1000) starts[r * K + k++] = i;
      work += w[i];
    }
  }
  return { count, K, total, offsets, lengths, watts, starts };
}

/**
 * Reference implementation of the per-ride table.
 * out[(r*K + k)*D + di] = max sum of watts over durations[di] consecutive
 * seconds starting at or after starts[r*K + k]; 0 when no such window fits.
 * Walks window starts backward so one pass per duration covers every bin.
 */
export function computeTableCPU(packed, durations = DURATIONS, rideFrom = 0, rideTo = packed.count, out = null) {
  const { K, offsets, lengths, watts: w, starts } = packed;
  const D = durations.length;
  out = out || new Uint32Array(packed.count * K * D);
  for (let r = rideFrom; r < rideTo; r++) {
    const base = offsets[r], n = lengths[r];
    for (let di = 0; di < D; di++) {
      const d = durations[di];
      const o = r * K * D + di;
      for (let k = 0; k < K; k++) out[o + k * D] = 0;
      if (d > n) continue;
      let k = K - 1;
      while (k >= 0 && starts[r * K + k] > n - d) k--;
      if (k < 0) continue;
      let s = 0;
      for (let j = base + n - d; j < base + n; j++) s += w[j];
      let best = 0;
      for (let i = n - d; ; i--) {
        if (s > best) best = s;
        while (k >= 0 && starts[r * K + k] === i) out[o + k-- * D] = best;
        if (i === 0 || k < 0) break;
        s += w[base + i - 1] - w[base + i - 1 + d];
      }
    }
  }
  return out;
}

/**
 * Best curve per bin over the rides `include` admits (a Uint8Array mask, or
 * null for all). watts[di] is mean power in W, 0 where no ride qualifies;
 * ride[di] is the index of the ride that set it, -1 if none.
 */
export function reduceCurves(table, packed, include = null, durations = DURATIONS) {
  const { K, count } = packed;
  const D = durations.length;
  const bins = [];
  for (let k = 0; k < K; k++) {
    const best = new Float64Array(D);
    const ride = new Int32Array(D).fill(-1);
    for (let r = 0; r < count; r++) {
      if (include && !include[r]) continue;
      const o = (r * K + k) * D;
      for (let di = 0; di < D; di++) {
        if (table[o + di] > best[di]) { best[di] = table[o + di]; ride[di] = r; }
      }
    }
    const watts = new Float64Array(D);
    for (let di = 0; di < D; di++) watts[di] = best[di] / durations[di];
    bins.push({ watts, ride });
  }
  return bins;
}

/** CP/W′ fit for one reduced bin, through the same model the dashboard uses. */
export function fitBin(bin, durations = DURATIONS) {
  const curve = {};
  for (const d of CP_FIT_DURATIONS) {
    const di = durations.indexOf(d);
    if (di >= 0 && bin.watts[di] > 0) curve[d] = bin.watts[di];
  }
  return estimateCriticalPower(curve);
}
