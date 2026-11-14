/** "My progress" and the share card: the figures they show, worked out from a profile. */
import { LESSONS } from "../src/content/lessons";
import { completeDay, newProfile, replan, type Assessment } from "../src/course";
import { daysDone, shareStats, soundRows } from "../src/ui/progressPage";
import { shareFacts, shareHeadline } from "../src/ui/shareCard";

let failed = 0;
function check(ok: boolean, msg: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
}

const result = (score: number | null) => ({ score, good: 0, total: 0, findings: [] });
const test = (overall: number, lessons: Record<string, number | null>, date = "2026-11-01T10:00:00.000Z"): Assessment => ({
  date,
  overall,
  lessons: Object.fromEntries(Object.entries(lessons).map(([id, s]) => [id, result(s)])),
});
const none = () => null;

// no profile: every sound listed, none tested
{
  const rows = soundRows(null, none);
  check(rows.length === LESSONS.length && rows.every((r) => r.state === "untested"), "no profile: every sound is listed as not tested");
  const s = shareStats(null, rows, "American");
  check(s.score === null && s.streak === 0 && s.daysDone === 0 && s.soundsClean === 0, "no profile: the share card has no score and zeros");
  check(shareHeadline(s) === "Training my American accent", `no score: the card says what's being trained (${shareHeadline(s)})`);
}

// practice results stand in for sounds the test didn't cover
{
  const rows = soundRows(null, (id) => (id === "v-w" ? 90 : null));
  check(rows[0].id === "v-w" && rows[0].state === "clean", "a sound known only from practice is shown with that score, ahead of untested ones");
}

// after a voice test
{
  const a = test(62, { "v-w": 40, "th-voiceless": 70, "th-voiced": 85, z: null });
  let p = newProfile(a, false);
  const rows = soundRows(p, (id) => (id === "z" ? 95 : null));
  check(rows[0].id === "v-w" && rows[0].state === "work", "the weakest sound comes first and needs work");
  check(rows[1].id === "th-voiceless" && rows[1].state === "close", "60 to 84 is getting there");
  check(rows.find((r) => r.id === "th-voiced")?.state === "clean", "85 and up is clean");
  check(rows.find((r) => r.id === "z")?.score === 95, "a sound the test left out falls back to practice results");
  check(rows[rows.length - 1].score === null, "untested sounds come last");

  const day1 = new Date(2026, 10, 2, 9);
  p = completeDay(p, day1);
  p = completeDay(p, new Date(2026, 10, 3, 9));
  check(daysDone(p) === 2, "two finished days are counted");
  const s = shareStats(p, rows, "American", new Date(2026, 10, 3, 20));
  check(s.streak === 2 && s.daysDone === 2 && s.score === 62 && s.gained === 0, "the share card carries the score, streak and days");
  check(shareHeadline(s) === "My American accent score", "one test: no claim of improvement");
  check(shareFacts(s).map((f) => `${f.value} ${f.label}`).join(", ") === `2 day streak, 2 days done, ${s.soundsClean}/${LESSONS.length} sounds clean`, "the three small figures read naturally");
  check(shareStats(p, rows, "American", new Date(2026, 10, 9, 20)).streak === 0, "a streak that lapsed isn't shown on the card");

  // a check-up later
  const better = replan(p, test(74, { "v-w": 88, "th-voiceless": 70, "th-voiced": 90 }, "2026-11-08T10:00:00.000Z"));
  const s2 = shareStats(better, soundRows(better, none), "American", new Date(2026, 10, 8, 20));
  check(s2.gained === 12 && shareHeadline(s2) === "Up 12 points since my first voice test", `a higher check-up shows the gain (${shareHeadline(s2)})`);
  const worse = replan(p, test(55, { "v-w": 30 }, "2026-11-08T10:00:00.000Z"));
  const s3 = shareStats(worse, soundRows(worse, none), "British", new Date(2026, 10, 8, 20));
  check(s3.gained === 0 && shareHeadline(s3) === "My British accent score", "a lower check-up never shows a loss on the card");
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
