/**
 * The melody of a sentence: where the voice goes up and down.
 * A YIN pitch tracker (difference function, cumulative mean normalisation),
 * then cleaning: octave slips folded back, blips dropped, a short median.
 * The result is for showing, not for judging: nothing here gives a score.
 */

export interface PitchTrack {
  /** Centre of each frame, in seconds. */
  times: number[];
  /** Pitch in Hz, or null where there is no voice (silence, "s", "t", breath). */
  hz: (number | null)[];
}

export interface SemitoneTrack {
  times: number[];
  /** Semitones above or below the speaker's own middle pitch. */
  st: (number | null)[];
  /** That middle pitch (median Hz), or null when nothing was voiced. */
  medianHz: number | null;
}

const F_MIN = 70;
const F_MAX = 400;
const HOP_SECONDS = 0.01;
/** Work at about this rate: plenty for pitch, and much faster than 48 kHz. */
const WORK_RATE = 16000;
/** How periodic a frame must be to count as voiced (0 = perfectly, 1 = not at all). */
const VOICED_BELOW = 0.2;
/** A dip must be this close to the best dip to be taken as the period. */
const NEAR_BEST = 0.1;
const MIN_RUN = 3;
const MEDIAN_SPAN = 5;

/** Average groups of `factor` samples: a cheap low-pass and downsample in one. */
function decimate(x: Float32Array, factor: number): Float32Array {
  if (factor <= 1) return x;
  const n = Math.floor(x.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < factor; j++) s += x[i * factor + j];
    out[i] = s / factor;
  }
  return out;
}

function median(values: number[]): number {
  const a = [...values].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Pitch over time, one reading every 10 ms. */
export function pitchTrack(samples: Float32Array, sampleRate: number): PitchTrack {
  const factor = Math.max(1, Math.floor(sampleRate / WORK_RATE));
  const x = decimate(samples, factor);
  const rate = sampleRate / factor;
  const hop = Math.max(1, Math.round(rate * HOP_SECONDS));
  const tauMin = Math.max(2, Math.floor(rate / F_MAX));
  const tauMax = Math.ceil(rate / F_MIN);
  const win = tauMax; // samples compared at each lag
  const frameLen = win + tauMax;

  const times: number[] = [];
  const hz: (number | null)[] = [];
  if (x.length < frameLen) return { times, hz };

  // loudness of every frame first, so "quiet" is relative to this recording
  const starts: number[] = [];
  const rms: number[] = [];
  let loudest = 0;
  for (let s = 0; s + frameLen <= x.length; s += hop) {
    let e = 0;
    for (let i = s; i < s + frameLen; i++) e += x[i] * x[i];
    const r = Math.sqrt(e / frameLen);
    starts.push(s);
    rms.push(r);
    if (r > loudest) loudest = r;
  }
  const gate = Math.max(0.002, loudest * 0.06);

  const d = new Float32Array(tauMax + 1);
  const frame = new Float32Array(frameLen);
  for (let f = 0; f < starts.length; f++) {
    const s = starts[f];
    times.push((s + frameLen / 2) / rate);
    if (rms[f] < gate) {
      hz.push(null);
      continue;
    }
    let mean = 0;
    for (let i = 0; i < frameLen; i++) mean += x[s + i];
    mean /= frameLen;
    for (let i = 0; i < frameLen; i++) frame[i] = x[s + i] - mean;

    // difference function, normalised by its running mean (YIN steps 2 and 3)
    d[0] = 1;
    let running = 0;
    let best = Infinity;
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let i = 0; i < win; i++) {
        const diff = frame[i] - frame[i + tau];
        sum += diff * diff;
      }
      running += sum;
      d[tau] = running > 0 ? (sum * tau) / running : 1;
      if (tau >= tauMin && d[tau] < best) best = d[tau];
    }
    if (!(best < VOICED_BELOW)) {
      hz.push(null);
      continue;
    }
    // the first dip that is nearly as deep as the deepest: the shortest true period,
    // which keeps a strong second harmonic from being read as the pitch
    const limit = Math.min(VOICED_BELOW, best + NEAR_BEST);
    let tau = -1;
    for (let t = tauMin; t <= tauMax; t++) {
      if (d[t] < limit) {
        while (t + 1 <= tauMax && d[t + 1] < d[t]) t++;
        tau = t;
        break;
      }
    }
    if (tau < 0) {
      hz.push(null);
      continue;
    }
    // parabola through the dip and its neighbours for a finer period
    let period = tau;
    if (tau > 1 && tau < tauMax) {
      const a = d[tau - 1];
      const b = d[tau];
      const c = d[tau + 1];
      const den = a - 2 * b + c;
      if (den > 0) period = tau + (0.5 * (a - c)) / den;
    }
    const f0 = rate / period;
    hz.push(f0 >= F_MIN && f0 <= F_MAX ? f0 : null);
  }

  return { times, hz: clean(hz) };
}

/** Fold octave slips back, drop blips, then smooth with a short median. */
function clean(raw: (number | null)[]): (number | null)[] {
  const hz = [...raw];
  const voiced = hz.filter((v): v is number => v !== null);
  if (!voiced.length) return hz;

  // octave guard: a frame an octave away from its neighbours is moved back
  const SPAN = 8;
  for (let i = 0; i < hz.length; i++) {
    const v = hz[i];
    if (v === null) continue;
    const near: number[] = [];
    for (let j = Math.max(0, i - SPAN); j <= Math.min(hz.length - 1, i + SPAN); j++) {
      const w = raw[j];
      if (j !== i && w !== null) near.push(w);
    }
    if (near.length < 3) continue;
    const ref = median(near);
    const ratio = v / ref;
    if (ratio > 1.75 && ratio < 2.3) hz[i] = v / 2;
    else if (ratio > 0.43 && ratio < 0.57) hz[i] = v * 2;
  }

  // voiced runs shorter than 30 ms are clicks, not voice
  for (let i = 0; i < hz.length; ) {
    if (hz[i] === null) {
      i++;
      continue;
    }
    let j = i;
    while (j < hz.length && hz[j] !== null) j++;
    if (j - i < MIN_RUN) for (let k = i; k < j; k++) hz[k] = null;
    i = j;
  }

  // median over the voiced neighbours; gaps stay gaps
  const half = MEDIAN_SPAN >> 1;
  return hz.map((v, i) => {
    if (v === null) return null;
    const near: number[] = [];
    for (let j = Math.max(0, i - half); j <= Math.min(hz.length - 1, i + half); j++) {
      const w = hz[j];
      if (w !== null) near.push(w);
    }
    return median(near);
  });
}

/** The same track measured from the speaker's own middle pitch, so a low and a high voice can be compared. */
export function toSemitones(track: PitchTrack): SemitoneTrack {
  const voiced = track.hz.filter((v): v is number => v !== null);
  if (!voiced.length) return { times: track.times, st: track.hz.map(() => null), medianHz: null };
  const mid = median(voiced);
  return {
    times: track.times,
    st: track.hz.map((v) => (v === null ? null : 12 * Math.log2(v / mid))),
    medianHz: mid,
  };
}

/**
 * Stretch a track onto `points` evenly spaced steps from its first voiced
 * frame to its last, so two takes of different lengths line up end to end.
 * Null where the voice stops. Null overall when there is too little voice.
 */
export function onUnitTime(track: SemitoneTrack, points = 160): (number | null)[] | null {
  const { st } = track;
  let first = 0;
  while (first < st.length && st[first] === null) first++;
  let last = st.length - 1;
  while (last >= 0 && st[last] === null) last--;
  if (last - first < 4) return null;
  const out: (number | null)[] = [];
  for (let p = 0; p < points; p++) {
    const pos = first + (p / (points - 1)) * (last - first);
    const i = Math.floor(pos);
    const a = st[i];
    const b = st[Math.min(last, i + 1)];
    const t = pos - i;
    if (a !== null && b !== null) out.push(a + (b - a) * t);
    else out.push(t < 0.5 ? a : b);
  }
  return out;
}

/** Samples in, drawable melody out: semitones from the speaker's middle, on a 0..1 time axis. */
export function contour(samples: Float32Array, sampleRate: number, points = 160): (number | null)[] | null {
  return onUnitTime(toSemitones(pitchTrack(samples, sampleRate)), points);
}
