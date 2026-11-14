/**
 * Practice history: listening-drill and vowel-mirror results per lesson.
 * Kept in the browser, and copied into the profile (Profile.practice) so the
 * server and the learner's other devices have it too.
 */
export interface LessonProgress {
  listenRight: number;
  listenTotal: number;
  bestVowel: number;
  lastPracticed: string | null;
}

const KEY = "accentCoach.progress.v1";

function load(): Record<string, LessonProgress> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

let data = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* private mode etc. — progress just isn't kept */
  }
}

export function get(id: string): LessonProgress {
  return data[id] ?? { listenRight: 0, listenTotal: 0, bestVowel: 0, lastPracticed: null };
}

export function recordListen(id: string, right: boolean) {
  const p = get(id);
  p.listenTotal += 1;
  if (right) p.listenRight += 1;
  p.lastPracticed = new Date().toISOString();
  data[id] = p;
  save();
}

export function recordVowel(id: string, score: number) {
  if (!Number.isFinite(score)) return; // NaN from a silent recording would stick: Math.max(80, NaN) is NaN
  const p = get(id);
  p.bestVowel = Math.max(p.bestVowel, score);
  p.lastPracticed = new Date().toISOString();
  data[id] = p;
  save();
}

/** Everything, for saving inside the profile. */
export function all(): Record<string, LessonProgress> {
  return data;
}

/** Whichever copy of a lesson has more practice in it; counts only ever go up, so nothing is lost. */
export function mergeLesson(a: LessonProgress, b: LessonProgress): LessonProgress {
  const more = b.listenTotal > a.listenTotal ? b : a;
  const dates = [a.lastPracticed, b.lastPracticed].filter((d): d is string => !!d).sort();
  return {
    listenRight: more.listenRight,
    listenTotal: more.listenTotal,
    bestVowel: Math.max(a.bestVowel, b.bestVowel),
    lastPracticed: dates[dates.length - 1] ?? null,
  };
}

/** Take in practice done on another device (it arrives inside the profile). */
export function merge(remote: Record<string, LessonProgress> | undefined) {
  if (!remote) return;
  for (const [id, r] of Object.entries(remote)) data[id] = mergeLesson(get(id), r);
  save();
}

/** One number per lesson for the sidebar: 0..100, or null when never practised. */
export function mastery(id: string): number | null {
  const p = get(id);
  const parts: number[] = [];
  if (p.listenTotal) parts.push((100 * p.listenRight) / p.listenTotal);
  if (p.bestVowel) parts.push(p.bestVowel);
  if (!parts.length) return null;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
}

export function resetAll() {
  data = {};
  save();
}
