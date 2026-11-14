/**
 * Practice streak and calendar: which days the learner practised, worked out
 * from what the profile already keeps (finished course days, voice tests, the
 * last practice of each lesson, the course streak) plus a small per-day log
 * kept in the browser, since none of those remembers every day.
 *
 * Days are the learner's own calendar days ("YYYY-MM-DD", local time). All the
 * arithmetic is done on whole day numbers, never on milliseconds of local
 * time, so a 23- or 25-hour day at a clock change can't shift anything.
 */

/** The parts of a profile that carry dates. (Structural, so this file needs nothing from course.ts.) */
export interface DatedProfile {
  course?: { completedAt?: string }[];
  history?: { date: string }[];
  streak?: { count: number; lastDate: string | null };
  practice?: Record<string, { lastPracticed: string | null }>;
}

export interface StreakStats {
  /** Days in a row up to today, or up to yesterday when today isn't practised yet. */
  current: number;
  longest: number;
  /** Days practised out of the last 7, today included. */
  last7: number;
  practisedToday: boolean;
  /** Every day practised, ever. */
  total: number;
}

export interface GridDay {
  key: string;
  practised: boolean;
  today: boolean;
  /** Later this week: drawn empty and not counted. */
  future: boolean;
}

const two = (n: number) => String(n).padStart(2, "0");
const DAY_MS = 86_400_000;
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The learner's own calendar day. */
export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** A day as a whole number (days since 1970), so the day before is always n - 1. Null for anything that isn't a real date. */
export function dayNumber(key: string): number | null {
  const m = KEY_RE.exec(key);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return ms / DAY_MS;
}

export function keyOfNumber(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${two(d.getUTCMonth() + 1)}-${two(d.getUTCDate())}`;
}

const todayNumber = (now: Date) => dayNumber(dayKey(now))!;

/** A stored date (a day key, or a full timestamp) as the learner's day; null when unreadable. */
function toKey(stamp: string | null | undefined): string | null {
  if (!stamp) return null;
  if (KEY_RE.test(stamp)) return dayNumber(stamp) === null ? null : stamp;
  const d = new Date(stamp);
  return Number.isNaN(d.getTime()) ? null : dayKey(d);
}

function numbers(days: Iterable<string>, upTo: number): Set<number> {
  const set = new Set<number>();
  for (const k of days) {
    const n = dayNumber(k);
    // a day after today is a wrong clock, not practice
    if (n !== null && n <= upTo) set.add(n);
  }
  return set;
}

/** Current and longest streak, and how many of the last 7 days were practised. */
export function streakStats(days: Iterable<string>, now = new Date()): StreakStats {
  const today = todayNumber(now);
  const set = numbers(days, today);

  // The streak lasts until the end of the day after the last practice.
  let current = 0;
  for (let n = set.has(today) ? today : today - 1; set.has(n); n--) current++;

  let longest = 0;
  for (const n of set) {
    if (set.has(n - 1)) continue; // not the start of a run
    let len = 1;
    while (set.has(n + len)) len++;
    if (len > longest) longest = len;
  }

  let last7 = 0;
  for (let i = 0; i < 7; i++) if (set.has(today - i)) last7++;

  return { current, longest, last7, practisedToday: set.has(today), total: set.size };
}

/**
 * The calendar: one column per week, oldest first, each Monday to Sunday. The
 * last column is the week with today in it; its remaining days are `future`.
 */
export function weekGrid(days: Iterable<string>, now = new Date(), weeks = 12): GridDay[][] {
  const today = todayNumber(now);
  const set = numbers(days, today);
  // 1 January 1970 (day 0) was a Thursday.
  const sinceMonday = (((today + 3) % 7) + 7) % 7;
  const firstMonday = today - sinceMonday - 7 * (weeks - 1);
  const grid: GridDay[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: GridDay[] = [];
    for (let d = 0; d < 7; d++) {
      const n = firstMonday + w * 7 + d;
      col.push({ key: keyOfNumber(n), practised: set.has(n), today: n === today, future: n > today });
    }
    grid.push(col);
  }
  return grid;
}

/**
 * Every day known to have had practice: the browser's log, plus what the
 * profile remembers. The course streak says "N days in a row ending on X", so
 * those N days are filled in too.
 */
export function practiceDays(profile: DatedProfile | null | undefined, log: Iterable<string> = []): string[] {
  const out = new Set<string>();
  const add = (stamp: string | null | undefined) => {
    const k = toKey(stamp);
    if (k) out.add(k);
  };
  for (const k of log) add(k);
  if (profile) {
    for (const d of profile.course ?? []) add(d.completedAt);
    for (const t of profile.history ?? []) add(t.date);
    for (const p of Object.values(profile.practice ?? {})) add(p?.lastPracticed);
    const last = toKey(profile.streak?.lastDate);
    const n = last ? dayNumber(last) : null;
    if (n !== null) for (let i = 0; i < Math.min(profile.streak!.count, 3660); i++) out.add(keyOfNumber(n - i));
  }
  return [...out].sort();
}

/** One sentence saying the whole card, for screen readers. */
export function streakSummary(s: StreakStats): string {
  const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  if (!s.total) return "No practice yet. Practise today to start a streak.";
  const now = s.current
    ? `Current streak ${days(s.current)}${s.practisedToday ? "" : ", practise today to keep it"}.`
    : "No streak right now.";
  return `${now} Longest streak ${days(s.longest)}. Practised ${s.last7} of the last 7 days.`;
}

// ------------------------------------------------------------------ the log

const LOG_KEY = "accentCoach.practiceDays.v1";
/** About two years; the calendar shows twelve weeks. */
const LOG_MAX = 730;

export function loadPracticeLog(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string" && dayNumber(k) !== null) : [];
  } catch {
    return [];
  }
}

/** The log with one more day in it: sorted, no repeats, oldest dropped past the cap. */
export function withDay(log: string[], key: string): string[] {
  return [...new Set([...log, key])].sort().slice(-LOG_MAX);
}

/** Call whenever the learner does a piece of practice. Cheap, and safe to call many times a day. */
export function recordPracticeToday(now = new Date()): void {
  const key = dayKey(now);
  const log = loadPracticeLog();
  if (log.includes(key)) return;
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(withDay(log, key)));
  } catch {
    /* private mode etc.: the profile's dates still give a streak */
  }
}
