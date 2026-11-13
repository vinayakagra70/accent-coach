/**
 * Scoring text the learner typed themselves.
 *
 * The server says how the text is pronounced (server/phonemize.py: espeak, the
 * same alphabet the speech model writes, with stress marks). Here that becomes
 * the expected sounds plus the list of sounds worth judging, using the same
 * per-lesson checks as the course.
 *
 * Unlike a lesson's hand-picked words, anything can be typed, so the rules are
 * deliberately cautious about what gets judged:
 *  - consonants: always (they're said the same in any position);
 *  - vowels: only in stressed syllables. Unstressed vowels are reduced in
 *    natural speech ("and" → "ən"), and that isn't a mistake;
 *  - never the linking R after an R-coloured vowel ("water is"), and an R
 *    that simply wasn't heard is "unclear", not "dropped" (see judgeFreeText);
 *  - British short O: never (the model hears a British "hot" as American about
 *    half the time, see content/sentences.ts).
 *
 * Measured 2026-11-14 (tests/freetext.test.ts): 20 everyday texts in four native
 * voices, 734 judged sounds, 95-98% clean and no false habits. The rules were
 * tuned on those same texts, so expect a little worse on new ones.
 *
 * Testing note: don't imitate a learner by having Kokoro read a misspelled
 * sentence ("I tink dis is wery good"). Reading a whole sentence, it drifts back
 * to the normal pronunciation, and everything looks clean. Joining words that
 * were synthesized one at a time keeps the wrong sounds; with those the model
 * heard T/D for TH, W for V and B for V inside a sentence in 15 of 18 cases.
 * The misses were all "dis"/"zis" written as "this": a D-for-TH in a very
 * common word can slip through in running speech.
 */
import type { Accent } from "../content/accent";
import { MULTI, align, isVowel, judge, normalize, type Verdict } from "./align";
import { LESSON_CHECKS } from "./checks";

/** One typed word (or a few that are said as one, like "of the") and how it's pronounced. */
export interface SpokenWord {
  text: string;
  ipa: string;
}

export interface FreeCheck {
  /** Index into expected. */
  i: number;
  /** Index into the words. */
  word: number;
  sym: string;
  lesson: string;
}

export interface FreeItem {
  words: SpokenWord[];
  expected: string[];
  checks: FreeCheck[];
}

/** Lessons whose checks aren't trusted on free text, per accent. */
const SKIP: Record<Accent, string[]> = { us: [], uk: ["ah"] };

interface Tok {
  sym: string;
  stressed: boolean;
}

/** An espeak string ("wˈɔːɾɚ") as normalized sounds, each vowel marked stressed or not. */
export function ipaTokens(ipa: string): Tok[] {
  const out: Tok[] = [];
  let pending = false;
  let i = 0;
  while (i < ipa.length) {
    const ch = ipa[i];
    if (ch === "ˈ" || ch === "ˌ") {
      pending = true;
      i++;
      continue;
    }
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    let raw = MULTI.find((x) => ipa.startsWith(x, i)) ?? ch;
    i += raw.length;
    while (i < ipa.length && /[̀-ͯːʰˑ]/.test(ipa[i])) raw += ipa[i++]; // length marks, diacritics
    const sym = normalize(raw);
    if (!sym) continue;
    const stressed = pending && isVowel(sym);
    if (stressed) pending = false;
    out.push({ sym, stressed });
  }
  return out;
}

/** Which lesson's check judges this sound here, or null to leave it unjudged. */
function lessonFor(sym: string, prev: string | undefined, next: string | undefined, stressed: boolean, accent: Accent): string | null {
  const scored = (id: string) => LESSON_CHECKS[id]?.voiceTested && !SKIP[accent].includes(id) && !!LESSON_CHECKS[id].sounds[sym];
  if (sym === "ɹ") {
    const afterVowel = prev !== undefined && isVowel(prev);
    if (afterVowel && prev === "ɚ") return null; // linking R ("water is"): optional, never judged
    if (afterVowel && next === undefined) return scored("rhotic") ? "rhotic" : null; // car, there
    if (afterVowel && next !== undefined && !isVowel(next)) return scored("rhotic") ? "rhotic" : null; // hard, part
    return scored("american-r") ? "american-r" : null; // red, very, around
  }
  if (isVowel(sym) && sym !== "ɚ" && !stressed) return null;
  // the most telling lesson that knows this sound
  const ids = Object.keys(LESSON_CHECKS).filter(scored).sort((a, b) => LESSON_CHECKS[b].impact - LESSON_CHECKS[a].impact);
  return ids[0] ?? null;
}

/** Expected sounds and what to judge, for words pronounced by the server, in the given accent. */
export function freeTextItem(words: SpokenWord[], accent: Accent): FreeItem {
  const expected: string[] = [];
  const checks: FreeCheck[] = [];
  words.forEach((w, wi) => {
    let toks = ipaTokens(w.ipa);
    // American NURSE vowel: espeak writes ɜː, the lessons and the model call it ɚ
    if (accent === "us") toks = toks.map((t) => (t.sym === "ɜ" ? { ...t, sym: "ɚ" } : t));
    toks.forEach((t, k) => {
      const lesson = lessonFor(t.sym, toks[k - 1]?.sym, toks[k + 1]?.sym, t.stressed, accent);
      if (lesson) checks.push({ i: expected.length, word: wi, sym: t.sym, lesson });
      expected.push(t.sym);
    });
  });
  return { words, expected, checks };
}

export interface FreeFinding extends FreeCheck {
  verdict: Verdict;
  heard: string;
  habit?: string;
}

export interface FreeResult {
  findings: FreeFinding[];
  /** One verdict per word; null when nothing in the word was judged. */
  words: (Verdict | null)[];
  good: number;
  habits: number;
  unclear: number;
}

/** Judge a recording of the typed text. `heard` is what the model wrote, normalized. */
export function judgeFreeText(item: FreeItem, heard: string[]): FreeResult {
  const pairs = align(item.expected, heard);
  const findings = item.checks.map((c): FreeFinding => {
    const r = judge(item.expected, heard, pairs, c.i, LESSON_CHECKS[c.lesson].sounds[c.sym]);
    // An R the model didn't write at all is not proof it was dropped: in running
    // speech it misses a native American's R after a vowel ("hear", "share",
    // "software") about one time in five. Only a vowel heard in its place counts.
    if (c.lesson === "rhotic" && r.verdict === "habit" && r.heard === "∅") return { ...c, verdict: "off", heard: r.heard };
    return { ...c, ...r };
  });
  const words = item.words.map((_, wi) => {
    const mine = findings.filter((f) => f.word === wi);
    if (!mine.length) return null;
    return mine.some((f) => f.verdict === "habit") ? "habit" : mine.some((f) => f.verdict === "off") ? "off" : "good";
  });
  return {
    findings,
    words,
    good: findings.filter((f) => f.verdict === "good").length,
    habits: findings.filter((f) => f.verdict === "habit").length,
    unclear: findings.filter((f) => f.verdict === "off").length,
  };
}
