/**
 * Synthesizes vowels with known formants (a pulse train through resonators)
 * and checks the live tracker finds them. Run: npm test
 */
import { analyzeFrame } from "../src/audio/formants";
import { poseFromFormants, vowelScore } from "../src/audio/mirror";

const RATE = 48000;

function synthVowel(f0: number, formants: [number, number][], n = 2048): Float32Array {
  const src = new Float32Array(n);
  const period = Math.round(RATE / f0);
  for (let i = 0; i < n; i += period) src[i] = 1;
  let x = src;
  for (const [f, bw] of formants) {
    // two-pole resonator
    const r = Math.exp((-Math.PI * bw) / RATE);
    const a1 = 2 * r * Math.cos((2 * Math.PI * f) / RATE);
    const a2 = -r * r;
    const y = new Float32Array(n);
    for (let i = 0; i < n; i++) y[i] = x[i] + a1 * (y[i - 1] ?? 0) + a2 * (y[i - 2] ?? 0);
    x = y;
  }
  let peak = 0;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  return x.map((v) => (v / peak) * 0.3);
}

const CASES: { name: string; f1: number; f2: number }[] = [
  { name: "i (see)", f1: 270, f2: 2290 },
  { name: "æ (cat)", f1: 660, f2: 1720 },
  { name: "ɑ (hot)", f1: 730, f2: 1090 },
  { name: "u (zoo)", f1: 300, f2: 870 },
  { name: "ɛ (bed)", f1: 530, f2: 1840 },
];

let failed = 0;
for (const c of CASES) {
  const frame = synthVowel(120, [[c.f1, 80], [c.f2, 100], [2600, 150], [3300, 200]]);
  const r = analyzeFrame(frame, RATE);
  const ok = !!r && Math.abs(r.f1 - c.f1) / c.f1 < 0.15 && Math.abs(r.f2 - c.f2) / c.f2 < 0.12;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${c.name}: expected ${c.f1}/${c.f2}, got ${r ? `${Math.round(r.f1)}/${Math.round(r.f2)}` : "nothing"}`);
}

// silence must not produce a reading
const silent = analyzeFrame(new Float32Array(2048), RATE);
console.log(`${silent === null ? "PASS" : "FAIL"} silence gives no reading`);
if (silent !== null) failed++;

// noise (like "sss") must not be read as a vowel
const noise = new Float32Array(2048).map(() => (Math.random() * 2 - 1) * 0.2);
const nr = analyzeFrame(noise, RATE);
console.log(`${nr === null ? "PASS" : "FAIL"} hiss gives no reading`);
if (nr !== null) failed++;

// the mirror: æ formants should open the jaw more than ɛ formants, and score æ higher for the æ lesson
const pa = poseFromFormants(660, 1720, "low");
const pe = poseFromFormants(530, 1840, "low");
const jawOk = pa.jaw > pe.jaw;
console.log(`${jawOk ? "PASS" : "FAIL"} mirror: æ opens the jaw more than ɛ (${pa.jaw.toFixed(2)} vs ${pe.jaw.toFixed(2)})`);
if (!jawOk) failed++;
const sA = vowelScore(660, 1720, "æ", "low");
const sE = vowelScore(530, 1840, "æ", "low");
const scoreOk = sA > 90 && sE < sA;
console.log(`${scoreOk ? "PASS" : "FAIL"} score for æ lesson: real æ ${sA}, ɛ habit ${sE}`);
if (!scoreOk) failed++;

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
