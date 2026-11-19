/**
 * One short sentence per lesson: the day's sound in connected speech, after the
 * single words. Only the `focus` words are judged, so small words the speech
 * model writes loosely ("a", "and") can't cost the learner anything.
 *
 * Every word must be in the lexicon (or SMALL_WORDS below), which is what makes
 * the expected sounds follow the target accent automatically.
 */
import { accent, type Accent } from "./accent";
import type { TestItem } from "./assessment";
import { LEXICON } from "./lessons";
import { normalizeAll } from "../scoring/align";
import { LESSON_CHECKS } from "../scoring/checks";

export interface Sentence {
  text: string;
  /** The words whose target sounds are judged. */
  focus: string[];
  /** Set when the sentence can only be scored fairly in one accent. */
  only?: Accent;
}

export const SENTENCES: Record<string, Sentence> = {
  "v-w": { text: "We work very well.", focus: ["we", "work", "very", "well"] },
  "th-voiceless": { text: "I think math is easy, thanks.", focus: ["think", "math", "thanks"] },
  "th-voiced": { text: "They said that mother is there.", focus: ["they", "that", "mother", "there"] },
  "alveolar-td": { text: "The doctor said dinner is at ten today.", focus: ["doctor", "dinner", "ten", "today"] },
  z: { text: "The zoo is busy and easy.", focus: ["zoo", "is", "busy", "easy"] },
  "american-r": { text: "Sorry, the road is right around there.", focus: ["sorry", "road", "right", "around"] },
  rhotic: { text: "My first car is better.", focus: ["first", "car", "better"] },
  "flap-t": { text: "A little water is better.", focus: ["little", "water", "better"] },
  ae: { text: "A happy man and a sad cat.", focus: ["happy", "man", "sad", "cat"] },
  ah: { text: "The coffee is not hot, doctor.", focus: ["coffee", "not", "hot", "doctor"], only: "us" },
  ei: { text: "Today is a great day to play.", focus: ["today", "great", "day", "play"] },
  ou: { text: "Both go on the low road.", focus: ["both", "go", "low", "road"] },
  "i-ih": { text: "The sheep leave the ship.", focus: ["sheep", "leave", "ship"] },
  f: { text: "First, the fan is fine.", focus: ["first", "fan", "fine"] },
  // never scored (the model can't hear these sounds): said and compared by ear
  aspiration: { text: "Time to pin the paper.", focus: ["time", "pin", "paper"] },
  "dark-l": { text: "People feel full at school.", focus: ["people", "feel", "full", "school"] },
  // checked by ear of the speech model: both voices say each "to" weak (tə)
  "weak-words": { text: "I want to go to the shop.", focus: [] },
};

// Wordings were chosen by ear of the speech model (2026-11-13, two American and two
// British Kokoro voices; tests/sentences.test.ts keeps them honest). What it got
// wrong for native speakers, and so what to avoid when adding sentences:
//  - TH right after N ("men think") is dropped.
//  - "No," at the start of a sentence is written "now".
//  - "sit in this" came out garbled; "first fan" turned the F into a V.
//  - British short O in a sentence is written ɑ as often as ɔ, even from a British
//    voice, so that lesson has no scored sentence in British (`only: "us"`).

/** Small words used in the sentences that no lesson teaches. Never judged. */
const SMALL_WORDS: Record<string, string[]> = {
  a: ["ə"], and: ["æ", "n", "d"], in: ["ɪ", "n"], i: ["aɪ"], my: ["m", "aɪ"], at: ["æ", "t"], on: ["ɑ", "n"], to: ["t", "ə"],
};

export function sentenceWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z']+/).filter(Boolean);
}

/** The lesson's sentence to say, scored or not. Every lesson has one. */
export function sentenceText(lessonId: string): string | null {
  return SENTENCES[lessonId]?.text ?? null;
}

/**
 * The lesson's sentence as something the scorer can judge (same shape as a
 * voice-test phrase), in the active accent. null when the lesson has no
 * sentence or the speech model can't hear its sound (dark L, aspiration,
 * British R-dropping and short O); those are said and compared by ear instead.
 */
export function sentenceItem(lessonId: string): TestItem | null {
  const s = SENTENCES[lessonId];
  const lesson = LESSON_CHECKS[lessonId];
  if (!s || !lesson?.voiceTested || (s.only && s.only !== accent())) return null;
  const expected: string[] = [];
  const checks: TestItem["checks"] = [];
  for (const word of sentenceWords(s.text)) {
    const sounds = LEXICON[word] ?? SMALL_WORDS[word];
    if (!sounds) throw new Error(`sentence for ${lessonId}: "${word}" has no pronunciation`);
    for (const sym of normalizeAll(sounds)) {
      if (s.focus.includes(word) && lesson.sounds[sym]) checks.push({ i: expected.length, lesson: lessonId, sym, word });
      expected.push(sym);
    }
  }
  return checks.length ? { text: s.text, expected, checks } : null;
}
