import * as api from "../api";
import { recordPhrase } from "../audio/recorder";
import { ASSESSMENT } from "../content/assessment";
import { LESSONS } from "../content/lessons";
import { PASS_SCORE, type Assessment, type CourseDay } from "../course";
import { normalizeAll } from "../scoring/align";
import { buildAssessment, weakest, type ItemResult } from "../scoring/report";
import { $, h } from "./dom";
import { icons } from "./icons";
import { mountEngineGate } from "./engineGate";
import { scoreChart } from "./scoreChart";
import { ENGINE_STOPPED } from "../listen/engine";
import type { Take } from "../audio/recorder";
import { ACCENTS, accent, accentInfo, type Accent } from "../content/accent";
import { coachSays, coachVoiceOn, stopTalking } from "../coach";
import { lines } from "../speech/lines";

/**
 * Phones checking on the device get a short test: the model is heavy for a phone
 * browser, and a phone (2026-11-12, the user's) managed 4 recordings before running
 * out of memory. These two phrases cover the most sounds: TH (the, think, three,
 * things), W, the T between vowels, R after vowels and Z.
 */
const QUICK_PHRASES = ["The water is better.", "I think three things."];

export function isQuickTest(): boolean {
  return api.STATIC && api.listenMode() === "device";
}

function testItems() {
  return isQuickTest() ? ASSESSMENT.filter((i) => QUICK_PHRASES.includes(i.text)) : ASSESSMENT;
}

/** Full-screen steps over the app: welcome → voice test → report. */

function overlay(): HTMLElement {
  stopNarration?.();
  const o = $("overlay");
  o.hidden = false;
  o.replaceChildren();
  return o;
}

export function closeOverlay() {
  stopNarration?.();
  const o = $("overlay");
  o.hidden = true;
  o.replaceChildren();
}

// ------------------------------------------------------------------ welcome

export function showWelcome(opts: {
  onStart: () => void;
  onSkip: () => void;
  retake?: boolean;
  onCancel?: () => void;
  accent?: Accent;
  onAccent?: (a: Accent) => void;
}) {
  const o = overlay();
  // First visit: choose the accent to learn. (Later it's in the header.)
  let picker: HTMLElement | null = null;
  if (!opts.retake && opts.onAccent) {
    const pick = (a: Accent) => {
      opts.onAccent!(a);
      for (const b of picker!.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.accent === a));
    };
    picker = h("div", { class: "accent-pick", role: "group", "aria-label": "Accent to learn" },
      ...(["us", "uk"] as Accent[]).map((a) => {
        const b = h("button", { class: "accent-opt", "data-accent": a, "aria-pressed": String(opts.accent === a) },
          h("b", {}, ACCENTS[a].long), h("small", {}, a === "us" ? "as in the US: water = \"wadder\", car with an R" : "as in the UK: water = \"waw-tuh\", car = \"caa\""));
        b.onclick = () => pick(a);
        return b;
      }));
  }
  const status = h("div");
  const start = h("button", { class: "btn primary big", hidden: "" }, icons.mic(), "Start the voice test");
  const stopPoll = mountEngineGate(status, (ready) => {
    start.hidden = !ready; // until then the line above says what's missing and how to get it
  });
  start.onclick = () => {
    stopPoll();
    opts.onStart();
  };
  const skip = h("button", { class: "btn" }, opts.retake ? "Not now" : "Skip the test, show me the lessons");
  skip.onclick = () => {
    stopPoll();
    (opts.retake ? opts.onCancel ?? opts.onSkip : opts.onSkip)();
  };
  o.append(
    h("div", { class: "sheet" },
      h("h2", {}, opts.retake ? "Let's see how far you've come" : "First, let's hear how you speak"),
      h("p", { class: "lead" },
        opts.retake
          ? `Read the same ${testItems().length} short phrases again. Your course will adjust to what's improved and what still needs work.`
          : isQuickTest()
            ? "Read 2 short phrases out loud (under a minute). This is the short version for phones. Accent Coach listens to each sound, finds the habits that make English sound Indian, and builds a day-by-day course around them."
            : "Read 13 short phrases out loud (about 3 minutes). Accent Coach listens to each sound, finds the habits that make English sound Indian, and builds a day-by-day course around your flaws."),
      picker ? h("h3", { style: "margin-top:0" }, "Which accent do you want to learn?") : null,
      picker,
      // the buttons come before the tips, so on a phone they're on the first screen
      h("div", { class: "row welcome-actions" }, start, skip),
      status,
      h("ul", { class: "ticks" },
        h("li", {}, "Use a quiet room. Headphones help."),
        h("li", {}, "Speak naturally, the way you normally would. Don't perform."),
        h("li", {}, "Recording stops by itself when you pause."),
        privacyLine() ? h("li", {}, privacyLine()) : null),
    ),
  );
}

/** Where recordings go, said the same way as the status line (online checking explains itself there). */
function privacyLine(): string | null {
  if (!api.STATIC) return "Your recordings stay on this laptop and aren't saved.";
  return api.listenMode() === "online" ? null : "Your recordings stay on this phone and aren't saved.";
}

// ------------------------------------------------------------------ the test

export function runTest(opts: { onDone: (a: Assessment) => void; onCancel: () => void }) {
  const TEST = testItems();
  const o = overlay();
  /** A recording the engine couldn't check (it stopped), as opposed to a skipped phrase (null). */
  const FAILED = "failed" as const;
  const results: (Promise<string[] | typeof FAILED> | null)[] = TEST.map(() => null);
  const takes: (Take | null)[] = TEST.map(() => null);
  const check = (take: Take) => api.recognize(take).catch(() => FAILED);
  let index = 0;
  let abort: AbortController | null = null;

  const bar = h("i");
  const counter = h("span", { class: "score" });
  const phrase = h("p", { class: "phrase" });
  const meter = h("i");
  const state = h("p", { class: "rec-state" });
  const recBtn = h("button", { class: "btn primary big" }, icons.mic(), "Record");
  const redo = h("button", { class: "btn big", hidden: "" }, icons.again(), "Say it again");
  const next = h("button", { class: "btn primary big", hidden: "" }, "Next");
  const skip = h("button", { class: "linklike" }, "Skip this phrase");
  const quit = h("button", { class: "linklike" }, "Quit test");

  o.append(
    h("div", { class: "sheet test" },
      h("div", { class: "progress" }, bar),
      h("div", { class: "row spread" }, h("p", { class: "eyebrow" }, "Voice test"), counter),
      h("p", { class: "muted" }, "Read this out loud:"),
      phrase,
      h("div", { class: "meter tall" }, meter),
      state,
      h("div", { class: "row" }, recBtn, redo, next),
      h("div", { class: "row spread" }, skip, quit),
    ),
  );

  const show = () => {
    const item = TEST[index];
    phrase.textContent = item.text;
    counter.textContent = `${index + 1} / ${TEST.length}`;
    bar.style.width = `${(index / TEST.length) * 100}%`;
    state.textContent = "Press Record, then read the phrase.";
    state.className = "rec-state";
    recBtn.hidden = false;
    recBtn.removeAttribute("disabled");
    redo.hidden = true;
    next.hidden = true;
    meter.style.width = "0";
  };

  const advance = () => {
    index++;
    if (index < TEST.length) show();
    else void finish();
  };

  const record = async () => {
    recBtn.setAttribute("disabled", "");
    redo.hidden = true;
    next.hidden = true;
    state.textContent = "Listening… read the phrase now.";
    state.className = "rec-state live";
    abort = new AbortController();
    try {
      const take = await recordPhrase({
        onLevel: (l) => (meter.style.width = `${Math.round(l * 100)}%`),
        onSpeech: () => (state.textContent = "Got you… pause when you're done."),
        signal: abort.signal,
      });
      meter.style.width = "0";
      if (!take.speech) {
        state.textContent = "I didn't hear anything. Check your mic and try again.";
        state.className = "rec-state warn";
        recBtn.removeAttribute("disabled");
        return;
      }
      const i = index;
      // send now, judge at the end, so the test keeps moving
      takes[i] = take;
      results[i] = check(take);
      state.textContent = "Recorded";
      state.className = "rec-state ok";
      recBtn.hidden = true;
      redo.hidden = false;
      next.hidden = false;
      next.replaceChildren(index === TEST.length - 1 ? "See my results" : "Next", icons.next());
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return;
      state.textContent = "Microphone blocked. Allow it from the icon in the address bar, then try again.";
      state.className = "rec-state warn";
      recBtn.removeAttribute("disabled");
    }
  };

  const finish = async () => {
    const total = takes.filter(Boolean).length;
    const progressLine = h("p", { class: "lead" }, "");
    const progressBar = h("i");
    o.replaceChildren(h("div", { class: "sheet" },
      h("h2", {}, "Listening to your recordings…"),
      progressLine,
      h("div", { class: "progress" }, progressBar),
      h("p", { class: "note" }, "This runs on your device and usually takes under a minute.")));
    let done = 0;
    const tick = () => {
      progressLine.textContent = `${done} of ${total} checked`;
      progressBar.style.width = `${total ? (done / total) * 100 : 100}%`;
    };
    tick();
    const settled = await Promise.all(results.map((r) => (r ?? Promise.resolve(null)).then((v) => {
      if (r) {
        done++;
        tick();
      }
      return v;
    })));

    // Some recordings couldn't be checked (the engine stopped): offer to retry just those.
    const failed = settled.map((v, i) => (v === FAILED ? i : -1)).filter((i) => i >= 0);
    if (failed.length) {
      const retry = h("button", { class: "btn primary big" }, icons.again(), `Retry ${failed.length === 1 ? "1 recording" : `${failed.length} recordings`}`);
      retry.onclick = () => {
        for (const i of failed) results[i] = check(takes[i]!);
        void finish();
      };
      // Phones that ran out of memory: check the same recordings online instead.
      const goOnline = api.STATIC && api.ONLINE_URL && api.listenMode() === "device"
        ? h("button", { class: "btn primary big" }, `Check ${failed.length === 1 ? "it" : "them"} online`)
        : null;
      if (goOnline) {
        retry.className = "btn big";
        goOnline.onclick = () => {
          api.setListenMode("online");
          for (const i of failed) results[i] = check(takes[i]!);
          void finish();
        };
      }
      const usable = settled.filter((v) => Array.isArray(v)).length;
      const carryOn = h("button", { class: "btn" }, "Continue without them");
      carryOn.onclick = () => {
        for (const i of failed) results[i] = null;
        void finish();
      };
      o.replaceChildren(h("div", { class: "sheet" },
        h("h2", {}, failed.length === total ? "Your recordings couldn't be checked" : `${failed.length} of ${total} recordings couldn't be checked`),
        h("p", { class: "lead" }, api.STATIC ? ENGINE_STOPPED : "The speech engine on this laptop didn't answer. Make sure start.bat is still running, then retry."),
        h("p", { class: "note" }, "Your recordings are kept, so you won't have to read the phrases again."),
        goOnline ? h("p", { class: "note" }, "Checking online sends these recordings to Accent Coach's checker. They're used once and not stored.") : null,
        h("div", { class: "row" }, goOnline, retry, usable >= 4 ? carryOn : null)));
      return;
    }

    const heard = settled.map((v) => (Array.isArray(v) ? v : null));
    const items: ItemResult[] = TEST.map((item, i) => ({ item, heard: heard[i] ? normalizeAll(heard[i]!) : null }));
    const recorded = items.filter((x) => x.heard).length;
    if (recorded < Math.min(4, TEST.length)) {
      o.replaceChildren(h("div", { class: "sheet" },
        h("h2", {}, "Not enough recordings"),
        h("p", { class: "lead" }, `Only ${recorded} of ${TEST.length} phrases came through, which isn't enough to judge fairly.`),
        h("div", { class: "row" },
          Object.assign(h("button", { class: "btn primary" }, "Try again"), { onclick: () => runTest(opts) }),
          Object.assign(h("button", { class: "btn" }, "Cancel"), { onclick: opts.onCancel }))));
      return;
    }
    opts.onDone(buildAssessment(items));
  };

  recBtn.onclick = () => void record();
  redo.onclick = () => void record();
  next.onclick = advance;
  skip.onclick = () => {
    abort?.abort();
    results[index] = null;
    takes[index] = null;
    advance();
  };
  quit.onclick = () => {
    abort?.abort();
    opts.onCancel();
  };
  show();
}

// ------------------------------------------------------------------ report

const lessonTitle = (id: string) => LESSONS.find((l) => l.id === id)?.title ?? id;

export function showReport(opts: { assessment: Assessment; course: CourseDay[]; previous?: number; history?: { date: string; overall: number }[]; onStart: (lessonId?: string) => void }) {
  const a = opts.assessment;
  const o = overlay();
  const rows = weakest(a);
  const flaws = rows.filter((r) => r.score < PASS_SCORE);
  const good = rows.filter((r) => r.score >= PASS_SCORE);
  const verdict =
    a.overall >= 90 ? `Very close to ${accentInfo().long}` :
    a.overall >= 75 ? "Clear, with a few sounds that give the accent away" :
    a.overall >= 55 ? "Understandable, with several noticeable Indian-English sounds" :
    "A strong Indian-English accent, with lots of room to improve quickly";

  const ring = h("div", { class: "ring", style: `--p:${a.overall}` }, h("b", {}, String(a.overall)), h("small", {}, "/ 100"));
  const delta = opts.previous !== undefined
    ? h("p", { class: `delta ${a.overall >= opts.previous ? "up" : "down"}` }, `${a.overall - opts.previous >= 0 ? "+" : ""}${a.overall - opts.previous} since last test`)
    : null;

  const trend = scoreChart(opts.history ?? []);

  const flawCards = flaws.slice(0, 8).map((f) => {
    const first = f.findings[0];
    const go = h("button", { class: "btn small" }, "Practise");
    go.onclick = () => opts.onStart(f.id);
    return h("div", { class: "flaw" },
      h("div", { class: "flaw-head" }, h("b", {}, f.title), h("span", { class: `pill ${f.score < 50 ? "bad" : "mid"}` }, `${f.score}%`)),
      h("p", {}, first ? `In "${first.word}" you said ${first.habit}.` : `Some of these sounds didn't come out clearly ${accentInfo().name}.`),
      f.findings.length && f.findings[0].target
        ? h("div", { class: "flaw-said" }, ...f.findings.slice(0, 3).map((x) => h("span", {}, `${x.word}  /${x.heard}/ for /${x.target}/`)))
        : null,
      go);
  });
  const flawList = h("div", { class: "flaws" }, ...flawCards);
  const goodChips = good.length ? h("div", { class: "chips" }, ...good.map((g) => h("span", { class: "chip static" }, icons.check(), g.title))) : null;

  const lessonDays = opts.course.filter((d) => d.kind === "lesson");
  const courseList = h("ol", { class: "course-preview" }, ...opts.course.slice(0, 6).map((d) =>
    h("li", {}, d.kind === "checkup" ? "Check-up: voice test again" : lessonTitle(d.lesson!))));

  const start = h("button", { class: "btn primary big" }, "Start day 1", icons.next());
  start.onclick = () => opts.onStart();

  // Nova reads the report out, lighting up each part as she gets to it.
  const top = h("div", { class: "report-top" });
  const firstLesson = lessonDays[0]?.lesson;
  const parts: { text: string; el: HTMLElement | null; mood: "happy" | "curious" }[] = [
    { text: `${lines.report(a.overall, opts.previous)} ${lines.reportBand(a.overall)}`, el: top, mood: a.overall >= 75 ? "happy" : "curious" },
    ...(flaws.length
      ? flaws.slice(0, 2).map((f, i) => ({ text: i === 0 ? `${lines.reportFlaw(0, f.title)} ${lines.reportFlawHow()}` : lines.reportFlaw(i, f.title), el: flawCards[i], mood: "curious" as const }))
      : [{ text: lines.reportNoFlaws(), el: flawList, mood: "happy" as const }]),
    ...(good.length ? [{ text: lines.reportGood(good.length), el: goodChips, mood: "happy" as const }] : []),
    ...(lessonDays.length ? [{ text: lines.reportCourse(lessonDays.length, firstLesson ? lessonTitle(firstLesson) : undefined), el: courseList, mood: "happy" as const }] : []),
    { text: lines.reportStart(), el: start, mood: "happy" },
  ];
  const said = h("p", { class: "nova-said", "aria-live": "polite" });
  const hush = h("button", { class: "linklike small" }, "Stop talking");
  const novaBox = h("div", { class: "nova-say" }, h("b", {}, "Nova"), said, hush);

  top.append(ring, h("div", {}, h("h2", {}, verdict), delta,
    h("p", { class: "muted" }, `Based on ${a.phrases ?? 13} phrase${a.phrases === 1 ? "" : "s"}${(a.phrases ?? 13) < 13 ? " (the short phone version: sounds it didn't cover are still in your course)" : ""}, judged sound by sound against ${accentInfo().long}. ${accent() === "uk" ? "Dark L, the puff on P/T/K and dropping the R" : "Dark L and the puff on P/T/K"} can't be heard reliably yet, so they're taught but not scored.`)));

  o.append(
    h("div", { class: "sheet report" },
      h("p", { class: "eyebrow" }, "Your accent report"),
      novaBox,
      top,
      trend ? h("h3", {}, `Your ${opts.history!.length} voice tests`) : null,
      trend,
      flaws.length ? h("h3", {}, "What to fix") : h("h3", {}, "Nothing major to fix"),
      flawList,
      good.length ? h("h3", {}, "Already good") : null,
      goodChips,
      h("h3", {}, `Your course: ${lessonDays.length} sounds, one a day`),
      courseList,
      h("div", { class: "row" }, start),
    ),
  );

  // Any button on the sheet means the learner has taken over: Nova stops.
  o.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => stopNarration?.(), { capture: true }));
  void narrate(parts, said, novaBox);
}

// ------------------------------------------------------------------ Nova reads the report

let stopNarration: (() => void) | null = null;

async function narrate(parts: { text: string; el: HTMLElement | null; mood: "happy" | "curious" }[], said: HTMLElement, box: HTMLElement) {
  stopNarration?.();
  let live = true;
  let lit: HTMLElement | null = null;
  const unlight = () => lit?.classList.remove("spot");
  const stop = () => {
    if (!live) return;
    live = false;
    unlight();
    stopTalking();
    box.classList.add("done");
    if (stopNarration === stop) stopNarration = null;
  };
  stopNarration = stop;
  box.querySelector("button")!.addEventListener("click", stop);
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  for (const p of parts) {
    if (!live) return;
    unlight();
    lit = p.el;
    if (lit) {
      lit.classList.add("spot");
      lit.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    }
    said.textContent = p.text;
    await coachSays(p.text, p.mood);
    // with her voice off, give the caption time to be read
    if (!coachVoiceOn()) await new Promise((r) => setTimeout(r, Math.max(2200, p.text.split(" ").length * 330)));
    if (!live) return;
    await new Promise((r) => setTimeout(r, 350));
  }
  if (live) {
    // she's done: leave the last line up, keep the Start button lit
    live = false;
    box.classList.add("done");
    if (stopNarration === stop) stopNarration = null;
  }
}
