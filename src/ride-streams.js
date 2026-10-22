/**
 * Full per-second ride streams (#302), kept for every power ride in compact
 * typed arrays: about 8 bytes per sample.
 */

export const RIDE_STREAM_KEYS = ["time", "watts", "heartrate", "cadence", "velocity_smooth", "altitude"];

// Recording gaps up to this long are smart recording (the sample covers the
// seconds since the last one); longer gaps are stops and count as 0 W
export const MAX_HOLD_SECONDS = 10;

function pack(src, Type, scale = 1, offset = 0) {
  if (!src) return null;
  const max = Type === Uint8Array ? 255 : 65535;
  const out = new Type(src.length);
  for (let i = 0; i < src.length; i++) {
    const v = Math.round(((src[i] ?? 0) - offset) * scale);
    out[i] = v < 0 ? 0 : v > max ? max : v;
  }
  return out;
}

// The time stream is almost always +1 s per sample, so only the samples
// where it is not are kept, as [index, time] pairs; the first sample always is
export function timeJumps(time) {
  const out = [0, time[0] ?? 0];
  for (let i = 1; i < time.length; i++) {
    if (time[i] !== time[i - 1] + 1) out.push(i, time[i] ?? 0);
  }
  return Uint32Array.from(out);
}

export function sampleTimes(rec) {
  const t = new Uint32Array(rec.n);
  const j = rec.time_jumps;
  for (let p = 0; p < j.length; p += 2) {
    const end = p + 2 < j.length ? j[p + 2] : rec.n;
    for (let i = j[p], v = j[p + 1]; i < end; i++) t[i] = v++;
  }
  return t;
}

/**
 * Strava's key_by_type stream response → stored record. Returns null when
 * there is no time stream to hang the others on.
 */
export function encodeRideStreams(id, raw) {
  const time = raw?.time?.data;
  if (!time || time.length === 0) return null;
  const alt = raw.altitude?.data || null;
  let altBase = 0;
  if (alt) {
    altBase = Infinity;
    for (const a of alt) if (a != null && a < altBase) altBase = a;
    altBase = altBase === Infinity ? 0 : Math.floor(altBase);
  }
  return {
    id,
    n: time.length,
    time_jumps: timeJumps(time),
    watts: pack(raw.watts?.data, Uint16Array),
    heartrate: pack(raw.heartrate?.data, Uint8Array),
    cadence: pack(raw.cadence?.data, Uint8Array),
    velocity: pack(raw.velocity_smooth?.data, Uint16Array, 100), // cm/s
    altitude: pack(alt, Uint16Array, 10, altBase), // dm above altitude_base
    altitude_base: altBase,
  };
}

/** Stored record → plain per-sample arrays in Strava's units. */
export function decodeRideStreams(rec) {
  const scaled = (a, k, b = 0) => (a ? Array.from(a, (v) => v / k + b) : null);
  return {
    time: Array.from(sampleTimes(rec)),
    watts: rec.watts ? Array.from(rec.watts) : null,
    heartrate: rec.heartrate ? Array.from(rec.heartrate) : null,
    cadence: rec.cadence ? Array.from(rec.cadence) : null,
    velocity_smooth: scaled(rec.velocity, 100),
    altitude: scaled(rec.altitude, 10, rec.altitude_base),
  };
}

export function recordBytes(rec) {
  let b = 0;
  for (const k of ["time_jumps", "watts", "heartrate", "cadence", "velocity", "altitude"]) {
    if (rec[k]) b += rec[k].byteLength;
  }
  return b;
}

/**
 * Power on the elapsed-time clock, one value per second. A sample's value
 * fills the seconds since the previous sample when the gap is short; across a
 * longer gap the rider was stopped, so those seconds are zero.
 */
export function wattsPerSecond(rec, maxHold = MAX_HOLD_SECONDS) {
  if (!rec?.watts || !rec.n) return null;
  const { watts } = rec;
  const time = sampleTimes(rec);
  const t0 = time[0];
  const out = new Uint16Array(time[rec.n - 1] - t0 + 1);
  out[0] = watts[0];
  for (let k = 1; k < rec.n; k++) {
    const t = time[k] - t0, prev = time[k - 1] - t0;
    if (t <= prev) continue;
    const from = t - prev <= maxHold ? prev + 1 : t;
    out.fill(watts[k], from, t + 1);
  }
  return out;
}
