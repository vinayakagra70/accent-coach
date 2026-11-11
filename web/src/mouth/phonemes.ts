import { makePose, v, type Pose } from "./pose";

/**
 * Target poses for General American sounds, plus the common Indian-English
 * substitutes ("habits") so the app can show both side by side.
 *
 * Contact points line up with the palate drawn in anatomy.ts:
 * alveolar ridge ≈ (-0.6, 0.9), hard palate peak ≈ (-3.2, 1.68),
 * soft palate starts ≈ (-4.4, 1.45).
 */
const ALVEOLAR = v(-0.6, 0.92);
const NEAR_ALVEOLAR = v(-0.5, 0.6);
const POSTALVEOLAR = v(-1.0, 1.1);
const DENTAL_BETWEEN = v(0.22, -0.04);
const DENTAL_BEHIND = v(-0.25, 0.45);
const TIP_LOW = v(-0.4, -0.55);

const C = (p: Partial<Pose>) => makePose({ jaw: 0.1, ...p });

export const PHONEME_POSES: Record<string, Pose> = {
  // ---- stops
  p: C({ lipClose: 1, airflow: "stop" }),
  b: C({ lipClose: 1, airflow: "stop", voiced: true }),
  t: C({ tip: ALVEOLAR, airflow: "stop" }),
  d: C({ tip: ALVEOLAR, airflow: "stop", voiced: true }),
  k: C({ tip: TIP_LOW, body: v(-4.25, 1.45), airflow: "stop" }),
  g: C({ tip: TIP_LOW, body: v(-4.25, 1.45), airflow: "stop", voiced: true }),
  // American flap: "water", "better" — a quick tap of the tip
  ɾ: C({ tip: v(-0.62, 0.86), airflow: "approximant", voiced: true }),

  // ---- nasals
  m: C({ lipClose: 1, velum: 1, airflow: "nasal", voiced: true }),
  n: C({ tip: ALVEOLAR, velum: 1, airflow: "nasal", voiced: true }),
  ŋ: C({ tip: TIP_LOW, body: v(-4.25, 1.45), velum: 1, airflow: "nasal", voiced: true }),

  // ---- fricatives
  f: C({ labiodental: 1, airflow: "fricative" }),
  v: C({ labiodental: 1, airflow: "fricative", voiced: true }),
  θ: C({ jaw: 0.14, tip: DENTAL_BETWEEN, body: v(-2.8, 0.45), airflow: "fricative" }),
  ð: C({ jaw: 0.14, tip: DENTAL_BETWEEN, body: v(-2.8, 0.45), airflow: "fricative", voiced: true }),
  s: C({ tip: NEAR_ALVEOLAR, body: v(-2.4, 0.95), airflow: "fricative" }),
  z: C({ tip: NEAR_ALVEOLAR, body: v(-2.4, 0.95), airflow: "fricative", voiced: true }),
  ʃ: C({ tip: v(-0.85, 0.62), body: v(-2.2, 1.12), lipRound: 0.55, airflow: "fricative" }),
  ʒ: C({ tip: v(-0.85, 0.62), body: v(-2.2, 1.12), lipRound: 0.55, airflow: "fricative", voiced: true }),
  h: makePose({ jaw: 0.3, airflow: "fricative" }),

  // ---- affricates (shown at the closure; air then hisses out)
  tʃ: C({ tip: POSTALVEOLAR, body: v(-2.2, 1.1), lipRound: 0.5, airflow: "fricative" }),
  dʒ: C({ tip: POSTALVEOLAR, body: v(-2.2, 1.1), lipRound: 0.5, airflow: "fricative", voiced: true }),

  // ---- approximants
  // American R: tip raised and pulled back, NOT touching anything; lips a little rounded.
  ɹ: C({ tip: v(-1.25, 0.82), curl: 0.35, body: v(-3.4, 0.95), lipRound: 0.45, airflow: "approximant", voiced: true }),
  l: C({ tip: ALVEOLAR, body: v(-2.6, 0.45), airflow: "approximant", voiced: true }),
  // Dark L at the end of words ("feel", "call"): back of the tongue lifts too.
  ɫ: C({ tip: ALVEOLAR, body: v(-4.0, 0.95), airflow: "approximant", voiced: true }),
  w: C({ jaw: 0.08, lipRound: 1, body: v(-3.8, 1.15), airflow: "approximant", voiced: true }),
  j: C({ body: v(-2.0, 1.3), airflow: "approximant", voiced: true }),

  // ---- vowels (GA)
  i: makePose({ jaw: 0.1, tip: TIP_LOW, body: v(-2.0, 1.25), airflow: "vowel", voiced: true }),
  ɪ: makePose({ jaw: 0.16, tip: TIP_LOW, body: v(-2.35, 0.98), airflow: "vowel", voiced: true }),
  e: makePose({ jaw: 0.2, tip: TIP_LOW, body: v(-2.25, 0.85), airflow: "vowel", voiced: true }),
  ɛ: makePose({ jaw: 0.32, tip: TIP_LOW, body: v(-2.35, 0.55), airflow: "vowel", voiced: true }),
  æ: makePose({ jaw: 0.58, tip: v(-0.35, -0.75), body: v(-2.45, 0.12), airflow: "vowel", voiced: true }),
  ɑ: makePose({ jaw: 0.68, tip: v(-0.5, -0.85), body: v(-3.8, -0.15), airflow: "vowel", voiced: true }),
  ɔ: makePose({ jaw: 0.5, lipRound: 0.5, tip: TIP_LOW, body: v(-3.9, 0.3), airflow: "vowel", voiced: true }),
  o: makePose({ jaw: 0.3, lipRound: 0.65, tip: TIP_LOW, body: v(-3.85, 0.65), airflow: "vowel", voiced: true }),
  ʊ: makePose({ jaw: 0.18, lipRound: 0.7, tip: TIP_LOW, body: v(-3.6, 0.95), airflow: "vowel", voiced: true }),
  u: makePose({ jaw: 0.1, lipRound: 1, tip: TIP_LOW, body: v(-3.7, 1.15), airflow: "vowel", voiced: true }),
  ʌ: makePose({ jaw: 0.4, tip: TIP_LOW, body: v(-3.2, 0.35), airflow: "vowel", voiced: true }),
  ə: makePose({ jaw: 0.25, tip: TIP_LOW, body: v(-3.0, 0.5), airflow: "vowel", voiced: true }),
  ɝ: C({ jaw: 0.2, tip: v(-1.25, 0.82), curl: 0.35, body: v(-3.4, 0.95), lipRound: 0.45, airflow: "vowel", voiced: true }),
  a: makePose({ jaw: 0.62, tip: TIP_LOW, body: v(-3.0, -0.05), airflow: "vowel", voiced: true }),

  // ---- Indian-English habits (what we help people move away from)
  /** Retroflex t: tip curled back onto the roof. */
  "ʈ (habit)": C({ tip: v(-1.7, 1.45), curl: 1, airflow: "stop" }),
  "ɖ (habit)": C({ tip: v(-1.7, 1.45), curl: 1, airflow: "stop", voiced: true }),
  /** "th" said as a dental t: tip pressed behind the teeth, a stop instead of a hiss. */
  "t̪ (habit)": C({ tip: DENTAL_BEHIND, airflow: "stop" }),
  "d̪ (habit)": C({ tip: DENTAL_BEHIND, airflow: "stop", voiced: true }),
  /** v and w merged: lip loosely near the teeth, no hiss, no rounding. */
  "ʋ (habit)": C({ labiodental: 0.55, airflow: "approximant", voiced: true }),
  /** Tapped r: tip flicks the ridge. */
  "ɾ (habit)": C({ tip: v(-0.62, 0.86), airflow: "approximant", voiced: true }),
  /** z said as j: tip pressed firmly, a stop + hiss. */
  "dʒ (habit)": C({ tip: POSTALVEOLAR, body: v(-2.2, 1.1), lipRound: 0.2, airflow: "stop", voiced: true }),
  /** Clear l everywhere. */
  "l (habit)": C({ tip: ALVEOLAR, body: v(-2.5, 0.45), airflow: "approximant", voiced: true }),
  /** Unaspirated p: lips release with no puff of air. */
  "p (habit)": C({ lipClose: 1, airflow: "none" }),
  /** "ph" for f: lips together instead of lip-to-teeth. */
  "pʰ (habit)": C({ lipClose: 1, airflow: "stop" }),
};

/** Diphthongs and anything that is really two poses in a row. */
export const SEQUENCES: Record<string, string[]> = {
  eɪ: ["e", "ɪ"],
  oʊ: ["o", "ʊ"],
  aɪ: ["a", "ɪ"],
  aʊ: ["a", "ʊ"],
  ɔɪ: ["ɔ", "ɪ"],
};

export function poseFor(symbol: string): Pose | undefined {
  return PHONEME_POSES[symbol];
}

/** Expand a word's phoneme list into (pose, seconds) steps for playback. */
export function wordTimeline(phonemes: string[]): { symbol: string; pose: Pose; dur: number }[] {
  const out: { symbol: string; pose: Pose; dur: number }[] = [];
  for (const ph of phonemes) {
    const parts = SEQUENCES[ph] ?? [ph];
    for (const part of parts) {
      const pose = PHONEME_POSES[part];
      if (!pose) continue;
      const vowelish = pose.airflow === "vowel";
      out.push({ symbol: ph, pose, dur: vowelish ? 0.22 / parts.length + 0.08 : part === "ɾ" ? 0.07 : 0.14 });
    }
  }
  return out;
}
