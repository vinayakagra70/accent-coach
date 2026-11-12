/**
 * British English (RP) as a second target accent.
 *
 * What the speech model can and can't judge for British (measured 2026-11-12 with
 * Kokoro's British voices): it writes English the American way (a British
 * "better" comes out /bɛɾɚ/), so R-dropping and the British T between vowels
 * can't be scored. Those lessons are taught and compared by ear; everything
 * else is scored the same way as American.
 */
import { US_ASSESSMENT, type TestItem } from "./assessment";
import { US_FORMANTS, US_LESSONS, US_LEXICON, type Formants, type Lesson } from "./lessons";
import { US_CHECKS, type LessonChecks } from "../scoring/checks";
import { v } from "../mouth/pose";

const VOWELS = new Set(["i", "ɪ", "e", "ɛ", "æ", "a", "ɑ", "ɒ", "ɔ", "o", "ʊ", "u", "ʌ", "ə", "ɜ", "ɝ", "eɪ", "oʊ", "əʊ", "aɪ", "aʊ", "ɔɪ"]);
/** Words whose American ɑ is the British short rounded ɒ (the LOT vowel). */
const LOT = new Set(["hot", "job", "cot", "not", "shot", "coffee", "doctor", "sorry", "rock", "lock", "cod", "pot", "office"]);
/** BATH words: American æ, British ɑː. */
const BATH = new Set(["fast", "past"]);

/** American lexicon entry → RP. */
export function toBritish(word: string, us: string[]): string[] {
  const out: string[] = [];
  us.forEach((p, i) => {
    const next = us[i + 1];
    if (p === "ɹ" && (next === undefined || !VOWELS.has(next))) {
      // R after a vowel is silent; ɛ/ɪ/ʊ + R become centring diphthongs (dare → deə)
      const prev = out[out.length - 1];
      if (prev === "ɛ" || prev === "ɪ" || prev === "ʊ") out.push("ə");
      return;
    }
    if (p === "ɝ") return void out.push(i === us.length - 1 ? "ə" : "ɜ");
    if (p === "ɾ") return void out.push("t");
    if (p === "oʊ") return void out.push("əʊ");
    if (p === "ɑ" && LOT.has(word)) return void out.push("ɒ");
    if (p === "æ" && BATH.has(word)) return void out.push("ɑ");
    out.push(p);
  });
  return SPECIAL[word] ?? out;
}

/** Words the rules above don't cover. */
const SPECIAL: Record<string, string[]> = {
  water: ["w", "ɔ", "t", "ə"],
  tomato: ["t", "ə", "m", "ɑ", "t", "əʊ"],
};

export const UK_LEXICON: Record<string, string[]> = Object.fromEntries(
  Object.entries(US_LEXICON).map(([w, ph]) => [w, toBritish(w, ph)]),
);

/** RP vowel formants (Deterding 1997 men; women scaled), for the vowel mirror. */
export const UK_FORMANTS: Formants = {
  ...US_FORMANTS,
  ɑ: { low: [677, 1083], high: [800, 1250] },
  ɒ: { low: [558, 1047], high: [640, 1180] },
  ɔ: { low: [415, 828], high: [480, 920] },
  ɜ: { low: [478, 1436], high: [560, 1650] },
  æ: { low: [690, 1550], high: [800, 1780] },
};

const ALVEOLAR = v(-0.6, 0.95);

const OVERRIDES: Record<string, Partial<Lesson>> = {
  "american-r": {
    title: "The English R",
    mistake: "The Indian R is a quick tap of the tongue tip, or even a roll. The British R at the start of a word or between vowels doesn't touch anything: the tip just lifts toward the roof.",
  },
  rhotic: {
    title: "Drop the R (car, bird)",
    sound: "silent R in car, bird, better",
    targets: [
      { label: "ɑː: car with no R", pose: "ɑ" },
      { label: "ɜː: bird with no R", pose: "ɜ" },
    ],
    habit: { label: "Indian R after the vowel", pose: "ɝ" },
    mistake: "Most Indian speakers pronounce every written R. In British English an R after a vowel is silent: car sounds like \"caa\", bird is \"bɜːd\", and better ends in a soft \"uh\".",
    steps: [
      "Say the vowel and stop. Don't lift or curl the tongue tip afterwards.",
      "car: an open \"aah\", and that's the whole word.",
      "bird: a relaxed \"er\" with the tongue tip resting behind your bottom teeth.",
      "The R comes back when the next word starts with a vowel: \"far away\" says the R.",
    ],
    vowel: "ɜ",
    habitVowel: "ʌ",
  },
  "flap-t": {
    title: "Clear T (water, better)",
    sound: "t in water, better, city",
    targets: [{ label: "t: a light, crisp tap on the ridge", pose: "t", contact: ALVEOLAR }],
    mistake: "Indian English often uses a heavy, curled-back T in the middle of words. British English uses a light, crisp T on the ridge just behind the teeth. Don't copy the American soft \"wadder\" either.",
    steps: [
      "Touch the tongue tip to the ridge just behind your top teeth.",
      "Release it cleanly with a small puff: wa-ter, bet-ter.",
      "Keep the tongue flat. Don't curl it back.",
    ],
  },
  ah: {
    title: "Short O (hot, job)",
    sound: "ɒ in hot, job, doctor",
    targets: [{ label: "ɒ: short, lips a little round", pose: "ɒ" }],
    habit: { label: "A flat, long \"aa\" (haat)", pose: "ɑ" },
    mistake: "British \"hot\" and \"job\" use a short \"o\" with slightly rounded lips. A long, flat \"haat\" sounds American, or Indian.",
    steps: [
      "Open your jaw.",
      "Round your lips just a little, like a small \"o\".",
      "Keep it short: hot, not haaat.",
    ],
    vowel: "ɒ",
    habitVowel: "ɑ",
  },
  ou: {
    title: "OH glide (go, no)",
    sound: "əʊ in go, phone",
    targets: [{ label: "əʊ: from \"uh\" to \"oo\"", pose: "əʊ" }],
    mistake: "A pure, steady \"o\" sounds Indian. British \"go\" starts in the middle of the mouth, like \"uh\", and glides to \"oo\".",
    steps: [
      "Start with a relaxed \"uh\" (the middle of the mouth, lips loose).",
      "Glide into \"oo\": round your lips and lift the back of your tongue.",
      "\"no\" ≈ \"nuh-oo\", said as one smooth sound.",
    ],
    vowel: "ɜ",
    habitVowel: "o",
  },
};

/** "American" wording in the shared lessons, said the British way. */
function britishText(s: string): string {
  return s
    .replace(/General American/g, "British English")
    .replace(/American English/g, "British English")
    .replace(/Americans/g, "British listeners")
    .replace(/American/g, "British");
}

function britishLesson(l: Lesson): Lesson {
  const o = OVERRIDES[l.id] ?? {};
  const merged: Lesson = { ...l, ...o };
  return {
    ...merged,
    title: britishText(merged.title),
    mistake: britishText(merged.mistake),
    steps: merged.steps.map(britishText),
    targets: merged.targets.map((t) => ({ ...t, label: britishText(t.label) })),
    habit: { ...merged.habit, label: britishText(merged.habit.label) },
  };
}

export const UK_LESSONS: Lesson[] = US_LESSONS.map(britishLesson);

const CLEAR_T = {
  accept: ["t", "ɾ", "d", "ʔ"],
  habits: { ʈ: "a curled-back T (retroflex)", ɖ: "a curled-back D", "t̪": "a dental T" },
};

export const UK_CHECKS: Record<string, LessonChecks> = {
  ...US_CHECKS,
  // can't be heard reliably: the model writes British "car" and "better" the American way
  rhotic: { impact: 7, voiceTested: false, sounds: {} },
  "flap-t": { impact: 7, voiceTested: true, sounds: { t: CLEAR_T, ɾ: CLEAR_T } },
  ah: {
    impact: 5,
    voiceTested: true,
    // A flat "a" isn't named as a habit: the model also writes some correct British
    // "job"s that way (Kokoro bf_emma), so it only costs half credit as "unclear".
    sounds: { ɒ: { accept: ["ɒ", "ɔ"], habits: { ɑ: "a long, open \"aa\" (haat)" } } },
  },
  ou: {
    impact: 6,
    voiceTested: true,
    sounds: { əʊ: { accept: ["oʊ", "əʊ"], habits: { o: "a steady \"o\" with no glide", ɔ: "a steady open \"o\"" } } },
  },
  ae: {
    impact: 6,
    voiceTested: true,
    sounds: { æ: { accept: ["æ", "a"], habits: { ɛ: "an \"e\" as in bed", e: "an \"e\" as in bed", ɐ: "a flat \"uh\"" } } },
  },
};

/** Same 13 phrases; British targets where they differ, and no R-dropping checks. */
export const UK_ASSESSMENT: TestItem[] = US_ASSESSMENT.map((item) => {
  const expected = [...item.expected];
  const checks = item.checks
    .filter((c) => c.lesson !== "rhotic")
    .map((c) => {
      if (c.lesson === "ah") {
        expected[c.i] = "ɒ";
        return { ...c, sym: "ɒ" };
      }
      if (c.lesson === "ou") {
        expected[c.i] = "əʊ";
        return { ...c, sym: "əʊ" };
      }
      return c;
    });
  return { ...item, expected, checks };
});
