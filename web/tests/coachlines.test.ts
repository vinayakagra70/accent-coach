/** What Nova says while reading the report and during the first-day tour. */
import { setAccent } from "../src/content/accent";
import { LESSONS } from "../src/content/lessons";
import { splitSentences } from "../src/speech/clips";
import { lines, spokenName } from "../src/speech/lines";

let failed = 0;
function check(ok: boolean, msg: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
}

setAccent("us");

// score bands: one sentence per band, switching exactly at 90, 75 and 55
{
  const band = (s: number) => lines.reportBand(s);
  check(band(100) === band(90) && band(90) !== band(89), "90 starts the top band");
  check(band(89) === band(75) && band(75) !== band(74), "75 starts the second band");
  check(band(74) === band(55) && band(55) !== band(54), "55 starts the third band");
  check(band(54) === band(0), "below 55 is one band");
  check(new Set([95, 80, 60, 30].map(band)).size === 4, "four different band sentences");
  check(band(95).includes("General American"), "the top band names the accent");
  setAccent("uk");
  check(lines.reportBand(95).includes("British English"), "and the British one in British mode");
  check(lines.tour.watch().includes("British way"), "the tour says British in British mode");
  setAccent("us");
  check(lines.tour.watch().includes("American way"), "and American in American mode");
  check(lines.tour.compare().includes("American way on the right"), "the comparison line names the accent's side");
}

// flaws, counts and the course
{
  const th = LESSONS.find((l) => l.title.startsWith("TH"))!;
  check(lines.reportFlaw(0, th.title) === "The biggest thing to fix is the TH in think.", `first flaw names the sound (${lines.reportFlaw(0, th.title)})`);
  check(lines.reportFlaw(1, th.title) === "Next is the TH in think.", "second flaw is shorter");
  check(lines.reportGood(1) === "One sound is already good.", "one good sound is singular");
  check(lines.reportGood(4) === "4 sounds are already good.", "several good sounds");
  check(lines.reportCourse(1) === "I've made you a course: one sound, one a day.", "a one-sound course is singular");
  const course = lines.reportCourse(9, th.title);
  const parts = splitSentences(course);
  check(parts.length === 2 && parts[0] === lines.reportCourse(9) && parts[1] === "We start with the TH in think.",
    `the course line splits into two pre-recordable sentences (${JSON.stringify(parts)})`);
}

// every sound has a name that can be spoken, distinct from the others, in both accents
for (const acc of ["us", "uk"] as const) {
  setAccent(acc);
  const names = LESSONS.map((l) => spokenName(l.title));
  check(names.every((n) => /^[\x20-\x7E]+$/.test(n)), `${acc}: every spoken name is plain letters (${names.join(" | ")})`);
  check(new Set(names).size === names.length, `${acc}: no two sounds share a spoken name`);
  check(names.every((n) => !/^The /.test(n)), `${acc}: names read mid-sentence (no capital The)`);
}
setAccent("us");
check(spokenName("Æ (cat, bad)") === "the vowel in cat", "Æ is said as the vowel in cat");
check(spokenName("Small words (to, can)") === "small words like to and can", "the weak-words lesson is said naturally");

// copy rules shared by every line
{
  const all = [
    ...[95, 80, 60, 30].map((s) => lines.reportBand(s)),
    lines.reportFlawHow(), lines.reportNoFlaws(), lines.reportStart(),
    ...Object.values(lines.tour).map((f) => f()),
  ];
  check(all.every((t) => !/[—–]/.test(t)), "no dashes in what Nova says");
  check(all.every((t) => /[.!]$/.test(t)), "every line ends a sentence");
  check(Object.keys(lines.tour).length === 11, "nine day-tour stops plus two for before there is a course");
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exit(1);
