/**
 * Scoring of typed text against REAL output (tests/fixtures/freetext-heard.json):
 * 20 everyday words and sentences, pronounced by espeak (server/phonemize.py),
 * spoken by two American and two British Kokoro voices, and heard by
 * facebook/wav2vec2-lv-60-espeak-cv-ft. Native voices must come out (almost)
 * free of Indian-English habits, or the feature would blame learners wrongly.
 */
import { readFileSync } from "node:fs";
import { setAccent, type Accent } from "../src/content/accent";
import { normalizeAll } from "../src/scoring/align";
import { freeTextItem, ipaTokens, judgeFreeText, type SpokenWord } from "../src/scoring/freeText";

const fx: { texts: string[]; words: Record<Accent, SpokenWord[][]>; heard: Record<string, string[][]> } = JSON.parse(readFileSync("tests/fixtures/freetext-heard.json", "utf-8"));

let failed = 0;
function check(ok: boolean, msg: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
}
const VERBOSE = process.env.VERBOSE === "1";

const VOICES: Record<Accent, string[]> = { us: ["af_heart", "am_michael"], uk: ["bf_emma", "bm_george"] };

for (const accent of ["us", "uk"] as Accent[]) {
  setAccent(accent);
  for (const voice of VOICES[accent]) {
    let judged = 0;
    let good = 0;
    let habits = 0;
    let unclear = 0;
    const wrong: string[] = [];
    fx.texts.forEach((text, n) => {
      const item = freeTextItem(fx.words[accent][n], accent);
      const heard = normalizeAll(fx.heard[`${accent}_${voice}`][n]);
      const r = judgeFreeText(item, heard);
      judged += r.findings.length;
      good += r.good;
      habits += r.habits;
      unclear += r.unclear;
      for (const f of r.findings) {
        if (f.verdict === "habit") wrong.push(`"${item.words[f.word].text}" /${f.sym}/ heard /${f.heard}/ (${f.lesson}) in "${text}"${VERBOSE ? `\n         [exp ${item.expected.join(" ")} | got ${heard.join(" ")}]` : ""}`);
        else if (VERBOSE && f.verdict === "off") console.log(`   unclear ${accent} ${voice}: "${item.words[f.word].text}" /${f.sym}/ heard /${f.heard}/ (${f.lesson})  [exp ${item.expected.join(" ")} | got ${heard.join(" ")}]`);
      }
    });
    const pct = (x: number) => `${Math.round((100 * x) / judged)}%`;
    console.log(`     ${accent} ${voice}: ${judged} sounds judged, ${pct(good)} clean, ${pct(unclear)} unclear, ${habits} false habits${wrong.length ? `\n       ${wrong.join("\n       ")}` : ""}`);
    check(habits === 0, `${accent} ${voice}: a native voice is never blamed for a habit (${habits}/${judged})`);
    check(good >= judged * 0.85, `${accent} ${voice}: at least 85% of judged sounds come out clean (${pct(good)})`);
  }
}

// ---- the rules themselves
setAccent("us");
{
  const toks = ipaTokens("dɪvˈɛləpmənt");
  check(toks.map((t) => t.sym).join(" ") === "d ɪ v ɛ l ə p m ə n t" && toks.filter((t) => t.stressed).map((t) => t.sym).join("") === "ɛ", "development: sounds split, only the stressed vowel is marked");
  check(ipaTokens("ɡˌoʊɪŋ wˈɔːɾɚ").map((t) => t.sym).join(" ") === "g oʊ ɪ ŋ w ɔ ɾ ɚ", "diphthongs stay whole, length marks and ɡ are normalized");

  const item = freeTextItem([{ text: "and", ipa: "ænd" }, { text: "the", ipa: "ðə" }, { text: "cat", ipa: "kˈæt" }], "us");
  const byWord = (w: number) => item.checks.filter((c) => c.word === w).map((c) => `${c.sym}:${c.lesson}`).join(" ");
  check(byWord(0) === "d:alveolar-td", "an unstressed vowel (the æ in \"and\") is not judged, its D is");
  check(byWord(1) === "ð:th-voiced" && byWord(2) === "æ:ae t:alveolar-td", "\"the cat\": TH, the stressed æ and the T are judged");

  const r = (ipa: string) => freeTextItem([{ text: "x", ipa }], "us").checks.filter((c) => c.sym === "ɹ" || c.sym === "ɚ").map((c) => c.lesson).join(",");
  check(r("ɹˈɛd") === "american-r" && r("vˈɛɹi") === "american-r", "R before a vowel belongs to the American R lesson");
  check(r("kˈɑːɹ") === "rhotic" && r("hˈɑːɹd") === "rhotic" && r("bˈɜːd") === "rhotic", "R after a vowel (car, hard, bird) belongs to Keep the R");
  check(r("wˈɔːɾɚɹ") === "rhotic", "the linking R after an R-coloured vowel is left alone (only the ɚ is judged)");

  const uk = (ipa: string) => freeTextItem([{ text: "x", ipa }], "uk").checks.map((c) => `${c.sym}:${c.lesson}`).join(" ");
  setAccent("uk");
  check(uk("hˈɒt") === "t:alveolar-td" && uk("kˈɑːɹ") === "", "British: short O and R after a vowel are never judged");
  setAccent("us");
}

// ---- a learner's habits are found, on the right words
{
  const n = fx.texts.indexOf("I think this is a better way to do it.");
  const item = freeTextItem(fx.words.us[n], "us");
  const clean = normalizeAll(fx.heard.us_af_heart[n]);
  const indian = clean.map((t) => (t === "θ" ? "t̪" : t === "ð" ? "d̪" : t === "w" ? "ʋ" : t === "ɾ" ? "ʈ" : t));
  const res = judgeFreeText(item, indian);
  const flagged = res.words.map((v, i) => (v === "habit" ? item.words[i].text : null)).filter(Boolean).join(" ");
  check(flagged === "think this better way", `"I tink dis is a bettar vay to do it": habits found in think, this, better, way (got: ${flagged})`);
  check(judgeFreeText(item, clean).habits === 0, "the same sentence said natively has none");
  check(judgeFreeText(item, []).habits === 0, "silence is unclear, not a habit");
  const caa = judgeFreeText(freeTextItem([{ text: "better", ipa: "bˈɛɾɚ" }], "us"), ["b", "ɛ", "ɾ", "ə"]);
  check(caa.habits === 1 && caa.findings.find((f) => f.verdict === "habit")?.sym === "ɚ", "\"bettuh\": a plain vowel where the R-coloured one belongs is still a dropped R");
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
