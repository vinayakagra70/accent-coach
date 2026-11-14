/**
 * "My progress": everything the app knows about how the learner is doing, on
 * one page, with a picture of it to share. The numbers come from the profile;
 * nothing new is stored for this page.
 */
import { LESSONS } from "../content/lessons";
import { PASS_SCORE, currentStreak, type Profile } from "../course";
import { $, h } from "./dom";
import { scoreChart } from "./scoreChart";
import { shareProgress, type ShareStats } from "./shareCard";

export type SoundState = "clean" | "close" | "work" | "untested";

export interface SoundRow {
  id: string;
  title: string;
  score: number | null;
  state: SoundState;
}

const STATE_LABEL: Record<SoundState, string> = { clean: "Clean", close: "Getting there", work: "Needs work", untested: "Not tested yet" };

/**
 * Every sound with its latest score (the voice test's, or practice results when
 * the test didn't cover it), weakest first and untested ones last.
 */
export function soundRows(profile: Profile | null, mastery: (id: string) => number | null): SoundRow[] {
  const rows = LESSONS.map((l) => {
    const score = profile?.assessment?.lessons[l.id]?.score ?? mastery(l.id);
    const state: SoundState = score === null || score === undefined ? "untested" : score >= PASS_SCORE ? "clean" : score >= 60 ? "close" : "work";
    return { id: l.id, title: l.title, score: score ?? null, state };
  });
  return rows.sort((a, b) => (a.score === null ? 1 : 0) - (b.score === null ? 1 : 0) || (a.score ?? 0) - (b.score ?? 0));
}

export function daysDone(profile: Profile | null): number {
  return profile ? profile.course.filter((d) => d.completedAt).length : 0;
}

/** The figures for the share card. */
export function shareStats(profile: Profile | null, rows: SoundRow[], accentName: string, now = new Date()): ShareStats {
  const history = profile?.history ?? [];
  const score = profile?.assessment?.overall ?? null;
  return {
    accentName,
    score,
    gained: score !== null && history.length > 1 ? Math.max(0, score - history[0].overall) : 0,
    streak: profile ? currentStreak(profile, now) : 0,
    daysDone: daysDone(profile),
    soundsClean: rows.filter((r) => r.state === "clean").length,
    soundsTotal: rows.length,
  };
}

export function showProgress(opts: {
  profile: Profile | null;
  accentName: string;
  mastery: (id: string) => number | null;
  phrasesClean: number;
  phrasesTotal: number;
  talksDone: number;
  talksTotal: number;
  reviewWords: number;
  onLesson: (id: string) => void;
  onTest: () => void;
  /** Extra blocks built by the caller: under the four figures, and above the buttons. */
  afterStats?: HTMLElement[];
  beforeActions?: HTMLElement[];
  /** Days practised in a row, when the caller counts them; shown in place of the course's own count so the page has one streak. */
  streak?: number;
}) {
  const o = $("overlay");
  o.hidden = false;
  o.replaceChildren();
  const close = () => {
    o.hidden = true;
    o.replaceChildren();
  };

  const p = opts.profile;
  const rows = soundRows(p, opts.mastery);
  const stats = shareStats(p, rows, opts.accentName);
  if (opts.streak !== undefined) stats.streak = opts.streak;
  const stat = (value: string, label: string) => h("div", { class: "stat" }, h("b", {}, value), h("span", {}, label));
  const chart = p ? scoreChart(p.history) : null;

  const status = h("p", { class: "note", role: "status" });
  const share = h("button", { class: "btn primary" }, "Share my progress") as HTMLButtonElement;
  share.onclick = async () => {
    share.disabled = true;
    try {
      const how = await shareProgress(stats);
      status.textContent = how === "saved" ? "Saved as a picture (accent-coach-progress.png). Post it or send it to a friend." : how === "shared" ? "Shared." : "";
    } catch (e) {
      status.textContent = `Couldn't make the picture: ${(e as Error).message}`;
    } finally {
      share.disabled = false;
    }
  };
  const test = h("button", { class: "btn" }, p?.assessment ? "Take the voice test again" : "Take the voice test");
  test.onclick = () => {
    close();
    opts.onTest();
  };
  const done = h("button", { class: "linklike" }, "Close");
  done.onclick = close;

  o.append(
    h("div", { class: "sheet my-progress" },
      h("h2", {}, "My progress"),
      h("p", { class: "lead" }, p && p.course.length ? `Day ${Math.min(p.day + 1, p.course.length)} of ${p.course.length} in your course.` : "No course yet. These are your sounds so far."),
      h("div", { class: "stats" },
        stat(stats.score === null ? "–" : String(stats.score), "voice score"),
        stat(String(stats.streak), "day streak"),
        stat(String(stats.daysDone), stats.daysDone === 1 ? "day done" : "days done"),
        stat(`${stats.soundsClean}/${stats.soundsTotal}`, "sounds clean")),
      ...(opts.afterStats ?? []),

      h("h3", {}, "Voice score over time"),
      chart ?? h("p", { class: "note" }, stats.score === null
        ? "Take the 3-minute voice test to get a score. Each check-up adds a point to this chart."
        : "One test so far. The next check-up shows how far you've moved."),

      h("h3", {}, "Your sounds, weakest first"),
      h("div", { class: "sound-rows" }, ...rows.map((r, i) => {
        const b = h("button", { class: `sound-row ${r.state}`, title: "Open this lesson", style: `--i:${i}` },
          h("span", { class: "sound-name" }, r.title),
          h("span", { class: "sound-bar" }, h("i", { style: `width:${r.score ?? 0}%` })),
          h("span", { class: "sound-score" }, r.score === null ? "–" : `${r.score}%`),
          h("span", { class: "sound-state" }, STATE_LABEL[r.state]));
        b.onclick = () => {
          close();
          opts.onLesson(r.id);
        };
        return b;
      })),

      h("h3", {}, "Speaking practice"),
      h("ul", { class: "progress-facts" },
        h("li", {}, `${opts.phrasesClean} of ${opts.phrasesTotal} everyday phrases said clean`),
        h("li", {}, `${opts.talksDone} of ${opts.talksTotal} conversations finished`),
        h("li", {}, opts.reviewWords ? `${opts.reviewWords} word${opts.reviewWords === 1 ? "" : "s"} still coming back in review` : "No words waiting in review")),
      ...(opts.beforeActions ?? []),

      h("div", { class: "row" }, share, test),
      status,
      h("div", { class: "row" }, done)),
  );
}
