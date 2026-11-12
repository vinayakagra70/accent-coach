/**
 * What counts as right, and which Indian-English habits to recognise, for each
 * lesson's target sound. Symbols are compared after normalize() (see align.ts),
 * so length marks and aspiration are ignored: "tʰ" == "t", "iː" == "i".
 *
 * "∅" as a habit means the sound was left out (e.g. the dropped R in "car").
 */
export interface SoundCheck {
  accept: string[];
  habits: Record<string, string>;
}

export interface LessonChecks {
  /** Keyed by the target symbol as written in LEXICON / test items. */
  sounds: Record<string, SoundCheck>;
  /** How much this sound gives away an Indian accent, 1-10. Orders the course. */
  impact: number;
  /** False when the speech model can't reliably hear the difference. */
  voiceTested: boolean;
}

const DROPPED_R = "no R sound (\"caa\" for car)";

export const LESSON_CHECKS: Record<string, LessonChecks> = {
  "alveolar-td": {
    impact: 10,
    voiceTested: true,
    sounds: {
      t: { accept: ["t", "ɾ", "ʔ"], habits: { ʈ: "curled-back T (retroflex)", "t̪": "dental T" } },
      d: { accept: ["d", "ɾ"], habits: { ɖ: "curled-back D (retroflex)", "d̪": "dental D" } },
    },
  },
  "v-w": {
    impact: 9,
    voiceTested: true,
    sounds: {
      v: { accept: ["v"], habits: { ʋ: "a V/W blend (ʋ)", β: "a V/W blend", w: "W instead of V", b: "B instead of V" } },
      w: { accept: ["w"], habits: { ʋ: "a V/W blend (ʋ)", β: "a V/W blend", v: "V instead of W" } },
    },
  },
  "th-voiceless": {
    impact: 8,
    voiceTested: true,
    sounds: {
      θ: { accept: ["θ"], habits: { "t̪": "a dental T (\"tink\")", t: "a T (\"tink\")", ʈ: "a hard T", f: "an F", s: "an S" } },
    },
  },
  "th-voiced": {
    impact: 8,
    voiceTested: true,
    sounds: {
      ð: { accept: ["ð"], habits: { d: "a D (\"dis\")", "d̪": "a dental D (\"dis\")", ɖ: "a hard D", "t̪": "a dental T", z: "a Z" } },
    },
  },
  "american-r": {
    impact: 7,
    voiceTested: true,
    sounds: {
      ɹ: { accept: ["ɹ", "ɻ"], habits: { r: "a rolled R", ɾ: "a tapped R" } },
    },
  },
  "flap-t": {
    impact: 7,
    voiceTested: true,
    sounds: {
      ɾ: { accept: ["ɾ", "d", "ɾ̃"], habits: { ʈ: "a full curled-back T", t: "a full T (not the soft flap)", "t̪": "a dental T", ɖ: "a curled-back D" } },
    },
  },
  rhotic: {
    impact: 7,
    voiceTested: true,
    sounds: {
      ɚ: { accept: ["ɚ", "ɹ", "ɻ", "ɜ"], habits: { ə: DROPPED_R, ɐ: DROPPED_R, a: DROPPED_R, ɑ: DROPPED_R, ʌ: DROPPED_R, "∅": DROPPED_R } },
      ɹ: { accept: ["ɹ", "ɻ", "ɚ"], habits: { "∅": DROPPED_R, r: "a rolled R", ɾ: "a tapped R" } },
    },
  },
  ae: {
    impact: 6,
    voiceTested: true,
    sounds: {
      æ: { accept: ["æ"], habits: { ɛ: "an \"e\" as in bed", e: "an \"e\" as in bed", a: "a flat Indian \"a\"", ɐ: "a flat \"uh\"" } },
    },
  },
  ei: {
    impact: 6,
    voiceTested: true,
    sounds: {
      eɪ: { accept: ["eɪ"], habits: { e: "a steady \"e\" with no glide", ɛ: "a steady \"e\" with no glide" } },
    },
  },
  ou: {
    impact: 6,
    voiceTested: true,
    sounds: {
      oʊ: { accept: ["oʊ", "əʊ"], habits: { o: "a steady \"o\" with no glide", ɔ: "a steady open \"o\"" } },
    },
  },
  z: {
    impact: 5,
    voiceTested: true,
    sounds: {
      z: { accept: ["z"], habits: { dʒ: "a J (\"joo\" for zoo)", ʒ: "a ZH", j: "a J" } },
    },
  },
  ah: {
    impact: 5,
    voiceTested: true,
    sounds: {
      ɑ: { accept: ["ɑ", "a"], habits: { ɔ: "a rounded British \"o\"", ɒ: "a rounded British \"o\"", o: "a rounded \"o\"" } },
    },
  },
  aspiration: { impact: 5, voiceTested: false, sounds: {} },
  "i-ih": {
    impact: 4,
    voiceTested: true,
    sounds: {
      ɪ: { accept: ["ɪ", "ᵻ"], habits: { i: "a long \"ee\" (sheep for ship)", e: "an \"e\"" } },
      i: { accept: ["i"], habits: { ɪ: "a short \"ih\" (ship for sheep)" } },
    },
  },
  "dark-l": { impact: 4, voiceTested: false, sounds: {} },
  f: {
    impact: 3,
    voiceTested: true,
    sounds: {
      f: { accept: ["f"], habits: { p: "a P/Ph (both lips)", ɸ: "both lips (Ph)" } },
    },
  },
};

/** Which lesson owns a target symbol in practice words, for the lesson being studied. */
export function checkFor(lessonId: string, symbol: string): SoundCheck | undefined {
  return LESSON_CHECKS[lessonId]?.sounds[symbol];
}
