/** Practice streak and calendar: the date maths, in a time zone with clock changes. */
process.env.TZ = "America/New_York";

import { dayKey, dayNumber, keyOfNumber, practiceDays, streakStats, streakSummary, weekGrid, withDay } from "../src/features/streak";

let failed = 0;
function check(ok: boolean, msg: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
}

/** Local time on a given day. */
const at = (y: number, m: number, d: number, hour = 12, min = 0) => new Date(y, m - 1, d, hour, min);

// the time zone took: New York changes its clocks, so January and July differ
const dst = at(2026, 1, 15).getTimezoneOffset() !== at(2026, 7, 15).getTimezoneOffset();
check(dst, "the test runs in a time zone with clock changes");

// day keys and day numbers
{
  check(dayKey(at(2026, 3, 5, 0, 1)) === "2026-03-05" && dayKey(at(2026, 3, 5, 23, 59)) === "2026-03-05", "a day runs from just after midnight to just before it, local time");
  check(dayNumber("1970-01-01") === 0 && dayNumber("1970-01-02") === 1, "day numbers count whole days");
  check(dayNumber("2026-03-01")! - dayNumber("2026-02-28")! === 1, "28 Feb to 1 Mar is one day in a normal year");
  check(dayNumber("2024-03-01")! - dayNumber("2024-02-28")! === 2, "...and two in a leap year");
  check(dayNumber("2027-01-01")! - dayNumber("2026-12-31")! === 1, "31 Dec to 1 Jan is one day");
  check(dayNumber("2026-02-30") === null && dayNumber("nonsense") === null && dayNumber("2026-13-01") === null, "dates that don't exist are refused");
  check(keyOfNumber(dayNumber("2026-11-14")!) === "2026-11-14", "a day number turns back into the same day");
}

// nothing yet
{
  const s = streakStats([], at(2026, 11, 14));
  check(s.current === 0 && s.longest === 0 && s.last7 === 0 && !s.practisedToday && s.total === 0, "no practice: everything is zero");
  check(streakSummary(s).startsWith("No practice yet"), "no practice: the summary says so");
}

// a run ending today
{
  const s = streakStats(["2026-11-12", "2026-11-13", "2026-11-14"], at(2026, 11, 14));
  check(s.current === 3 && s.longest === 3 && s.practisedToday, "three days ending today: a streak of 3");
  check(s.last7 === 3, "three of the last 7 days");
}

// today not practised yet: the streak holds until the day is over
{
  const days = ["2026-11-11", "2026-11-12", "2026-11-13"];
  const morning = streakStats(days, at(2026, 11, 14, 0, 5));
  const night = streakStats(days, at(2026, 11, 14, 23, 55));
  check(morning.current === 3 && !morning.practisedToday, "not practised yet today: yesterday's streak still stands just after midnight");
  check(night.current === 3, "...and still at five to midnight");
  check(streakStats(days, at(2026, 11, 15, 0, 5)).current === 0, "...and is gone once a whole day has been missed");
  check(streakStats(days, at(2026, 11, 15)).longest === 3, "a lost streak is still the longest");
  check(streakSummary(morning).includes("practise today to keep it"), "the summary says to practise today");
}

// gaps
{
  const days = ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-11-10", "2026-11-13", "2026-11-14"];
  const s = streakStats(days, at(2026, 11, 14));
  check(s.current === 2, `a gap ends the run: current is 2 (${s.current})`);
  check(s.longest === 5, `the longest run is the older one: 5 (${s.longest})`);
  check(s.last7 === 3, `10, 13 and 14 Nov fall in the last 7 days (${s.last7})`);
  check(s.total === 8, "every day counted once");
}

// last 7 days is today and the six before it
{
  const s = streakStats(["2026-11-07", "2026-11-08"], at(2026, 11, 14));
  check(s.last7 === 1, "a day 7 days ago is outside the last 7; 6 days ago is inside");
}

// repeats, bad entries, unsorted input and days after today
{
  const s = streakStats(["2026-11-14", "2026-11-13", "2026-11-14", "junk", "2026-02-31", "2026-11-15", "2026-11-16"], at(2026, 11, 14));
  check(s.current === 2 && s.total === 2 && s.longest === 2, "repeats, junk and days after today are ignored");
}

// across a month end and a year end
{
  check(streakStats(["2026-10-30", "2026-10-31", "2026-11-01"], at(2026, 11, 1)).current === 3, "a streak runs across the end of a month");
  check(streakStats(["2024-02-28", "2024-02-29", "2024-03-01"], at(2024, 3, 1)).current === 3, "...across 29 February");
  check(streakStats(["2026-02-28", "2026-03-01"], at(2026, 3, 1)).current === 2, "...and from 28 Feb to 1 Mar in a normal year");
  const ny = streakStats(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"], at(2027, 1, 2));
  check(ny.current === 4 && ny.longest === 4, "a streak runs across New Year");
}

// clock changes: 8 Mar 2026 is 23 hours long in New York, 1 Nov 2026 is 25
{
  const spring = ["2026-03-06", "2026-03-07", "2026-03-08", "2026-03-09"];
  check(streakStats(spring, at(2026, 3, 9, 0, 30)).current === 4, "a streak runs across the spring clock change");
  check(streakStats(spring.slice(0, 3), at(2026, 3, 9, 23, 30)).current === 3, "...and survives the day after it");
  const autumn = ["2026-10-31", "2026-11-01", "2026-11-02"];
  check(streakStats(autumn, at(2026, 11, 2, 0, 30)).current === 3, "a streak runs across the autumn clock change");
  check(streakStats(["2026-10-31", "2026-11-01"], at(2026, 11, 3, 0, 30)).current === 0, "...and a missed day after it still ends the streak");
  // practice late at night on the long day is still that day
  check(dayKey(at(2026, 11, 1, 23, 59)) === "2026-11-01" && dayKey(at(2026, 3, 8, 23, 59)) === "2026-03-08", "late evening on a clock-change day is still that day");
  const g = weekGrid(spring, at(2026, 3, 20), 4).flat();
  const keys = g.map((d) => d.key);
  check(new Set(keys).size === 28 && keys.every((k, i) => i === 0 || dayNumber(k)! - dayNumber(keys[i - 1])! === 1), "the calendar has no missing or repeated day around a clock change");
}

// the 12-week grid
{
  const now = at(2026, 11, 14); // a Saturday
  const grid = weekGrid(["2026-11-14", "2026-11-09", "2026-08-24", "2026-08-23"], now);
  check(grid.length === 12 && grid.every((w) => w.length === 7), "12 weeks of 7 days");
  check(grid[0][0].key === "2026-08-24" && grid[11][0].key === "2026-11-09", `weeks start on Monday (${grid[0][0].key} ... ${grid[11][0].key})`);
  check(grid[11][5].key === "2026-11-14" && grid[11][5].today && grid[11][5].practised, "today is in the last week, on its weekday");
  check(grid[11][6].future && !grid[11][6].practised && grid.flat().filter((d) => d.future).length === 1, "the rest of this week is marked as still to come");
  check(grid.flat().filter((d) => d.today).length === 1, "exactly one day is today");
  check(grid[0][0].practised && grid.flat().filter((d) => d.practised).length === 3, "practised days inside the 12 weeks are marked; the day before them isn't shown");
  const sunday = weekGrid([], at(2026, 11, 15));
  check(sunday[11][6].today && sunday[11][0].key === "2026-11-09" && !sunday.flat().some((d) => d.future), "on a Sunday the last week is full, with nothing still to come");
  const monday = weekGrid([], at(2026, 11, 16));
  check(monday[11][0].today && monday[11][0].key === "2026-11-16", "on a Monday a new week starts");
  const jan = weekGrid(["2026-12-31"], at(2027, 1, 1));
  check(jan[11][4].key === "2027-01-01" && jan[11][3].key === "2026-12-31" && jan[11][3].practised, "the grid runs across New Year");
  check(weekGrid([], now, 4).length === 4, "the number of weeks can be chosen");
}

// days gathered from a profile
{
  const local = (y: number, m: number, d: number, hour: number) => at(y, m, d, hour).toISOString();
  const days = practiceDays({
    course: [{ completedAt: local(2026, 11, 2, 23) }, {}, { completedAt: "not a date" }],
    history: [{ date: local(2026, 10, 20, 9) }],
    streak: { count: 3, lastDate: "2026-11-10" },
    practice: { "v-w": { lastPracticed: local(2026, 11, 12, 1) }, z: { lastPracticed: null } },
  }, ["2026-11-14", "2026-11-14", "bad"]);
  check(days.join() === "2026-10-20,2026-11-02,2026-11-08,2026-11-09,2026-11-10,2026-11-12,2026-11-14", `course days, tests, lesson practice, the streak's run and the log, once each (${days.join()})`);
  // 11 pm in New York is already the next day in UTC: the learner's day wins
  check(days.includes("2026-11-02") && !days.includes("2026-11-03"), "a late-evening timestamp counts for the learner's own day, not UTC's");
  check(practiceDays(null).length === 0 && practiceDays(undefined, ["2026-11-14"]).length === 1, "no profile: just the log");
  check(practiceDays({ streak: { count: 2, lastDate: "2027-01-01" } }).join() === "2026-12-31,2027-01-01", "the streak's run is filled in back across New Year");
}

// the log
{
  check(withDay(["2026-11-13"], "2026-11-14").join() === "2026-11-13,2026-11-14", "a new day is added to the log");
  check(withDay(["2026-11-13", "2026-11-14"], "2026-11-14").length === 2, "the same day is not logged twice");
  check(withDay(["2026-11-14"], "2026-11-01")[0] === "2026-11-01", "the log stays in date order");
}

// the sentence for screen readers
{
  check(streakSummary(streakStats(["2026-11-14"], at(2026, 11, 14))) === "Current streak 1 day. Longest streak 1 day. Practised 1 of the last 7 days.", "one day: singular");
  check(streakSummary(streakStats(["2026-11-01", "2026-11-02"], at(2026, 11, 14))) === "No streak right now. Longest streak 2 days. Practised 0 of the last 7 days.", "a lost streak: says so, with the longest");
}

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
