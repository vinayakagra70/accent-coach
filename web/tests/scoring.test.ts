/**
 * Scoring checks against REAL speech-model output (tests/fixtures/kokoro-heard.json):
 * the test phrases spoken by two American Kokoro voices, plus deliberate
 * Indian-English habits synthesized from phonemes, all run through
 * facebook/wav2vec2-lv-60-espeak-cv-ft.
 */
import { readFileSync } from "node:fs";
import { ASSESSMENT } from "../src/content/assessment";
import { LESSONS } from "../src/content/lessons";
import { buildCourse, completeDay, currentStreak, dayKey, dayReady, dayRequirements, finishedToday, newProfile, planLessons, replan, withNewLessons } from "../src/course";
import { mergeLesson } from "../src/progress";
import { buildIcs, friendlyTime, googleCalendarUrl, parseTime } from "../src/reminder";
import { REVIEW_PER_DAY, dueReviews, recordAttempt } from "../src/review";
import { layout } from "../src/ui/scoreChart";
import { align, judge, normalizeAll } from "../src/scoring/align";
import { LESSON_CHECKS } from "../src/scoring/checks";
import { buildAssessment, judgeItem } from "../src/scoring/report";

const heard: Record<string, string[]> = JSON.parse(readFileSync(process.env.HEARD ?? "tests/fixtures/kokoro-heard.json", "utf-8"));

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

// ---- alignment always finishes, whatever was heard
{
  const long = "ð ə d ɑ k t ɚ s ɛ d d ɪ n ɚ ɪ z æ t t ɛ n t ə d eɪ".split(" ");
  const nothing = align(long, []);
  check(nothing.length === long.length && nothing.every((p, i) => p.exp === i && p.got === -1), "a long phrase heard as nothing: every sound is simply missing (this used to hang)");
  const extra = align([], long);
  check(extra.length === long.length && extra.every((p, i) => p.exp === -1 && p.got === i), "sounds with nothing expected are all extras");
  for (const cut of [1, 5, 9, 14, 20]) {
    const pairs = align(long, long.slice(cut));
    check(pairs.filter((p) => p.exp >= 0).length === long.length && pairs.filter((p) => p.got >= 0).length === long.length - cut, `a recording missing its first ${cut} sounds still lines up`);
  }
}

// ---- course building
const a = buildAssessment(ASSESSMENT.map((item, i) => ({ item, heard: normalizeAll(heard[`us_am_michael_${String(i).padStart(2, "0")}`]) })));
a.lessons["alveolar-td"].score = 20;
a.lessons["f"].score = 40;
const plan = planLessons(a);
check(plan[0] === "alveolar-td", `worst high-impact sound comes first (got ${plan[0]})`);
check(!plan.includes("v-w"), "sounds already at 85+ are left out of the course");
check(plan.includes("dark-l") && plan.includes("aspiration"), "sounds the test can't hear are still taught");
const skipPlan = planLessons(null);
check(skipPlan[0] === "alveolar-td" && skipPlan.length === LESSONS.length, "skipping the test gives the full standard course");
{
  // a course planned before the weak-words lesson existed gets it once, before the final check-up
  const old = newProfile(null, true);
  old.course = old.course.filter((d) => d.lesson !== "weak-words");
  old.day = 2;
  const up = withNewLessons(old);
  const at = up.course.findIndex((d) => d.lesson === "weak-words");
  check(at === up.course.length - 2 && up.course[up.course.length - 1].kind === "checkup", "a lesson added later slots in before the final check-up");
  check(withNewLessons(up) === up && up.day === 2, "and only once, without moving the current day");
  const done = { ...old, day: old.course.length };
  check(withNewLessons(done).course[done.day]?.lesson === "weak-words", "a finished course gets it as its next day");
}
const course = buildCourse(null);
check(course.filter((d) => d.kind === "checkup").length >= 3 && course[5].kind === "checkup", "a check-up after every 5 lessons");

let p = newProfile(a, false);
p = completeDay(p);
check(p.day === 1 && p.streak.count === 1 && !!p.course[0].completedAt, "finishing a day advances and starts a streak");
const b = { ...a, lessons: { ...a.lessons, ["alveolar-td"]: { ...a.lessons["alveolar-td"], score: 95 } } };
const p2 = replan(p, b);
check(p2.history.length === 2 && p2.course[0].completedAt !== undefined, "re-test keeps finished days and records history");

// ---- streaks go by the learner's own calendar day, not UTC
{
  const late = new Date(2026, 10, 10, 23, 30); // 11:30 pm
  const early = new Date(2026, 10, 11, 1, 0); // 1 am the next day
  let s = completeDay(newProfile(null, true), late);
  check(dayKey(late) === "2026-11-10" && s.streak.lastDate === "2026-11-10", "a day finished at 11:30 pm belongs to that date");
  check(finishedToday(s, late) && !finishedToday(s, early), "after midnight it is no longer 'finished today'");
  s = completeDay(s, early);
  check(s.streak.count === 2, `11:30 pm then 1 am are two days in a row (streak ${s.streak.count})`);
  s = completeDay(s, new Date(2026, 10, 11, 21, 0));
  check(s.streak.count === 2, "a second lesson on the same day doesn't add to the streak");
  check(currentStreak(s, new Date(2026, 10, 12, 4, 0)) === 2, "the streak is still alive at 4 am the next day");
  check(currentStreak(s, new Date(2026, 10, 13, 0, 30)) === 0, "a missed day ends the streak");
  s = completeDay(s, new Date(2026, 10, 14, 9, 0));
  check(s.streak.count === 1, "after a gap the streak restarts at 1");
  const march = completeDay(completeDay(newProfile(null, true), new Date(2026, 1, 28, 12)), new Date(2026, 2, 1, 12));
  check(march.streak.count === 2, "28 Feb then 1 Mar are consecutive");
}

// ---- practice from two devices merges without losing any
{
  const phone = { listenRight: 7, listenTotal: 10, bestVowel: 60, lastPracticed: "2026-11-10T10:00:00.000Z" };
  const laptop = { listenRight: 3, listenTotal: 4, bestVowel: 82, lastPracticed: "2026-11-12T10:00:00.000Z" };
  const m = mergeLesson(phone, laptop);
  check(m.listenTotal === 10 && m.listenRight === 7 && m.bestVowel === 82 && m.lastPracticed === laptop.lastPracticed, "merge keeps the fuller listening record, the best vowel and the latest date");
  const same = mergeLesson(laptop, phone);
  check(JSON.stringify(same) === JSON.stringify(m), "merging in either order gives the same result");
  const none = { listenRight: 0, listenTotal: 0, bestVowel: 0, lastPracticed: null };
  check(JSON.stringify(mergeLesson(none, phone)) === JSON.stringify(phone), "merging into an unpractised lesson keeps the other copy");
}

// ---- review: a word said with a habit comes back until it's clean on three days
{
  const d = (day: number, hour = 10) => new Date(2026, 10, day, hour);
  let r = recordAttempt(undefined, "th-voiceless", "think", "habit", "a T (\"tink\")", d(10));
  check(dueReviews(r, d(10)).length === 0 && dueReviews(r, d(11)).length === 1, "a missed word is not due the same day, and is due the next");
  check(dueReviews(r, d(11))[0].habit === "a T (\"tink\")", "the review item remembers what was said");
  r = recordAttempt(r, "th-voiceless", "think", "good", undefined, d(10, 11));
  check(r["th-voiceless:think"].clean === 0, "saying it right the same day doesn't count (it isn't due yet)");
  r = recordAttempt(r, "th-voiceless", "think", "off", undefined, d(11));
  check(r["th-voiceless:think"].clean === 0 && r["th-voiceless:think"].due === "2026-11-11", "an unclear recording changes nothing");
  r = recordAttempt(r, "th-voiceless", "think", "good", undefined, d(11));
  check(r["th-voiceless:think"].clean === 1 && r["th-voiceless:think"].due === "2026-11-13", "1st clean day: back in 2 days");
  r = recordAttempt(r, "th-voiceless", "think", "good", undefined, d(11, 12));
  check(r["th-voiceless:think"].clean === 1, "repeating it in the same sitting can't clear it faster");
  r = recordAttempt(r, "th-voiceless", "think", "good", undefined, d(14));
  check(r["th-voiceless:think"].clean === 2 && r["th-voiceless:think"].due === "2026-11-18", "2nd clean day (even if late): back in 4 days");
  const slipped = recordAttempt(r, "th-voiceless", "think", "habit", "a T (\"tink\")", d(18));
  check(slipped["th-voiceless:think"].clean === 0 && slipped["th-voiceless:think"].due === "2026-11-19" && slipped["th-voiceless:think"].misses === 2, "a slip starts it over, due tomorrow");
  r = recordAttempt(r, "th-voiceless", "think", "good", undefined, d(18));
  check(r["th-voiceless:think"] === undefined, "3rd clean day: the word is done");
  check(Object.keys(recordAttempt(undefined, "v-w", "very", "good", undefined, d(10))).length === 0, "a clean word that was never missed is not tracked");
  check(recordAttempt(undefined, "v-w", "very", "habit", "x", new Date(2026, 10, 30))["v-w:very"].due === "2026-12-01", "due dates roll over the month end");

  let many: ReturnType<typeof recordAttempt> = {};
  for (const [i, w] of ["a", "b", "c", "d", "e", "f", "g", "h"].entries()) many = recordAttempt(many, "z", w, "habit", "x", d(1 + i));
  many = recordAttempt(many, "z", "h", "habit", "x", d(8, 12)); // missed twice
  const due = dueReviews(many, d(20));
  check(due.length === REVIEW_PER_DAY && due[0].word === "a", `at most ${REVIEW_PER_DAY} review words a day, the longest overdue first`);
  check(JSON.stringify(recordAttempt(many, "z", "a", "good", undefined, d(20))) !== JSON.stringify(many) && many["z:a"].clean === 0, "recordAttempt returns a new list and leaves the old one alone");
}

// ---- the day isn't finished until the sentence has been tried
{
  let s = newProfile(null, true);
  const id = s.course[0].lesson!;
  const req = dayRequirements(id);
  s = { ...s, today: { learnedTarget: true, learnedHabit: true, earAnswered: req.ear, earRight: 0, speakTries: req.speak, speakGood: 0 } };
  check(req.sentence === 1 && !dayReady(s), `day 1 (${id}) needs its sentence, also for a profile saved before sentences existed`);
  check(dayReady({ ...s, today: { ...s.today, sentenceTries: 1 } }), "one try at the sentence completes the day");
  check(LESSONS.every((l) => dayRequirements(l.id).sentence === 1), "every lesson has a sentence to say, scored or by ear");
}

// ---- daily reminder: a calendar file every phone can read
{
  const now = new Date(2026, 10, 13, 15, 4, 5);
  const ics = buildIcs({ time: "20:00", url: "https://example.test/app/" }, now);
  const lines = ics.split("\r\n");
  check(ics.endsWith("\r\n") && !/[^\r]\n/.test(ics), "ics: every line ends CRLF");
  check(lines[0] === "BEGIN:VCALENDAR" && lines[lines.length - 2] === "END:VCALENDAR", "ics: wrapped in VCALENDAR");
  check(lines.includes("DTSTART:20261113T200000") && lines.includes("DTEND:20261113T201000"), "ics: starts today at the chosen local time, with no time zone, for 10 minutes");
  check(lines.includes("RRULE:FREQ=DAILY") && lines.includes("TRIGGER:PT0M") && lines.includes("ACTION:DISPLAY"), "ics: repeats daily and alerts at the start");
  check(lines.includes("SUMMARY:Accent Coach: today's sound") && lines.includes("URL:https://example.test/app/"), "ics: titled, and links back to the app");
  check(lines.some((l) => l.startsWith("DESCRIPTION:") && l.includes("\\, four words")), "ics: commas in text are escaped");
  check(lines.every((l) => new TextEncoder().encode(l).length <= 75), "ics: no line is longer than 75 bytes");
  const long = buildIcs({ time: "06:30", url: `https://example.test/${"a".repeat(200)}` }, now);
  check(long.replace(/\r\n /g, "").includes(`URL:https://example.test/${"a".repeat(200)}`) && long.split("\r\n").every((l) => new TextEncoder().encode(l).length <= 75), "ics: a long link is folded and unfolds intact");
  check(buildIcs({ time: "23:55", url: "x" }, now).includes("DTEND:20261114T000500"), "ics: an event near midnight ends on the next day");
  check(buildIcs({ time: "20:00", url: "x" }, now).match(/UID:.*/)![0] === buildIcs({ time: "07:15", url: "x" }, new Date(2027, 0, 1)).match(/UID:.*/)![0], "ics: the same UID every time, so a new time replaces the old event");
  check(parseTime("7:05")?.h === 7 && parseTime("24:00") === null && parseTime("12:60") === null && parseTime("soon") === null, "reminder: only real times are accepted");
  check(friendlyTime("20:00") === "8:00 pm" && friendlyTime("00:05") === "12:05 am" && friendlyTime("12:00") === "12:00 pm" && friendlyTime("07:30") === "7:30 am", "reminder: times read naturally");
  const g = new URL(googleCalendarUrl({ time: "20:00", url: "https://example.test/app/" }, now));
  check(g.hostname === "calendar.google.com" && g.searchParams.get("dates") === "20261113T200000/20261113T201000" && g.searchParams.get("recur") === "RRULE:FREQ=DAILY" && g.searchParams.get("details")!.includes("https://example.test/app/"), "Google Calendar link carries the same daily event");
}

// ---- score-history chart geometry
{
  const pts = layout([40, 55, 70], 320, 104);
  check(pts[0].x < pts[1].x && pts[1].x < pts[2].x && pts[0].y > pts[1].y && pts[1].y > pts[2].y, "chart: later tests are further right, higher scores are higher up");
  check(pts.every((p) => p.x >= 0 && p.x <= 320 && p.y >= 0 && p.y <= 104), "chart: every point is inside the box");
  const flat = layout([100, 100], 320, 104);
  check(flat.every((p) => Number.isFinite(p.y) && p.y >= 0 && p.y <= 104), "chart: identical scores (even 100, 100) still draw");
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
