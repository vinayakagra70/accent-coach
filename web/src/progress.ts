/**
 * Practice history. Kept in the browser for step 1; step 3 moves it to the
 * local server so JARVIS can answer "which sounds am I weak on?".
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
  const p = get(id);
  p.bestVowel = Math.max(p.bestVowel, score);
  p.lastPracticed = new Date().toISOString();
  data[id] = p;
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
