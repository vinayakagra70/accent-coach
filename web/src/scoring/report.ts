import type { TestItem } from "../content/assessment";
import type { Assessment, LessonResult } from "../course";
import { LESSONS } from "../content/lessons";
import { align, judge, type CheckResult } from "./align";
import { LESSON_CHECKS } from "./checks";

export interface ItemResult {
  item: TestItem;
  /** Normalized phonemes the model heard; null when the item was skipped. */
  heard: string[] | null;
}

/** Judge every checked sound in one phrase. */
export function judgeItem(item: TestItem, heard: string[]): (CheckResult & { lesson: string; word: string; sym: string })[] {
  const pairs = align(item.expected, heard);
  return item.checks.map((c) => {
    const check = LESSON_CHECKS[c.lesson].sounds[c.sym];
    return { ...judge(item.expected, heard, pairs, c.i, check), lesson: c.lesson, word: c.word, sym: c.sym };
  });
}

export function buildAssessment(results: ItemResult[]): Assessment {
  const lessons: Record<string, LessonResult> = {};
  for (const l of LESSONS) lessons[l.id] = { score: null, good: 0, total: 0, findings: [] };

  for (const r of results) {
    if (!r.heard) continue;
    for (const j of judgeItem(r.item, r.heard)) {
      const lr = lessons[j.lesson];
      lr.total += 1;
      // "off" = the model heard something we have no rule for; give half credit
      // rather than blaming a habit the learner may not have.
      lr.good += j.verdict === "good" ? 1 : j.verdict === "off" ? 0.5 : 0;
      if (j.verdict === "habit" && j.habit) lr.findings.push({ word: j.word, target: j.sym, heard: j.heard, habit: j.habit });
    }
  }

  let wsum = 0;
  let acc = 0;
  for (const [id, lr] of Object.entries(lessons)) {
    if (!lr.total) continue;
    lr.score = Math.round((100 * lr.good) / lr.total);
    const w = LESSON_CHECKS[id]?.impact ?? 3;
    wsum += w;
    acc += lr.score * w;
  }
  return { date: new Date().toISOString(), overall: wsum ? Math.round(acc / wsum) : 0, phrases: results.filter((r) => r.heard).length, lessons };
}

/** Lessons sorted worst first, for the report. */
export function weakest(a: Assessment): { id: string; title: string; score: number; findings: LessonResult["findings"] }[] {
  return LESSONS.filter((l) => a.lessons[l.id]?.score !== null && a.lessons[l.id]?.score !== undefined)
    .map((l) => ({ id: l.id, title: l.title, score: a.lessons[l.id].score!, findings: a.lessons[l.id].findings }))
    .sort((x, y) => x.score - y.score || (LESSON_CHECKS[y.id]?.impact ?? 0) - (LESSON_CHECKS[x.id]?.impact ?? 0));
}
