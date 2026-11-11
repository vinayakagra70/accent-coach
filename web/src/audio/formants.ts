/**
 * Live vowel formant tracking (F1, F2) with linear prediction (LPC).
 *
 * F1 roughly follows how low the tongue/jaw is (higher F1 = more open).
 * F2 roughly follows how far forward the tongue is (higher F2 = more front).
 * That is what lets the 3D tongue mirror the user's own voice.
 */

export interface FormantReading {
  f1: number;
  f2: number;
  /** 0..1 signal level. */
  level: number;
}

const TARGET_RATE = 11025;
const ORDER = 12;

function decimate(input: Float32Array, factor: number): Float32Array {
  const n = Math.floor(input.length / factor);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < factor; j++) s += input[i * factor + j];
    out[i] = s / factor;
  }
  return out;
}

function autocorr(x: Float32Array, order: number): Float64Array {
  const r = new Float64Array(order + 1);
  for (let k = 0; k <= order; k++) {
    let s = 0;
    for (let i = k; i < x.length; i++) s += x[i] * x[i - k];
    r[k] = s;
  }
  return r;
}

/** Levinson-Durbin: returns LPC coefficients a[0..order] with a[0] = 1. */
function levinson(r: Float64Array, order: number): Float64Array | null {
  const a = new Float64Array(order + 1);
  const tmp = new Float64Array(order + 1);
  a[0] = 1;
  let err = r[0];
  if (err <= 0) return null;
  for (let i = 1; i <= order; i++) {
    let acc = r[i];
    for (let j = 1; j < i; j++) acc += a[j] * r[i - j];
    const k = -acc / err;
    tmp.set(a);
    for (let j = 1; j < i; j++) a[j] = tmp[j] + k * tmp[i - j];
    a[i] = k;
    err *= 1 - k * k;
    if (err <= 0) return null;
  }
  return a;
}

/** Peaks of the LPC envelope |1/A(e^jw)| between 150 Hz and 3500 Hz. */
function envelopePeaks(a: Float64Array, rate: number): number[] {
  const N = 512;
  const mag = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    const w = (Math.PI * n) / N;
    let re = 0;
    let im = 0;
    for (let k = 0; k < a.length; k++) {
      re += a[k] * Math.cos(w * k);
      im -= a[k] * Math.sin(w * k);
    }
    mag[n] = 1 / Math.max(1e-9, Math.hypot(re, im));
  }
  const peaks: number[] = [];
  for (let n = 1; n < N - 1; n++) {
    if (mag[n] > mag[n - 1] && mag[n] >= mag[n + 1]) {
      // parabolic interpolation for a finer frequency
      const y0 = Math.log(mag[n - 1]);
      const y1 = Math.log(mag[n]);
      const y2 = Math.log(mag[n + 1]);
      const d = (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
      const f = ((n + d) / N) * (rate / 2);
      if (f > 150 && f < 3500) peaks.push(f);
    }
  }
  return peaks;
}

/** Fraction of energy that is periodic (voiced). Cheap check so hiss/noise isn't read as a vowel. */
function voicedness(x: Float32Array, rate: number): number {
  const minLag = Math.floor(rate / 400);
  const maxLag = Math.floor(rate / 70);
  let r0 = 0;
  for (let i = 0; i < x.length; i++) r0 += x[i] * x[i];
  if (r0 <= 0) return 0;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < x.length; i++) s += x[i] * x[i - lag];
    if (s > best) best = s;
  }
  return best / r0;
}

export function analyzeFrame(frame: Float32Array, sampleRate: number): FormantReading | null {
  let rms = 0;
  for (let i = 0; i < frame.length; i++) rms += frame[i] * frame[i];
  rms = Math.sqrt(rms / frame.length);
  const level = Math.min(1, rms * 12);
  if (rms < 0.012) return null;

  const factor = Math.max(1, Math.round(sampleRate / TARGET_RATE));
  const rate = sampleRate / factor;
  const x = decimate(frame, factor);

  if (voicedness(x, rate) < 0.45) return null;

  // pre-emphasis + Hamming window
  const y = new Float32Array(x.length);
  // 0.7, not the usual 0.94: tested on synthetic vowels, 0.94 pushed low F1s (u, i) up by ~30 %.
  for (let i = x.length - 1; i > 0; i--) y[i] = x[i] - 0.7 * x[i - 1];
  y[0] = x[0];
  for (let i = 0; i < y.length; i++) y[i] *= 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (y.length - 1));

  const r = autocorr(y, ORDER);
  r[0] *= 1.0001; // tiny white-noise floor for stability
  const a = levinson(r, ORDER);
  if (!a) return null;
  const peaks = envelopePeaks(a, rate);
  const f1 = peaks.find((f) => f >= 200 && f <= 1100);
  if (f1 === undefined) return null;
  const f2 = peaks.find((f) => f > f1 + 250 && f >= 650 && f <= 3200);
  if (f2 === undefined) return null;
  return { f1, f2, level };
}

/** Median of the last few readings, so the tongue doesn't jitter. */
export class FormantSmoother {
  private buf: FormantReading[] = [];
  constructor(private size = 7) {}
  push(r: FormantReading): FormantReading {
    this.buf.push(r);
    if (this.buf.length > this.size) this.buf.shift();
    const med = (k: "f1" | "f2") => {
      const s = this.buf.map((b) => b[k]).sort((p, q) => p - q);
      return s[Math.floor(s.length / 2)];
    };
    return { f1: med("f1"), f2: med("f2"), level: r.level };
  }
  clear() {
    this.buf = [];
  }
}
