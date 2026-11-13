/**
 * The practice sentences against REAL speech-model output
 * (tests/fixtures/sentences-heard.json): each sentence spoken by two American
 * and two British Kokoro voices, run through facebook/wav2vec2-lv-60-espeak-cv-ft.
 * A native voice must never be told it has an Indian-English habit.
 */
import { readFileSync } from "node:fs";
import { setAccent, type Accent } from "../src/content/accent";
import { LESSONS, LEXICON } from "../src/content/lessons";
import { SENTENCES, sentenceItem, sentenceWords } from "../src/content/sentences";
import { normalizeAll } from "../src/scoring/align";
import { LESSON_CHECKS } from "../src/scoring/checks";
import { judgeItem } from "../src/scoring/report";

const heard: Record<string, string[]> = JSON.parse(readFileSync("tests/fixtures/sentences-heard.json", "utf-8"));

let failed = 0;
function check(ok: boolean, msg: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
}

const VOICES: Record<Accent, string[]> = { us: ["af_heart", "am_michael"], uk: ["bf_emma", "bm_george"] };

for (const accent of ["us", "uk"] as Accent[]) {
  setAccent(accent);

  // every scored lesson has a sentence, and every sentence can be built
  const scored = LESSONS.filter((l) => LESSON_CHECKS[l.id]?.voiceTested);
  const missing = scored.filter((l) => !sentenceItem(l.id) && !(SENTENCES[l.id]?.only && SENTENCES[l.id].only !== accent)).map((l) => l.id);
  check(missing.length === 0, `${accent}: every scored lesson has a sentence ${missing.length ? `(missing ${missing.join(", ")})` : ""}`);
  const unscored = LESSONS.filter((l) => !LESSON_CHECKS[l.id]?.voiceTested && sentenceItem(l.id)).map((l) => l.id);
  check(unscored.length === 0, `${accent}: lessons the model can't hear have no scored sentence ${unscored.join(", ")}`);

  for (const [id, s] of Object.entries(SENTENCES)) {
    const words = sentenceWords(s.text);
    const stray = s.focus.filter((w) => !words.includes(w) || !LEXICON[w]);
    if (stray.length) check(false, `${accent} ${id}: focus words not in the sentence or lexicon: ${stray.join(", ")}`);
    const item = sentenceItem(id);
    if (!item) continue;
    const unjudged = s.focus.filter((w) => !item.checks.some((c) => c.word === w));
    if (unjudged.length) check(false, `${accent} ${id}: focus words with nothing to judge: ${unjudged.join(", ")}`);

    for (const voice of VOICES[accent]) {
      const h = normalizeAll(heard[`${accent}_${voice}_${id}`] ?? []);
      const judged = judgeItem(item, h);
      const habits = judged.filter((j) => j.verdict === "habit").map((j) => `${j.word} /${j.sym}/ heard /${j.heard}/`);
      const good = judged.filter((j) => j.verdict === "good").length;
      const off = judged.filter((j) => j.verdict === "off").map((j) => `${j.word} /${j.sym}/ heard /${j.heard}/`);
      check(
        // one "unclear" is tolerated (it costs a learner nothing but a retry); a false habit never is
        habits.length === 0 && good >= judged.length - 1,
        `${accent} ${voice} "${s.text}": ${good}/${judged.length} clean${habits.length ? `, HABITS ${habits.join("; ")}` : ""}${off.length ? `, unclear ${off.join("; ")}` : ""}${habits.length || off.length ? `  [heard /${h.join(" ")}/]` : ""}`,
      );
    }
  }
}
setAccent("us");

// a learner's habit in the sentence is caught, on the right word
{
  const item = sentenceItem("th-voiceless")!;
  const tink = normalizeAll(heard["us_af_heart_th-voiceless"]).map((t) => (t === "θ" ? "t̪" : t));
  const j = judgeItem(item, tink);
  check(j.every((x) => x.verdict === "habit") && j.map((x) => x.word).join(" ") === "think math thanks", `"I tink mat is easy, tanks": all three TH habits found (${j.map((x) => `${x.word}:${x.verdict}`).join(", ")})`);
  setAccent("uk");
  check(sentenceItem("ah") === null && sentenceItem("rhotic") === null, "British: no scored sentence for short O or R-dropping (the model can't judge them)");
  setAccent("us");
  const vw = judgeItem(sentenceItem("v-w")!, normalizeAll(heard["us_af_heart_v-w"]).map((t) => (t === "v" || t === "w" ? "ʋ" : t)));
  check(vw.every((x) => x.verdict === "habit"), "\"We work very well\" with one V/W blend throughout: every V and W is flagged");
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
