/**
 * Builds recordings with known timing (bursts of tone and noise, separated by
 * silences of known length, over a noise floor) and checks the pace measure
 * finds the same timing.
 */
import { compareToModel, countWords, measurePace, paceVerdict } from "../src/features/pace";

const RATE = 16000;

// deterministic noise, so a failure repeats
let seed = 12345;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 0x100000000 - 0.5;
};

/** [seconds, loud?] segments over a noise floor. */
function build(segments: [number, boolean][], floorAmp = 0.003, rate = RATE): Float32Array {
  const total = segments.reduce((a, [s]) => a + Math.round(s * rate), 0);
  const out = new Float32Array(total);
  let o = 0;
  for (const [s, on] of segments) {
    const n = Math.round(s * rate);
    for (let i = 0; i < n; i++) {
      const noise = rand() * 2 * floorAmp;
      // a "voice": a 150 Hz tone with some hiss, with a wobble in loudness like syllables
      const voice = on ? (0.2 + 0.08 * Math.sin((2 * Math.PI * 5 * i) / rate)) * Math.sin((2 * Math.PI * 150 * i) / rate) + rand() * 0.04 : 0;
      out[o + i] = voice + noise;
    }
    o += n;
  }
  return out;
}

let failed = 0;
const check = (ok: boolean, name: string, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
};
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// 0.5 s lead, four bursts, two real pauses (0.4, 0.3) and one 0.1 s gap that is not a pause, 0.6 s tail
const SENTENCE: [number, boolean][] = [
  [0.5, false], [0.8, true], [0.4, false], [1.0, true], [0.1, false], [0.6, true], [0.3, false], [0.7, true], [0.6, false],
];
const r = measurePace(build(SENTENCE), RATE, 10);
check(r.speech, "speech is found");
check(near(r.start, 0.5, 0.03) && near(r.end, 4.4, 0.03), "leading and trailing silence trimmed", `start ${r.start.toFixed(2)} (0.50), end ${r.end.toFixed(2)} (4.40)`);
check(near(r.speechSeconds, 3.9, 0.05), "speech duration", `${r.speechSeconds.toFixed(2)} s (3.90)`);
check(r.pauseCount === 2, "two pauses counted, the 0.1 s gap is not one", `${r.pauseCount}`);
check(near(r.pauseSeconds, 0.7, 0.05), "pause total", `${r.pauseSeconds.toFixed(2)} s (0.70)`);
check(r.pauses.length === 2 && near(r.pauses[0].start, 1.3, 0.03) && near(r.pauses[0].seconds, 0.4, 0.03), "first pause is where it was put", r.pauses[0] ? `${r.pauses[0].start.toFixed(2)} for ${r.pauses[0].seconds.toFixed(2)}` : "none");
check(near(r.articulationSeconds, 3.2, 0.06), "articulation time", `${r.articulationSeconds.toFixed(2)} s (3.20)`);
check(near(r.wpm, (10 / 3.9) * 60, 3), "words per minute", `${r.wpm.toFixed(1)} (153.8)`);
check(near(r.articulationWpm, (10 / 3.2) * 60, 4), "words per minute while talking", `${r.articulationWpm.toFixed(1)} (187.5)`);
check(near(r.wpm, (r.wordCount / r.speechSeconds) * 60, 1e-6) && near(r.speechSeconds - r.pauseSeconds, r.articulationSeconds, 1e-6), "the numbers agree with each other");
check(paceVerdict(r).band === "comfortable", "154 wpm is comfortable", paceVerdict(r).label);

// a louder room: the threshold has to follow the noise floor
const noisy = measurePace(build(SENTENCE, 0.02), RATE, 10);
check(noisy.speech && near(noisy.speechSeconds, 3.9, 0.06) && noisy.pauseCount === 2, "same timing in a noisy room", `${noisy.speechSeconds.toFixed(2)} s, ${noisy.pauseCount} pauses`);

// no noise at all (a synthesized model clip), and a different sample rate
const clean = measurePace(build(SENTENCE, 0, 24000), 24000, 10);
check(clean.speech && near(clean.speechSeconds, 3.9, 0.05) && clean.pauseCount === 2, "same timing on a clean 24 kHz clip", `${clean.speechSeconds.toFixed(2)} s, ${clean.pauseCount} pauses`);

// a click in the leading silence must not move the start
const clicky = build(SENTENCE);
for (let i = 0; i < 160; i++) clicky[1600 + i] = i % 2 ? 0.5 : -0.5; // 10 ms at 0.1 s
const cr = measurePace(clicky, RATE, 10);
check(near(cr.start, 0.5, 0.03), "a click before the speech is ignored", `start ${cr.start.toFixed(2)}`);

// fast and unbroken: 12 words in 3 s
const fast = measurePace(build([[0.4, false], [3.0, true], [0.8, false]]), RATE, 12);
const fv = paceVerdict(fast);
check(fast.pauseCount === 0 && near(fast.wpm, 240, 6), "unbroken speech has no pauses", `${fast.wpm.toFixed(0)} wpm, ${fast.pauseCount} pauses`);
check(fv.band === "fast" && /pause/.test(fv.text), "240 wpm with no pauses is fast, and says to pause", fv.text);

// slow: 6 words over 4 s
const slow = measurePace(build([[0.3, false], [1.5, true], [1.0, false], [1.5, true], [0.5, false]]), RATE, 6);
check(paceVerdict(slow).band === "slow", "90 wpm is slow", `${slow.wpm.toFixed(0)} wpm`);

// band edges, from a bare number
check(paceVerdict(129).band === "slow" && paceVerdict(130).band === "comfortable" && paceVerdict(170).band === "comfortable" && paceVerdict(171).band === "fast", "comfortable band is 130 to 170");

// too short to tell: few words, or under 1.2 s
const fewWords = measurePace(build([[0.4, false], [2.0, true], [0.5, false]]), RATE, 3);
check(paceVerdict(fewWords).band === "short" && paceVerdict(fewWords).label === "too short to tell", "3 words is too short to tell");
const brief = measurePace(build([[0.4, false], [1.0, true], [0.5, false]]), RATE, 5);
check(paceVerdict(brief).band === "short", "1 second is too short to tell", `${brief.speechSeconds.toFixed(2)} s`);

// nothing said
const room = measurePace(build([[3, false]]), RATE, 8);
check(!room.speech && room.wpm === 0 && paceVerdict(room).band === "short", "room noise alone is not speech");
const dead = measurePace(new Float32Array(RATE * 2), RATE, 8);
check(!dead.speech && paceVerdict(dead).band === "short", "digital silence is not speech");
check(!measurePace(new Float32Array(0), RATE, 8).speech, "an empty recording does not crash");

// against the model clip
const model = measurePace(build([[0.2, false], [4.0, true], [0.2, false]]), RATE, 10); // 150 wpm
const same = measurePace(build([[0.5, false], [3.9, true], [0.5, false]]), RATE, 10);
const quicker = measurePace(build([[0.5, false], [3.0, true], [0.5, false]]), RATE, 10); // 200 wpm
check(paceVerdict(same, model).vsModel === "about as fast as the model", "same speed as the model", paceVerdict(same, model).vsModel);
check(paceVerdict(quicker, model).vsModel === "a third faster than the model", "a third faster than the model", paceVerdict(quicker, model).vsModel);
check(compareToModel(100, 150) === "a third slower than the model" && compareToModel(300, 150) === "about twice as fast as the model", "slower and much faster wording");
check(paceVerdict(fewWords, model).vsModel === undefined, "no model comparison when too short");

// word counting
check(countWords("Thank you for joining the meeting today.") === 7 && countWords("I don't know, it's a well-known place") === 7 && countWords("  ") === 0, "words are counted like a listener would");

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
