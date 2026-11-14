/**
 * Bugs found in the pure logic (course re-planning, silence, NaN), one check each.
 */
import { ASSESSMENT } from "../src/content/assessment";
import { LESSONS } from "../src/content/lessons";
import { newProfile, replan, type Assessment, type CourseDay, type Profile } from "../src/course";
import * as progress from "../src/progress";
import { align, judge } from "../src/scoring/align";
import { US_CHECKS } from "../src/scoring/checks";
import { buildAssessment } from "../src/scoring/report";

let failed = 0;
function check(ok: boolean, msg: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
}

function assessment(score: (id: string) => number | null): Assessment {
  const lessons: Assessment["lessons"] = {};
  for (const l of LESSONS) lessons[l.id] = { score: score(l.id), good: 0, total: 0, findings: [] };
  return { date: "2026-11-14T10:00:00.000Z", overall: 75, lessons };
}
const show = (days: CourseDay[]) => days.map((d) => (d.kind === "checkup" ? "CHECK" : d.lesson)).join(" ");

// ---- replan: a taught lesson the test can't score must not come back for ever
{
  const base = newProfile(null, true);
  const p: Profile = {
    ...base,
    course: [{ kind: "lesson", lesson: "aspiration", completedAt: "2026-11-13T10:00:00.000Z" }, { kind: "checkup" }],
    day: 1,
  };
  // aspiration and dark-l are never voice-tested, so their score is always null
  const a = assessment((id) => (id === "aspiration" || id === "dark-l" ? null : 90));
  const r = replan(p, a);
  const times = r.course.filter((d) => d.lesson === "aspiration").length;
  check(times === 1, `a finished, untested lesson is not taught again after a check-up (course: ${show(r.course)})`);
  check(r.course.some((d) => d.lesson === "dark-l"), "an untested lesson not yet taught is still planned");
}

// ---- replan: check-ups stay five lessons apart
{
  const a = assessment((id) => (US_CHECKS[id]?.voiceTested ? 75 : null));
  const p0 = newProfile(a, false);
  check(p0.course[5]?.kind === "checkup", "day 6 of a new course is a check-up");
  const r = replan({ ...p0, day: 5 }, a); // the learner takes that check-up, same results
  const rest = r.course.slice(r.day);
  check(r.day === 6 && rest[0]?.kind === "lesson", `the day after a check-up is a lesson, not another check-up (rest: ${show(rest)})`);
  let run = 0;
  let spacingOk = true;
  rest.forEach((d, i) => {
    if (d.kind === "lesson") run++;
    else {
      if (run !== 5 && i !== rest.length - 1) spacingOk = false;
      if (run === 0) spacingOk = false;
      run = 0;
    }
  });
  check(spacingOk, `after re-planning, each check-up follows five lessons (rest: ${show(rest)})`);
  check(rest[rest.length - 1]?.kind === "checkup", "the re-planned course still ends with a check-up");

  // A weak sound taught already does come back (unchanged behaviour).
  const first = p0.course[0].lesson!;
  const weak = replan({ ...p0, day: 5 }, assessment((id) => (id === first ? 40 : US_CHECKS[id]?.voiceTested ? 75 : null)));
  check(weak.course.slice(weak.day).some((d) => d.lesson === first), "a taught sound that is still weak comes back");
}

// ---- silence is not a dropped R
{
  const expected = ["k", "ɑ", "ɹ"];
  const r = judge(expected, [], align(expected, []), 2, US_CHECKS.rhotic.sounds["ɹ"]);
  check(r.verdict === "off", `"car" with nothing heard is unclear, not a habit (got ${r.verdict}${r.habit ? `: ${r.habit}` : ""})`);
  const dropped = judge(expected, ["k", "ɑ"], align(expected, ["k", "ɑ"]), 2, US_CHECKS.rhotic.sounds["ɹ"]);
  check(dropped.verdict === "habit", `"car" heard as "kɑ" is still a dropped R`);
}
{
  const a = buildAssessment(ASSESSMENT.map((item) => ({ item, heard: [] as string[] })));
  const found = Object.values(a.lessons).flatMap((l) => l.findings);
  const scored = Object.entries(a.lessons).filter(([, l]) => l.score !== null).map(([id, l]) => `${id}=${l.score}`);
  check(found.length === 0, `a silent voice test names no habits (got ${found.length})`);
  check(scored.length === 0 && a.phrases === 0, `a silent voice test scores nothing (got ${scored.join(", ") || "none"}, phrases ${a.phrases})`);
}

// ---- a NaN vowel score must not wipe the best score
{
  progress.resetAll();
  progress.recordVowel("ae", 80);
  progress.recordVowel("ae", NaN);
  check(progress.get("ae").bestVowel === 80, `best vowel score survives a NaN attempt (got ${progress.get("ae").bestVowel})`);
  check(progress.mastery("ae") === 80, `mastery is still 80 (got ${progress.mastery("ae")})`);
  progress.resetAll();
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
