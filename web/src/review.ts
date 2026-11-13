/**
 * Words to come back to. A word said with an Indian-English habit returns the
 * next day, then after longer gaps, until it has been said cleanly three times
 * on three different days. Saved inside the profile (Profile.review).
 */

export interface ReviewItem {
  lesson: string;
  word: string;
  /** Clean review attempts in a row. */
  clean: number;
  /** The calendar day (YYYY-MM-DD, the learner's own) it comes back. */
  due: string;
  misses: number;
  /** What was said last time, in plain words ("a dental T"). */
  habit?: string;
}

export type Reviews = Record<string, ReviewItem>;

/** Clean attempts needed before a word is dropped. */
export const REVIEW_CLEAN = 3;
/** Days until the next attempt: after a miss, after the 1st clean one, after the 2nd. */
const GAP_DAYS = [1, 2, 4];
/** Most review words offered in one day, so review never outgrows the lesson. */
export const REVIEW_PER_DAY = 6;

const two = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
const inDays = (now: Date, days: number) => dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));

export const reviewKey = (lesson: string, word: string) => `${lesson}:${word}`;

/**
 * Update the review list after a scored attempt at a word.
 *  - habit: the word (re)enters the list and comes back tomorrow.
 *  - good: counts only when the word was due, so repeating it five times in
 *    one sitting can't clear it; the third clean day removes it.
 *  - off (unclear recording): changes nothing.
 */
export function recordAttempt(reviews: Reviews | undefined, lesson: string, word: string, verdict: "good" | "habit" | "off", habit?: string, now = new Date()): Reviews {
  const all = { ...(reviews ?? {}) };
  const key = reviewKey(lesson, word);
  const prev = all[key];
  if (verdict === "habit") {
    all[key] = { lesson, word, clean: 0, due: inDays(now, GAP_DAYS[0]), misses: (prev?.misses ?? 0) + 1, habit };
  } else if (verdict === "good" && prev && prev.due <= dayKey(now)) {
    const clean = prev.clean + 1;
    if (clean >= REVIEW_CLEAN) delete all[key];
    else all[key] = { ...prev, clean, due: inDays(now, GAP_DAYS[clean]) };
  }
  return all;
}

/** Today's review words: the longest overdue first, then the most-missed. */
export function dueReviews(reviews: Reviews | undefined, now = new Date()): ReviewItem[] {
  const today = dayKey(now);
  return Object.values(reviews ?? {})
    .filter((r) => r.due <= today)
    .sort((a, b) => a.due.localeCompare(b.due) || b.misses - a.misses || a.word.localeCompare(b.word))
    .slice(0, REVIEW_PER_DAY);
}
