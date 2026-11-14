/**
 * The everyday phrases against REAL speech-model output
 * (tests/fixtures/phrases-heard.json, written by `python -m tools.phrases --heard`):
 * each phrase spoken by two American and two British Kokoro voices and heard by
 * facebook/wav2vec2-lv-60-espeak-cv-ft. A native voice must never be told it
 * has an Indian-English habit.
 */
import { existsSync, readFileSync } from "node:fs";
import { LESSONS, LEXICON } from "../src/content/lessons";
import { setAccent, type Accent } from "../src/content/accent";
import { ALL_PHRASES, CONVERSATIONS, PHRASE_PACKS, phraseWords } from "../src/content/phrases";
import { normalizeAll } from "../src/scoring/align";
import { freeTextItem, judgeFreeText } from "../src/scoring/freeText";
import { clipKey } from "../src/speech/clips";

const heard: Record<string, Record<string, string[]>> = JSON.parse(readFileSync("tests/fixtures/phrases-heard.json", "utf-8"));

let failed = 0;
function check(ok: boolean, msg: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
}

const VOICES: Record<Accent, string[]> = { us: ["af_heart", "am_michael"], uk: ["bf_emma", "bm_george"] };
const packed = PHRASE_PACKS.flatMap((p) => p.phrases);
const texts = ALL_PHRASES;

check(new Set(packed).size === packed.length, "no phrase appears twice");
check(CONVERSATIONS.every((c) => c.turns.length >= 3 && c.turns.every((t) => t.replies.length >= 2)), "every conversation has at least 3 turns with a choice of replies");
check(texts.every((t) => t.length <= 60 && /[.?!]$/.test(t) && !/[.?!]./.test(t)), "every phrase is one short sentence (one voice clip each)");

for (const accent of ["us", "uk"] as Accent[]) {
  setAccent(accent);
  const noIpa = texts.filter((t) => !phraseWords(t, accent));
  check(noIpa.length === 0, `${accent}: every phrase has its pronunciation (run python -m tools.phrases) ${noIpa.join(" | ")}`);
  const thin = texts.filter((t) => freeTextItem(phraseWords(t, accent) ?? [], accent).checks.length < 2);
  check(thin.length === 0, `${accent}: every phrase has at least 2 sounds to judge ${thin.join(" | ")}`);

  for (const voice of VOICES[accent]) {
    let judged = 0;
    let good = 0;
    const wrong: string[] = [];
    const murky: string[] = [];
    for (const t of texts) {
      const item = freeTextItem(phraseWords(t, accent) ?? [], accent);
      const h = normalizeAll(heard[`${accent}_${voice}`]?.[t] ?? []);
      const r = judgeFreeText(item, h);
      judged += r.findings.length;
      good += r.good;
      for (const f of r.findings) if (f.verdict === "habit") wrong.push(`"${item.words[f.word].text}" /${f.sym}/ heard /${f.heard}/ (${f.lesson}) in "${t}" [got ${h.join(" ")}]`);
      // more than a third unclear and the phrase would frustrate even a good speaker
      if (r.unclear * 3 > r.findings.length) murky.push(`"${t}" ${r.unclear}/${r.findings.length} [exp ${item.expected.join(" ")} | got ${h.join(" ")}]`);
    }
    check(wrong.length === 0, `${accent} ${voice}: no phrase blames a native voice for a habit${wrong.length ? `\n       ${wrong.join("\n       ")}` : ""}`);
    check(murky.length === 0, `${accent} ${voice}: no phrase is mostly unclear${murky.length ? `\n       ${murky.join("\n       ")}` : ""}`);
    check(good >= judged * 0.9, `${accent} ${voice}: at least 90% of ${judged} judged sounds come out clean (${Math.round((100 * good) / judged)}%)`);
  }
}
setAccent("us");

// a learner's habits are found in a phrase
{
  const t = "Thank you for having me today.";
  const item = freeTextItem(phraseWords(t, "us")!, "us");
  const indian = normalizeAll(heard.us_af_heart[t]).map((x) => (x === "θ" ? "t̪" : x === "v" ? "ʋ" : x));
  const r = judgeFreeText(item, indian);
  const flagged = r.words.map((v, i) => (v === "habit" ? item.words[i].text : null)).filter(Boolean).join(" ");
  check(flagged === "Thank having", `"Tank you for hawing me today": habits found in Thank and having (got: ${flagged})`);
}

// the hosted build has a voice clip for every phrase
{
  const manifest: { clips: string[] } = JSON.parse(readFileSync("public/audio/manifest.json", "utf-8"));
  const have = new Set(manifest.clips);
  const spoken = [...texts, ...CONVERSATIONS.flatMap((c) => c.turns.map((t) => t.ask))];
  const none = (["us", "uk"] as Accent[]).flatMap((a) => spoken.filter((t) => !have.has(clipKey(a, "word", "normal", t))).map((t) => `${a}: ${t}`));
  check(none.length === 0, `every phrase has a pre-rendered clip in both accents (run npm run voices)${none.length ? `: ${none.length} missing, e.g. ${none[0]}` : ""}`);
}

// every lesson can be heard both ways: a model word for the target, a recorded clip for the Indian habit
{
  const habits: Record<string, { word: string; sound?: { targets: string[] } }> = JSON.parse(readFileSync("src/content/habits.json", "utf-8"));
  const bad = LESSONS.filter((l) => {
    const h = habits[l.id];
    const sounds = h?.sound ? [`habit/${l.id}-sound`, ...h.sound.targets.map((_, i) => `sound/${l.id}-${i}`)] : [];
    return !h || !l.words.includes(h.word) || !LEXICON[h.word] || ![`habit/${l.id}`, ...sounds].every((f) => existsSync(`public/audio/${f}.mp3`));
  }).map((l) => l.id);
  check(bad.length === 0, `every lesson has a habit clip of one of its own words (run python -m tools.habit_voice) ${bad.join(" ")}`);
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
