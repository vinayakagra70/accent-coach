/**
 * Milestones: small markers earned from numbers the app already keeps (voice
 * test history, finished lessons, clean sounds, phrases, conversations, review
 * words). Nothing here looks at word stress; that score isn't reliable enough
 * to hang a milestone on.
 */
import { BookOpen, Check, createElement, Lock, MessageCircle, Mic, Quote, Repeat, Target, TrendingUp, type IconNode } from "lucide";
import { h } from "../ui/dom";
import "./badges.css";

export interface BadgeInput {
  /** Overall voice-test scores, oldest first (Profile.history). */
  scores: number[];
  /** Course days of kind "lesson" that are completed. */
  lessonsDone: number;
  /** Sounds at or above the pass score, and how many sounds there are. */
  soundsClean: number;
  soundsTotal: number;
  /** Everyday phrases said clean (all packs, this accent). */
  phrasesClean: number;
  /** Tongue twisters said clean, and how many there are. */
  twistersClean: number;
  twistersTotal: number;
  /** Conversations finished, and how many there are. */
  talksDone: number;
  talksTotal: number;
  /** Review words said clean on three days and dropped from review (see addReviewCleared). */
  reviewCleared: number;
}

export interface Badge {
  id: string;
  title: string;
  /** One line: what earns it. */
  how: string;
  earned: boolean;
  /** "3 of 5" while it's being worked on; absent for one-step milestones. */
  progress?: string;
}

export const SCORE_GAIN = 10;
export const SCORE_GOAL = 85;

const ICONS: Record<string, IconNode> = {
  "first-test": Mic,
  "second-test": Mic,
  "score-up": TrendingUp,
  "score-goal": TrendingUp,
  "first-lesson": BookOpen,
  "five-lessons": BookOpen,
  "first-sound": Target,
  "five-sounds": Target,
  "ten-phrases": Quote,
  twisters: Quote,
  "first-talk": MessageCircle,
  "all-talks": MessageCircle,
  "review-20": Repeat,
};

const whole = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);

/** A milestone that counts up to a goal. A goal of 0 (nothing to do yet) is never earned. */
function counted(id: string, title: string, how: string, have: number, goal: number, unit = ""): Badge {
  const n = whole(have);
  const g = whole(goal);
  const earned = g > 0 && n >= g;
  const badge: Badge = { id, title, how, earned };
  if (g > 1) badge.progress = `${Math.min(n, g)} of ${g}${unit}`;
  return badge;
}

/** Every milestone, in a fixed order, with whether it is earned by these numbers. */
export function earnedBadges(input: BadgeInput): Badge[] {
  const scores = input.scores.filter((s) => Number.isFinite(s));
  const first = scores[0];
  const best = scores.length ? Math.max(...scores) : 0;
  // the best later test against the first one, so a single bad day doesn't take it back
  const gain = scores.length > 1 ? Math.max(0, Math.max(...scores.slice(1)) - first) : 0;
  const soundGoal = Math.min(5, whole(input.soundsTotal));

  return [
    counted("first-test", "First voice test", "Take the voice test once.", scores.length, 1),
    counted("second-test", "Checked again", "Take the voice test a second time.", scores.length, 2),
    counted("score-up", `Up ${SCORE_GAIN} points`, `Score ${SCORE_GAIN} points above your first voice test.`, gain, SCORE_GAIN, " points"),
    { id: "score-goal", title: `Voice score ${SCORE_GOAL}`, how: `Reach ${SCORE_GOAL} on a voice test.`, earned: best >= SCORE_GOAL, ...(scores.length ? { progress: `best so far ${Math.round(best)}` } : {}) },
    counted("first-lesson", "First lesson", "Finish one lesson in your course.", input.lessonsDone, 1),
    counted("five-lessons", "Five lessons", "Finish five lessons in your course.", input.lessonsDone, 5),
    counted("first-sound", "First clean sound", "Get one sound to clean.", input.soundsClean, Math.min(1, soundGoal)),
    counted("five-sounds", "Five clean sounds", "Get five sounds to clean.", input.soundsClean, soundGoal),
    counted("ten-phrases", "Ten phrases", "Say ten everyday phrases clean.", input.phrasesClean, 10),
    counted("twisters", "Every tongue twister", "Say all the tongue twisters clean.", input.twistersClean, input.twistersTotal),
    counted("first-talk", "First conversation", "Finish one conversation.", input.talksDone, Math.min(1, whole(input.talksTotal))),
    counted("all-talks", "Every conversation", "Finish all the conversations.", input.talksDone, input.talksTotal),
    counted("review-20", "Twenty words fixed", "Clear twenty words from review.", input.reviewCleared, 20),
  ];
}

/** Milestones earned in `after` that weren't earned in `before` (matched by id). */
export function newlyEarned(before: Badge[], after: Badge[]): Badge[] {
  const had = new Set(before.filter((b) => b.earned).map((b) => b.id));
  return after.filter((b) => b.earned && !had.has(b.id));
}

// ------------------------------------------------------------------ input helpers

/** Lessons finished in the course (check-up days don't count). */
export function lessonsDone(profile: { course: { kind: string; completedAt?: string }[] } | null): number {
  return profile ? profile.course.filter((d) => d.kind === "lesson" && d.completedAt).length : 0;
}

/** How many of `twisters` are in the stored `accent|text` list of phrases said clean. */
export function twistersClean(cleanKeys: string[], accent: string, twisters: string[]): number {
  const clean = new Set(cleanKeys);
  return twisters.filter((t) => clean.has(`${accent}|${t}`)).length;
}

/** Review words that were waiting in `before` and are gone from `after`: said clean enough to be dropped. */
export function reviewsCleared(before: Record<string, unknown> | undefined, after: Record<string, unknown> | undefined): number {
  return Object.keys(before ?? {}).filter((k) => !(k in (after ?? {}))).length;
}

const CLEARED_KEY = "accentCoach.reviewCleared";
const SEEN_KEY = "accentCoach.badgesSeen";

/** Review words cleared so far on this device. The profile only keeps words still waiting, so this is counted here. */
export function reviewCleared(): number {
  try {
    return whole(Number(localStorage.getItem(CLEARED_KEY) ?? 0));
  } catch {
    return 0;
  }
}

/** Add to the cleared count; call with reviewsCleared(before, after) after a review attempt. */
export function addReviewCleared(n: number): number {
  const total = reviewCleared() + whole(n);
  try {
    if (n > 0) localStorage.setItem(CLEARED_KEY, String(total));
  } catch {
    /* private mode: the count just isn't kept */
  }
  return total;
}

/**
 * Milestones earned now that haven't been announced on this device before.
 * Remembers them, so each is announced once.
 */
export function unannounced(input: BadgeInput): Badge[] {
  let seen: string[] = [];
  try {
    seen = JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[];
  } catch {
    /* start from nothing */
  }
  const fresh = earnedBadges(input).filter((b) => b.earned && !seen.includes(b.id));
  if (fresh.length) {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...seen, ...fresh.map((b) => b.id)]));
    } catch {
      /* it will be announced again next time */
    }
  }
  return fresh;
}

// ------------------------------------------------------------------ view

function icon(node: IconNode): SVGElement {
  const el = createElement(node, { width: 16, height: 16, "stroke-width": 1.5, "aria-hidden": "true" });
  el.classList.add("icon");
  return el;
}

/** Fill `container` with the milestones: earned ones first, the rest dimmed with how far along they are. */
export function renderBadges(container: HTMLElement, input: BadgeInput): Badge[] {
  const badges = earnedBadges(input);
  const got = badges.filter((b) => b.earned);
  const ordered = [...got, ...badges.filter((b) => !b.earned)];

  container.replaceChildren(
    h("p", { class: "badges-count" }, `${got.length} of ${badges.length} earned`),
    h("ul", { class: "badges", role: "list" }, ...ordered.map((b, i) =>
      h("li", { class: `badge-card ${b.earned ? "earned" : "todo"}`, style: `--i:${i}` },
        h("span", { class: "badge-mark" }, icon(b.earned ? (ICONS[b.id] ?? Check) : Lock)),
        h("span", { class: "badge-title" }, b.title),
        h("span", { class: "badge-how" }, b.how),
        h("span", { class: "badge-state" }, b.earned ? icon(Check) : null, b.earned ? "Earned" : b.progress ? `Not yet: ${b.progress}` : "Not yet")))),
  );
  return badges;
}
