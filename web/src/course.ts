import { LESSONS } from "./content/lessons";
import { LESSON_CHECKS } from "./scoring/checks";

/**
 * The learner's profile: voice-test results, the course built from them, and
 * daily progress. Saved in the browser and mirrored to the local server
 * (data/profile.json) so JARVIS can read it.
 */

export interface Finding {
  word: string;
  /** The American sound that was expected, e.g. "θ". */
  target?: string;
  heard: string;
  habit: string;
}

export interface LessonResult {
  /** 0-100, or null when the test didn't cover this sound. */
  score: number | null;
  good: number;
  total: number;
  findings: Finding[];
}

export interface Assessment {
  date: string;
  overall: number;
  lessons: Record<string, LessonResult>;
}

export interface CourseDay {
  kind: "lesson" | "checkup";
  lesson?: string;
  completedAt?: string;
}

export interface TodayProgress {
  learnedTarget: boolean;
  learnedHabit: boolean;
  earAnswered: number;
  earRight: number;
  speakTries: number;
  speakGood: number;
}

export interface Profile {
  version: 1;
  updatedAt: string;
  skippedTest: boolean;
  assessment: Assessment | null;
  history: { date: string; overall: number }[];
  course: CourseDay[];
  /** Index into course of the day being worked on. */
  day: number;
  today: TodayProgress;
  streak: { count: number; lastDate: string | null };
}

export const PASS_SCORE = 85;
const CHECKUP_EVERY = 5;

export function emptyToday(): TodayProgress {
  return { learnedTarget: false, learnedHabit: false, earAnswered: 0, earRight: 0, speakTries: 0, speakGood: 0 };
}

/** Lessons in teaching order, worst and most noticeable first. */
export function planLessons(a: Assessment | null): string[] {
  const all = LESSONS.map((l) => l.id);
  const impact = (id: string) => LESSON_CHECKS[id]?.impact ?? 3;
  if (!a) return [...all].sort((x, y) => impact(y) - impact(x));
  const need = (id: string) => {
    const r = a.lessons[id];
    const score = r?.score ?? 50; // untested sounds: assume a typical Indian-English level
    return impact(id) * (100 - score);
  };
  return all
    .filter((id) => {
      const s = a.lessons[id]?.score;
      return s === null || s === undefined || s < PASS_SCORE;
    })
    .sort((x, y) => need(y) - need(x));
}

export function buildCourse(a: Assessment | null): CourseDay[] {
  const days: CourseDay[] = [];
  planLessons(a).forEach((id, i) => {
    days.push({ kind: "lesson", lesson: id });
    if ((i + 1) % CHECKUP_EVERY === 0) days.push({ kind: "checkup" });
  });
  if (days[days.length - 1]?.kind !== "checkup") days.push({ kind: "checkup" });
  return days;
}

export function newProfile(a: Assessment | null, skipped: boolean): Profile {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    skippedTest: skipped,
    assessment: a,
    history: a ? [{ date: a.date, overall: a.overall }] : [],
    course: buildCourse(a),
    day: 0,
    today: emptyToday(),
    streak: { count: 0, lastDate: null },
  };
}

/** After a check-up: keep finished days, re-plan the rest from the new results. */
export function replan(p: Profile, a: Assessment): Profile {
  // Finished days stay. If today was the check-up, taking the test finishes it;
  // a retake in the middle of a lesson day leaves that day open.
  const now = new Date().toISOString();
  const current = p.course[p.day];
  const done = [
    ...p.course.slice(0, p.day),
    ...(current?.kind === "checkup" ? [{ ...current, completedAt: now }] : []),
  ];
  const doneLessons = new Set(done.filter((d) => d.kind === "lesson").map((d) => d.lesson));
  // Sounds still weak come back even if they were taught already.
  const rest = buildCourse(a).filter((d) => d.kind === "checkup" || !doneLessons.has(d.lesson) || (a.lessons[d.lesson!]?.score ?? 0) < PASS_SCORE - 15);
  // Keep today's unfinished lesson first if it's still needed.
  if (current?.kind === "lesson") {
    const i = rest.findIndex((d) => d.lesson === current.lesson);
    if (i > 0) rest.unshift(...rest.splice(i, 1));
  }
  return {
    ...p,
    assessment: a,
    history: [...p.history, { date: a.date, overall: a.overall }],
    course: [...done, ...rest],
    day: done.length,
    today: current?.kind === "lesson" && rest[0]?.lesson === current.lesson ? p.today : emptyToday(),
    updatedAt: now,
  };
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export function todayKey() {
  return dayKey(new Date());
}

/** What the current day needs before it can be finished. */
export function dayRequirements(lessonId: string) {
  const l = LESSONS.find((x) => x.id === lessonId);
  return { ear: l && l.pairs.length ? 6 : 0, speak: 4 };
}

export function dayReady(p: Profile): boolean {
  const d = p.course[p.day];
  if (!d || d.kind !== "lesson" || !d.lesson) return false;
  const req = dayRequirements(d.lesson);
  const t = p.today;
  return t.learnedTarget && t.learnedHabit && t.earAnswered >= req.ear && t.speakTries >= req.speak;
}

export function completeDay(p: Profile): Profile {
  const now = new Date();
  const course = p.course.map((d, i) => (i === p.day ? { ...d, completedAt: now.toISOString() } : d));
  const last = p.streak.lastDate;
  const yesterday = dayKey(new Date(now.getTime() - 86400000));
  const count = last === dayKey(now) ? p.streak.count : last === yesterday ? p.streak.count + 1 : 1;
  return {
    ...p,
    course,
    day: Math.min(p.day + 1, course.length),
    today: emptyToday(),
    streak: { count, lastDate: dayKey(now) },
    updatedAt: now.toISOString(),
  };
}

/** True when the last finished day was today, so the next one is "tomorrow's". */
export function finishedToday(p: Profile): boolean {
  const prev = p.course[p.day - 1];
  return !!prev?.completedAt && prev.completedAt.slice(0, 10) === todayKey();
}

export function currentStreak(p: Profile): number {
  const last = p.streak.lastDate;
  if (!last) return 0;
  const yesterday = dayKey(new Date(Date.now() - 86400000));
  return last === todayKey() || last === yesterday ? p.streak.count : 0;
}

// ------------------------------------------------------------------ storage

const KEY = "accentCoach.profile.v1";

export function loadLocal(): Profile | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

export function saveLocal(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage blocked: the server copy still works */
  }
}

export function clearLocal() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
