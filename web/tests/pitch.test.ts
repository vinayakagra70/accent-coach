/**
 * Synthesizes tones with a known pitch and checks the melody tracker finds it.
 * Run: npx esbuild tests/pitch.test.ts --bundle --platform=node --format=esm --outdir=node_modules/.cache/tests-pitch; node node_modules/.cache/tests-pitch/pitch.test.js
 */
import { contour, onUnitTime, pitchTrack, toSemitones } from "../src/features/pitch";

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
}

/** A tone whose pitch follows f(t); `shape` turns phase (0..1) into a sample. */
function tone(rate: number, seconds: number, f: (t: number) => number, shape: (phase: number) => number, amp = 0.3): Float32Array {
  const n = Math.round(rate * seconds);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    phase += f(i / rate) / rate;
    out[i] = amp * shape(phase - Math.floor(phase));
  }
  return out;
}
const sine = (p: number) => Math.sin(2 * Math.PI * p);
const saw = (p: number) => 2 * p - 1;

const voicedOf = (hz: (number | null)[]) => hz.filter((v): v is number => v !== null);
const med = (a: number[]) => [...a].sort((p, q) => p - q)[a.length >> 1];

// steady tones, at the recorder's rate and at a decoded clip's rate
for (const rate of [16000, 44100, 48000]) {
  for (const [name, shape] of [["sine", sine], ["sawtooth", saw]] as const) {
    for (const f0 of [80, 120, 210, 330]) {
      const t = pitchTrack(tone(rate, 0.6, () => f0, shape), rate);
      const v = voicedOf(t.hz);
      const worst = Math.max(...v.map((x) => Math.abs(x - f0) / f0));
      const ok = v.length >= t.hz.length * 0.95 && worst < 0.02;
      check(`${name} ${f0} Hz at ${rate}`, ok, `${v.length}/${t.hz.length} voiced, worst error ${(worst * 100).toFixed(2)}%`);
    }
  }
}

// about one reading every 10 ms
{
  const t = pitchTrack(tone(16000, 1, () => 150, sine), 16000);
  const step = t.times[1] - t.times[0];
  check("10 ms hop", Math.abs(step - 0.01) < 0.001 && t.times.length === t.hz.length, `step ${step.toFixed(4)} s`);
}

// a glide from 120 to 240 Hz is followed all the way
{
  const rate = 16000;
  const f = (t: number) => 120 * Math.pow(2, t);
  const t = pitchTrack(tone(rate, 1, f, saw), rate);
  let worst = 0;
  let voiced = 0;
  t.hz.forEach((v, i) => {
    if (v === null) return;
    voiced++;
    worst = Math.max(worst, Math.abs(v - f(t.times[i])) / f(t.times[i]));
  });
  check("glide 120 to 240 Hz", voiced >= t.hz.length * 0.95 && worst < 0.04, `worst error ${(worst * 100).toFixed(2)}%`);
  const st = toSemitones(t).st.filter((v): v is number => v !== null);
  const span = st[st.length - 1] - st[0];
  check("glide spans about an octave in semitones", span > 10.5 && span < 12.5, `${span.toFixed(2)} st`);
}

// silence
{
  const t = pitchTrack(new Float32Array(16000), 16000);
  check("silence gives no pitch", t.hz.length > 0 && t.hz.every((v) => v === null));
  check("silence gives no contour", contour(new Float32Array(16000), 16000) === null);
  check("too short to analyse gives an empty track", pitchTrack(new Float32Array(100), 16000).hz.length === 0);
}

// hiss
{
  let seed = 12345;
  const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 0xffffffff) * 2 - 1;
  const noise = new Float32Array(16000).map(() => rnd() * 0.2);
  const t = pitchTrack(noise, 16000);
  const v = voicedOf(t.hz).length;
  check("noise is mostly unvoiced", v <= t.hz.length * 0.05, `${v}/${t.hz.length} voiced`);
}

// a second harmonic stronger than the fundamental must not be read as the pitch
for (const [rate, f0, h1] of [[16000, 110, 0.5], [16000, 180, 0.3], [48000, 140, 0.4]] as const) {
  const shape = (p: number) => h1 * Math.sin(2 * Math.PI * p) + Math.sin(4 * Math.PI * p) + 0.3 * Math.sin(6 * Math.PI * p);
  const t = pitchTrack(tone(rate, 0.6, () => f0, shape, 0.25), rate);
  const v = voicedOf(t.hz);
  const m = v.length ? med(v) : 0;
  const wrong = v.filter((x) => Math.abs(x - f0) / f0 > 0.05).length;
  check(`strong 2nd harmonic, ${f0} Hz at ${rate}`, v.length > 0 && Math.abs(m - f0) / f0 < 0.02 && wrong === 0, `median ${m.toFixed(1)} Hz, ${wrong} frames off`);
}

// a single frame that slips an octave is folded back
{
  const rate = 16000;
  const x = tone(rate, 0.8, () => 130, saw);
  const slip = tone(rate, 0.03, () => 260, saw);
  x.set(slip, Math.round(rate * 0.4));
  const v = voicedOf(pitchTrack(x, rate).hz);
  const high = v.filter((f) => f > 200).length;
  check("a 30 ms octave slip does not show", high === 0, `${high} frames above 200 Hz`);
}

// voice, pause, voice: the pause stays a gap, and silence at both ends is trimmed
{
  const rate = 16000;
  const quiet = new Float32Array(rate * 0.3);
  const a = tone(rate, 0.4, () => 140, saw);
  const b = tone(rate, 0.4, () => 175, saw);
  const x = new Float32Array(quiet.length * 3 + a.length + b.length);
  x.set(a, quiet.length);
  x.set(b, quiet.length * 2 + a.length);
  const c = contour(x, rate, 100);
  const ok = !!c && c.length === 100 && c[0] !== null && c[99] !== null && c.slice(40, 60).some((v) => v === null);
  check("pause is a gap, ends are trimmed", ok);
  const first = c?.[5] ?? 0;
  const last = c?.[94] ?? 0;
  check("second half sits about 3.9 semitones above the first", Math.abs(last - first - 12 * Math.log2(175 / 140)) < 0.3, `${(last - first).toFixed(2)} st`);
}

// a low and a high voice saying the same tune give the same contour
{
  const rate = 16000;
  const tune = (base: number) => (t: number) => base * Math.pow(2, (3 * Math.sin(2 * Math.PI * 1.5 * t)) / 12);
  const low = contour(tone(rate, 1, tune(100), saw), rate, 80);
  const high = contour(tone(rate, 1.4, (t) => tune(220)(t / 1.4), saw), rate, 80);
  let worst = 0;
  if (low && high) for (let i = 2; i < 78; i++) if (low[i] !== null && high[i] !== null) worst = Math.max(worst, Math.abs(low[i]! - high[i]!));
  check("low and high voice, same tune, same contour", !!low && !!high && worst < 0.6, `worst gap ${worst.toFixed(2)} st`);
}

// median of the semitone track is zero
{
  const s = toSemitones({ times: [0, 1, 2, 3, 4], hz: [100, null, 200, 400, null] });
  check("semitones are measured from the median", s.medianHz === 200 && s.st[0] === -12 && s.st[1] === null && s.st[3] === 12);
  check("too little voice gives no contour", onUnitTime(toSemitones({ times: [0, 1, 2], hz: [null, 150, null] })) === null);
}

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("all pitch tests passed");
