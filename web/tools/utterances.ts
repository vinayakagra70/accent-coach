/**
 * Lists every clip the phone build needs: each lesson word at two speeds and
 * every sentence Nova can say, for both accents. Output: JSON for
 * tools/render_voice.py.   node <bundled>.js out.json
 */
import { writeFileSync } from "node:fs";
import { ACCENTS, setAccent, type Accent } from "../src/content/accent";
import { LESSONS, LEXICON } from "../src/content/lessons";
import { ALL_PHRASES, CONVERSATIONS } from "../src/content/phrases";
import { sentenceText } from "../src/content/sentences";
import { LESSON_CHECKS } from "../src/scoring/checks";
import { clipKey, splitSentences, type Speed } from "../src/speech/clips";
import { lines } from "../src/speech/lines";

interface Entry {
  key: string;
  accent: Accent;
  kind: "word" | "line";
  speed: Speed;
  text: string;
}

const out = new Map<string, Entry>();
const add = (accent: Accent, kind: "word" | "line", speed: Speed, text: string) => {
  const key = clipKey(accent, kind, speed, text);
  out.set(key, { key, accent, kind, speed, text: text.trim() });
};
const say = (accent: Accent, text: string) => splitSentences(text).forEach((s) => add(accent, "line", "normal", s));

for (const accent of ["us", "uk"] as Accent[]) {
  setAccent(accent);
  for (const w of Object.keys(LEXICON)) for (const sp of ["normal", "slow"] as Speed[]) add(accent, "word", sp, w);
  // the practice sentences' "Hear it" button (spoken like a model word, at normal speed)
  for (const l of LESSONS) {
    const s = sentenceText(l.id);
    if (s) add(accent, "word", "normal", s);
  }
  // the everyday phrases, the same way
  for (const p of ALL_PHRASES) add(accent, "word", "normal", p);
  // and the coach's side of each conversation
  for (const c of CONVERSATIONS) for (const t of c.turns) add(accent, "word", "normal", t.ask);

  for (const sym of ["θ", "t"]) say(accent, lines.good(sym));
  for (const check of Object.values(LESSON_CHECKS))
    for (const s of Object.values(check.sounds)) for (const habit of Object.values(s.habits)) say(accent, lines.habit(habit));
  say(accent, lines.unclear());
  for (let d = 1; d <= 40; d++) say(accent, lines.dayDone(d));
  for (let score = 0; score <= 100; score++) say(accent, lines.report(score));
  for (let d = 0; d <= 100; d++) {
    say(accent, lines.report(50, 50 - d)); // "up d"
    say(accent, lines.report(50, 50 + d)); // "down d"
  }
  for (const l of LESSONS) say(accent, lines.explain(l));
  for (const a of Object.values(ACCENTS)) say(accent, lines.switched(a.long));

  // the report, read out (every score band, flaw, count and first lesson)
  for (const score of [95, 80, 60, 30]) say(accent, lines.reportBand(score));
  for (const l of LESSONS) for (const i of [0, 1]) say(accent, lines.reportFlaw(i, l.title));
  say(accent, lines.reportFlawHow());
  say(accent, lines.reportNoFlaws());
  for (let n = 1; n <= LESSONS.length; n++) {
    say(accent, lines.reportGood(n));
    say(accent, lines.reportCourse(n));
  }
  for (const l of LESSONS) say(accent, lines.reportCourse(1, l.title));
  say(accent, lines.reportStart());
  // the first-day tour
  for (const line of Object.values(lines.tour)) say(accent, line());
}

const list = [...out.values()];
writeFileSync(process.argv[2], JSON.stringify(list, null, 0));
const words = list.filter((e) => e.kind === "word").length;
console.log(`${list.length} clips (${words} words, ${list.length - words} sentences)`);
