/**
 * Scoring checks against REAL speech-model output (tests/fixtures/kokoro-heard.json):
 * the test phrases spoken by two American Kokoro voices, plus deliberate
 * Indian-English habits synthesized from phonemes, all run through
 * facebook/wav2vec2-lv-60-espeak-cv-ft.
 */
import { readFileSync } from "node:fs";
import { ASSESSMENT } from "../src/content/assessment";
import { buildCourse, completeDay, newProfile, planLessons, replan } from "../src/course";
import { align, judge, normalizeAll } from "../src/scoring/align";
import { LESSON_CHECKS } from "../src/scoring/checks";
import { buildAssessment, judgeItem } from "../src/scoring/report";

const heard: Record<string, string[]> = JSON.parse(readFileSync("tests/fixtures/kokoro-heard.json", "utf-8"));

let failed = 0;
function check(ok: boolean, msg: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
}

// ---- American voices should score high
for (const voice of ["af_heart", "am_michael"]) {
  const results = ASSESSMENT.map((item, i) => ({ item, heard: normalizeAll(heard[`us_${voice}_${String(i).padStart(2, "0")}`]) }));
  const a = buildAssessment(results);
  const habits = Object.entries(a.lessons).flatMap(([id, l]) => l.findings.map((f) => `${id}:${f.word}=${f.heard}`));
  check(a.overall >= 90, `American ${voice}: overall ${a.overall} (want >= 90)`);
  check(habits.length === 0, `American ${voice}: no habits flagged ${habits.length ? `(got ${habits.join(", ")})` : ""}`);
}

// ---- synthesized habits should be named
function findings(itemIndex: number, key: string) {
  return judgeItem(ASSESSMENT[itemIndex], normalizeAll(heard[key])).filter((j) => j.verdict === "habit");
}
const think = findings(1, "habit_think_dental");
check(think.length === 3 && think.every((j) => j.lesson === "th-voiceless"), `"I think three things" with T: ${think.length} TH habits found`);
const thisD = findings(2, "habit_this_d");
check(thisD.some((j) => j.lesson === "th-voiced" && j.word === "this"), `"this" said with D is caught`);
const bed = findings(7, "habit_bad_bed");
check(bed.some((j) => j.lesson === "ae" && j.word === "bad"), `"bad" said as "bed" is caught`);
const zero = findings(5, "habit_zero_j");
check(zero.some((j) => j.lesson === "z" && j.word === "zero"), `"zero" said with J is caught`);

// ---- hand-written Indian-English cases (symbols Kokoro can't produce)
function judgeOne(itemIndex: number, said: string, lesson: string, word: string) {
  const item = ASSESSMENT[itemIndex];
  const h = normalizeAll(said.split(" "));
  const pairs = align(item.expected, h);
  const c = item.checks.find((x) => x.lesson === lesson && x.word === word)!;
  return judge(item.expected, h, pairs, c.i, LESSON_CHECKS[lesson].sounds[c.sym]);
}
check(judgeOne(3, "ʈ aɪ m ʈ ə ʈ ɔ k", "alveolar-td", "time").verdict === "habit", "retroflex ʈ in 'time' is a habit");
check(judgeOne(0, "ʋ ɛ r i ʋ ɛ l", "v-w", "very").habit === "a V/W blend (ʋ)", "ʋ in 'very' is named as a V/W blend");
check(judgeOne(0, "ʋ ɛ r i ʋ ɛ l", "american-r", "very").habit === "a rolled R", "rolled r in 'very' is caught");
check(judgeOne(4, "d ə ʋ ɔː ʈ ə r ɪ z b ɛ ʈ ə r", "flap-t", "water").verdict === "habit", "full ʈ in 'water' is caught");
check(judgeOne(6, "r ɛ d k ɑː r aɪ t n aʊ", "rhotic", "car").habit?.startsWith("no R sound") === true, "non-rhotic 'car' = no R sound");
check(judgeOne(6, "ɹ ɛ d k ɑːɹ ɹ aɪ t n aʊ", "rhotic", "car").verdict === "good", "'car' with R-coloured vowel token is good");
check(judgeOne(9, "ə g r eː t d eː", "ei", "day").habit?.includes("no glide") === true, "steady eː in 'day' is caught");
check(judgeOne(9, "ə g ɹ e ɪ t d e ɪ", "ei", "day").verdict === "good", "eɪ written as two tokens still counts");

// ---- course building
const a = buildAssessment(ASSESSMENT.map((item, i) => ({ item, heard: normalizeAll(heard[`us_am_michael_${String(i).padStart(2, "0")}`]) })));
a.lessons["alveolar-td"].score = 20;
a.lessons["f"].score = 40;
const plan = planLessons(a);
check(plan[0] === "alveolar-td", `worst high-impact sound comes first (got ${plan[0]})`);
check(!plan.includes("v-w"), "sounds already at 85+ are left out of the course");
check(plan.includes("dark-l") && plan.includes("aspiration"), "sounds the test can't hear are still taught");
const skipPlan = planLessons(null);
check(skipPlan[0] === "alveolar-td" && skipPlan.length === 16, "skipping the test gives the full standard course");
const course = buildCourse(null);
check(course.filter((d) => d.kind === "checkup").length >= 3 && course[5].kind === "checkup", "a check-up after every 5 lessons");

let p = newProfile(a, false);
p = completeDay(p);
check(p.day === 1 && p.streak.count === 1 && !!p.course[0].completedAt, "finishing a day advances and starts a streak");
const b = { ...a, lessons: { ...a.lessons, ["alveolar-td"]: { ...a.lessons["alveolar-td"], score: 95 } } };
const p2 = replan(p, b);
check(p2.history.length === 2 && p2.course[0].completedAt !== undefined, "re-test keeps finished days and records history");

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
