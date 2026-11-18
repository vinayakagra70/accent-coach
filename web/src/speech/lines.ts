/**
 * Every line Nova can say. The app builds speech only through these functions,
 * and tools/utterances.ts enumerates them for pre-rendering, so nothing she
 * says on the phone is missing its audio.
 */
import { accentInfo } from "../content/accent";
import type { Lesson } from "../content/lessons";

export const lines = {
  good: (sym: string) => `Nice. That ${sym === "θ" || sym === "ð" ? "TH" : "sound"} was clean.`,
  habit: (habit: string) => `Close. You said ${habit}. Watch the mouth, then try it again.`,
  unclear: () => "I couldn't hear that clearly. Try once more, a little slower.",
  dayDone: (day: number) => `Day ${day} done. Same time tomorrow?`,
  report: (score: number, previous?: number) => {
    let s = `Your score is ${score} out of 100.`;
    if (previous !== undefined) {
      const d = score - previous;
      s += d === 0 ? " Same as last time." : ` That's ${d > 0 ? "up" : "down"} ${Math.abs(d)} from last time.`;
    }
    return s;
  },
  switched: (accentLong: string) => `Now practising ${accentLong}. Take the voice test again so your course fits it.`,
  explain: (l: Lesson) => `${l.mistake} ${l.steps[0]}`,

  // ---- the report, read out part by part (ui/onboarding.ts highlights each part as she says it)
  reportBand: (score: number) =>
    score >= 90 ? `That's very close to ${accentInfo().long}. Just a little polishing left.` :
    score >= 75 ? "That's clear. Only a few sounds give the accent away." :
    score >= 55 ? "People understand you well, but several sounds still sound Indian. The good news: they're quick to fix." :
    "Your Indian accent is strong, which means lots of quick wins. We'll go one sound at a time.",
  reportFlaw: (i: number, title: string) => i === 0 ? `The biggest thing to fix is ${spokenName(title)}.` : `Next is ${spokenName(title)}.`,
  reportFlawHow: () => "Each card shows the word where I heard it, and what you said instead.",
  reportNoFlaws: () => "I didn't hear anything major to fix. Nice work.",
  reportGood: (n: number) => n === 1 ? "One sound is already good." : `${n} sounds are already good.`,
  reportCourse: (n: number, firstTitle?: string) =>
    `I've made you a course: ${n === 1 ? "one sound" : `${n} sounds`}, one a day.${firstTitle ? ` We start with ${spokenName(firstTitle)}.` : ""}`,
  reportStart: () => "Tap Start day 1, and I'll show you what to do.",

  // ---- the first-day tour (ui/tour.ts): one line per spotlighted part of the screen
  tour: {
    plan: () => "This is today's plan. Go from top to bottom. Each step gets a tick when it's done.",
    watch: () => `First, tap Watch and hear. The mouth shows the ${accentInfo().name} way, and I'll say the sound.`,
    mouth: () => "This is the mouth. Drag it to turn it around. The yellow dot shows where to touch.",
    habit: () => "Then see your Indian habit, so you know exactly what to change.",
    ear: () => "Next, train your ear. Press Play a word, then pick the word you heard.",
    scored: () => "Then tap each word and say it. I'll tell you if it sounded right.",
    sentence: () => "Last, say the sound in a sentence. Hear me first, then yourself.",
    finish: () => "When every step has a tick, tap Finish day. That's it. Let's start!",
  },
};

/** "TH (think)" → "TH", for speaking. */
export function shortTitle(title: string): string {
  return title.replace(/\s*\(.*\)/, "");
}

/**
 * A lesson's name as said in the middle of a sentence. The titles are written
 * for reading: "Æ" can't be spoken, and both TH lessons shorten to "TH".
 *   "TH (think)" → "the TH in think", "Æ (cat, bad)" → "the vowel in cat",
 *   "Drop the R (car, bird)" → "the R in car", "Clear T (water, better)" → "the T in water".
 */
export function spokenName(title: string): string {
  const ex = title.match(/\(([^,)]+)/)?.[1]?.trim();
  const short = shortTitle(title);
  if (ex && /^TH$/.test(short)) return `the TH in ${ex}`;
  if (ex && /\bthe R$/.test(short)) return `the R in ${ex}`;
  if (ex && /^Clear T$/.test(short)) return `the T in ${ex}`;
  if (/^Dark L$/.test(short)) return "the dark L";
  if (/^Puff on/.test(short)) return "the puff on P, T and K";
  if (ex && (/[^\x00-\x7F]/.test(short) || /glide$|^Open |^Short /.test(short))) return `the vowel in ${ex}`;
  return short.replace(/^The /, "the ");
}
