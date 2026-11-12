/**
 * British English target: word conversion, lessons, and scoring of real
 * speech-model output for Kokoro's British voices (tests/fixtures/kokoro-heard-uk.json).
 */
import { readFileSync } from "node:fs";
import { ASSESSMENT } from "../src/content/assessment";
import { setAccent } from "../src/content/accent";
import { toBritish } from "../src/content/british";
import { LESSONS, LEXICON, US_LEXICON } from "../src/content/lessons";
import { buildCourse } from "../src/course";
import { normalizeAll } from "../src/scoring/align";
import { LESSON_CHECKS } from "../src/scoring/checks";
import { buildAssessment, judgeItem } from "../src/scoring/report";

let failed = 0;
function check(ok: boolean, msg: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
}
const j = (a: string[]) => a.join(" ");

// ---- word conversion
const uk = (w: string) => j(toBritish(w, US_LEXICON[w]));
check(uk("car") === "k ɑ", `car → /${uk("car")}/ (no R)`);
check(uk("water") === "w ɔ t ə", `water → /${uk("water")}/`);
check(uk("better") === "b ɛ t ə", `better → /${uk("better")}/ (T, no flap, no R)`);
check(uk("bird") === "b ɜ d", `bird → /${uk("bird")}/`);
check(uk("hot") === "h ɒ t", `hot → /${uk("hot")}/`);
check(uk("go") === "g əʊ", `go → /${uk("go")}/`);
check(uk("very") === "v ɛ ɹ i", `very keeps its R before a vowel: /${uk("very")}/`);
check(uk("there") === "ð ɛ ə", `there → /${uk("there")}/`);
check(uk("fast") === "f ɑ s t", `fast → /${uk("fast")}/ (bath vowel)`);

// ---- switching the active accent
setAccent("uk");
check(LEXICON === LEXICON && j(LEXICON["car"]) === "k ɑ", "setAccent('uk') swaps the lexicon everywhere");
check(LESSONS.find((l) => l.id === "rhotic")!.title === "Drop the R (car, bird)", "the R lesson flips to 'Drop the R'");
check(!LESSONS.some((l) => /American/.test(l.title + l.mistake + l.steps.join(" "))), "no 'American' left in British lessons");
check(LESSON_CHECKS.rhotic.voiceTested === false, "R-dropping is taught, not scored (the model can't hear it)");
check(!ASSESSMENT.some((i) => i.checks.some((c) => c.lesson === "rhotic")), "the British test has no R-dropping checks");
check(buildCourse(null).some((d) => d.lesson === "rhotic"), "…but it's still in the course");

// ---- real model output for British voices
const heard: Record<string, string[]> = JSON.parse(readFileSync("tests/fixtures/kokoro-heard-uk.json", "utf-8"));
for (const voice of ["bf_emma", "bm_george"]) {
  const results = ASSESSMENT.map((item, i) => ({ item, heard: normalizeAll(heard[`uk_${voice}_${String(i).padStart(2, "0")}`]) }));
  const a = buildAssessment(results);
  const habits = Object.entries(a.lessons).flatMap(([id, l]) => l.findings.map((f) => `${id}:${f.word}=${f.heard}`));
  check(a.overall >= 85, `British ${voice}: overall ${a.overall} (want >= 85)`);
  check(habits.length === 0, `British ${voice}: no habits flagged ${habits.length ? `(got ${habits.join(", ")})` : ""}`);
}
const flat = judgeItem(ASSESSMENT[8], normalizeAll(heard["ukhabit_hot_flat"])).filter((x) => x.verdict === "habit");
check(flat.some((x) => x.lesson === "ah"), `flat "haat" for British "hot" is caught (${flat.map((x) => x.habit).join("; ")})`);
const steady = judgeItem(ASSESSMENT[10], normalizeAll(heard["ukhabit_go_steady"])).filter((x) => x.verdict === "habit");
check(steady.length === 3 && steady.every((x) => x.lesson === "ou"), `steady "o" in "No, go slow" is caught ${steady.length}/3`);

setAccent("us");
check(j(LEXICON["car"]) === "k ɑ ɹ", "switching back to American restores everything");

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
