/** Milestones: what earns each one, and what counts as newly earned. */
import { earnedBadges, lessonsDone, newlyEarned, reviewsCleared, twistersClean, type Badge, type BadgeInput } from "../src/features/badges";

let failed = 0;
function check(ok: boolean, msg: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${msg}`);
}

const empty: BadgeInput = { scores: [], lessonsDone: 0, soundsClean: 0, soundsTotal: 12, phrasesClean: 0, twistersClean: 0, twistersTotal: 8, talksDone: 0, talksTotal: 6, reviewCleared: 0 };
const badges = (over: Partial<BadgeInput>) => earnedBadges({ ...empty, ...over });
const get = (list: Badge[], id: string) => list.find((b) => b.id === id)!;
const has = (over: Partial<BadgeInput>, id: string) => get(badges(over), id).earned;

// nothing done
{
  const all = badges({});
  check(all.length >= 10 && all.length <= 13, `about a dozen milestones (${all.length})`);
  check(new Set(all.map((b) => b.id)).size === all.length, "ids are unique");
  check(all.every((b) => !b.earned), "a new learner has earned nothing");
  check(all.every((b) => b.title && b.how), "each has a title and a how-to-earn line");
  check(!all.some((b) => /stress/i.test(b.id + b.title + b.how)), "none depends on stress");
  check(!all.some((b) => /[—–]/.test(b.title + b.how + (b.progress ?? ""))), "no dashes in the copy");
  check(get(all, "five-lessons").progress === "0 of 5", "five lessons starts at 0 of 5");
  check(get(all, "first-test").progress === undefined, "one-step milestones have no progress text");
}

// voice tests
{
  check(has({ scores: [50] }, "first-test") && !has({ scores: [50] }, "second-test"), "one test: first test only");
  check(has({ scores: [50, 52] }, "second-test"), "two tests: checked again");
  check(!has({ scores: [50] }, "score-up"), "one test can't be an improvement");
  check(!has({ scores: [50, 59] }, "score-up") && get(badges({ scores: [50, 59] }), "score-up").progress === "9 of 10 points", "9 points up: not yet, 9 of 10 points");
  check(has({ scores: [50, 60] }, "score-up"), "10 points up: earned");
  check(has({ scores: [50, 62, 55] }, "score-up"), "a later dip doesn't take it back");
  check(!has({ scores: [70, 50, 60] }, "score-up"), "it's measured from the first test, not the lowest");
  check(!has({ scores: [84] }, "score-goal") && has({ scores: [60, 85] }, "score-goal"), "voice score 85 needs 85");
  check(get(badges({ scores: [84] }), "score-goal").progress === "best so far 84", "score goal shows the best so far");
}

// lessons and sounds
{
  check(has({ lessonsDone: 1 }, "first-lesson") && !has({ lessonsDone: 4 }, "five-lessons") && has({ lessonsDone: 5 }, "five-lessons"), "lessons: 1 and 5");
  check(get(badges({ lessonsDone: 3 }), "five-lessons").progress === "3 of 5", "3 of 5 lessons");
  check(get(badges({ lessonsDone: 9 }), "five-lessons").progress === "5 of 5", "progress never passes its goal");
  check(has({ soundsClean: 1 }, "first-sound") && !has({ soundsClean: 4 }, "five-sounds") && has({ soundsClean: 5 }, "five-sounds"), "clean sounds: 1 and 5");
  check(lessonsDone({ course: [{ kind: "lesson", completedAt: "x" }, { kind: "checkup", completedAt: "x" }, { kind: "lesson" }] }) === 1 && lessonsDone(null) === 0, "lessonsDone counts finished lessons, not check-ups");
}

// speaking practice
{
  check(!has({ phrasesClean: 9 }, "ten-phrases") && has({ phrasesClean: 10 }, "ten-phrases"), "ten phrases needs ten");
  check(!has({ twistersClean: 7 }, "twisters") && has({ twistersClean: 8 }, "twisters"), "every tongue twister needs all of them");
  check(!has({ twistersClean: 0, twistersTotal: 0 }, "twisters"), "no twisters to say: not earned for free");
  check(has({ talksDone: 1 }, "first-talk") && !has({ talksDone: 5 }, "all-talks") && has({ talksDone: 6 }, "all-talks"), "conversations: first and all");
  check(!has({ reviewCleared: 19 }, "review-20") && has({ reviewCleared: 20 }, "review-20"), "twenty review words needs twenty");
  check(twistersClean(["us|a b", "uk|c d", "us|not a twister"], "us", ["a b", "c d"]) === 1, "twistersClean counts this accent's twisters only");
  check(reviewsCleared({ a: 1, b: 1, c: 1 }, { b: 1, d: 1 }) === 2 && reviewsCleared(undefined, {}) === 0, "reviewsCleared counts words that left the list");
}

// odd numbers in
{
  const all = badges({ scores: [NaN], lessonsDone: -3, phrasesClean: NaN });
  check(all.every((b) => !b.earned) && get(all, "five-lessons").progress === "0 of 5", "bad numbers earn nothing");
}

// newly earned
{
  const before = badges({ scores: [50], lessonsDone: 4 });
  const after = badges({ scores: [50], lessonsDone: 5, talksDone: 1 });
  const fresh = newlyEarned(before, after).map((b) => b.id).sort().join(",");
  check(fresh === "first-talk,five-lessons", `only the new ones are announced (${fresh})`);
  check(newlyEarned(after, after).length === 0, "nothing new when nothing changed");
  check(newlyEarned(after, before).length === 0, "losing one announces nothing");
  check(newlyEarned([], before).map((b) => b.id).sort().join(",") === "first-lesson,first-test","from nothing, everything earned is new");
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exit(1);
