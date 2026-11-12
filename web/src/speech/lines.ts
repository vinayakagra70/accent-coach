/**
 * Every line Nova can say. The app builds speech only through these functions,
 * and tools/utterances.ts enumerates them for pre-rendering, so nothing she
 * says on the phone is missing its audio.
 */
import type { Lesson } from "../content/lessons";

export const lines = {
  good: (sym: string) => `Nice. That ${sym === "θ" || sym === "ð" ? "TH" : "sound"} was clean.`,
  habit: (habit: string) => `Close. You said ${habit}. Watch the mouth, then try it again.`,
  unclear: () => "I couldn't hear that clearly. Try once more, a little slower.",
  dayDone: (day: number) => `Day ${day} done. Same time tomorrow?`,
  report: (score: number, previous?: number, firstLesson?: string) => {
    let s = `Your score is ${score} out of 100.`;
    if (previous !== undefined) {
      const d = score - previous;
      s += d === 0 ? " Same as last time." : ` That's ${d > 0 ? "up" : "down"} ${Math.abs(d)} from last time.`;
    }
    if (firstLesson) s += ` We'll start with ${shortTitle(firstLesson)}.`;
    return s;
  },
  switched: (accentLong: string) => `Now practising ${accentLong}. Take the voice test again so your course fits it.`,
  explain: (l: Lesson) => `${l.mistake} ${l.steps[0]}`,
};

/** "TH (think)" → "TH", for speaking. */
export function shortTitle(title: string): string {
  return title.replace(/\s*\(.*\)/, "");
}
