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
import { ACCENTS, accent, accentInfo, type Accent } from "../content/accent";

/** Full-screen steps over the app: welcome → voice test → report. */

function overlay(): HTMLElement {
  const o = $("overlay");
  o.hidden = false;
  o.replaceChildren();
  return o;
}

export function closeOverlay() {
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
  const start = h("button", { class: "btn primary big", disabled: "" }, icons.mic(), "Start the voice test");
  const stopPoll = mountEngineGate(status, (ready) => {
    if (ready) start.removeAttribute("disabled");
    else start.setAttribute("disabled", "");
  });
  start.onclick = () => {
    stopPoll();
    opts.onStart();
  };
  const skip = h("button", { class: "btn" }, opts.retake ? "Not now" : "Skip — give me the standard course");
  skip.onclick = () => {
    stopPoll();
    (opts.retake ? opts.onCancel ?? opts.onSkip : opts.onSkip)();
  };
  o.append(
    h("div", { class: "sheet" },
      h("p", { class: "eyebrow" }, opts.retake ? "Check-up" : "Welcome"),
      h("h2", {}, opts.retake ? "Let's see how far you've come" : "First, let's hear how you speak"),
      h("p", { class: "lead" },
        opts.retake
          ? "Read the same 13 short phrases again. Your course will adjust to what's improved and what still needs work."
          : "Read 13 short phrases out loud (about 3 minutes). Accent Coach listens to each sound, finds the habits that make English sound Indian, and builds a day-by-day course around your flaws."),
      picker ? h("h3", { style: "margin-top:0" }, "Which accent do you want to learn?") : null,
      picker,
      h("ul", { class: "ticks" },
        h("li", {}, "Use a quiet room. Headphones help."),
        h("li", {}, "Speak naturally, the way you normally would. Don't perform."),
        h("li", {}, "Recording stops by itself when you pause."),
        h("li", {}, `Your recordings stay on this ${api.STATIC ? "device" : "laptop"} and aren't saved.`)),
      status,
      h("div", { class: "row" }, start, skip),
    ),
  );
}

// ------------------------------------------------------------------ the test

export function runTest(opts: { onDone: (a: Assessment) => void; onCancel: () => void }) {
  const o = overlay();
  const results: (Promise<string[] | null> | null)[] = ASSESSMENT.map(() => null);
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
    const item = ASSESSMENT[index];
    phrase.textContent = item.text;
    counter.textContent = `${index + 1} / ${ASSESSMENT.length}`;
    bar.style.width = `${(index / ASSESSMENT.length) * 100}%`;
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
    if (index < ASSESSMENT.length) show();
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
      results[i] = api.recognize(take).catch(() => null);
      state.textContent = "Recorded";
      state.className = "rec-state ok";
      recBtn.hidden = true;
      redo.hidden = false;
      next.hidden = false;
      next.replaceChildren(index === ASSESSMENT.length - 1 ? "See my results" : "Next", icons.next());
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return;
      state.textContent = "Microphone blocked. Allow it from the icon in the address bar, then try again.";
      state.className = "rec-state warn";
      recBtn.removeAttribute("disabled");
    }
  };

  const finish = async () => {
    o.replaceChildren(h("div", { class: "sheet" }, h("p", { class: "eyebrow" }, "Voice test"), h("h2", {}, "Listening to your recordings…"), h("div", { class: "spinner" })));
    const heard = await Promise.all(results.map((r) => r ?? Promise.resolve(null)));
    const items: ItemResult[] = ASSESSMENT.map((item, i) => ({ item, heard: heard[i] ? normalizeAll(heard[i]!) : null }));
    const recorded = items.filter((x) => x.heard).length;
    if (recorded < 4) {
      o.replaceChildren(h("div", { class: "sheet" },
        h("h2", {}, "Not enough recordings"),
        h("p", { class: "lead" }, `Only ${recorded} of ${ASSESSMENT.length} phrases came through, which isn't enough to judge fairly.`),
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

export function showReport(opts: { assessment: Assessment; course: CourseDay[]; previous?: number; onStart: (lessonId?: string) => void }) {
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

  const flawList = h("div", { class: "flaws" }, ...flaws.slice(0, 8).map((f) => {
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
  }));

  const lessonDays = opts.course.filter((d) => d.kind === "lesson");
  const courseList = h("ol", { class: "course-preview" }, ...opts.course.slice(0, 6).map((d) =>
    h("li", {}, d.kind === "checkup" ? "Check-up: voice test again" : lessonTitle(d.lesson!))));

  const start = h("button", { class: "btn primary big" }, "Start day 1", icons.next());
  start.onclick = () => opts.onStart();

  o.append(
    h("div", { class: "sheet report" },
      h("p", { class: "eyebrow" }, "Your accent report"),
      h("div", { class: "report-top" }, ring, h("div", {}, h("h2", {}, verdict), delta,
        h("p", { class: "muted" }, `Based on 13 phrases, judged sound by sound against ${accentInfo().long}. ${accent() === "uk" ? "Dark L, the puff on P/T/K and dropping the R" : "Dark L and the puff on P/T/K"} can't be heard reliably yet, so they're taught but not scored.`))),
      flaws.length ? h("h3", {}, "What to fix") : h("h3", {}, "Nothing major to fix"),
      flawList,
      good.length ? h("h3", {}, "Already good") : null,
      good.length ? h("div", { class: "chips" }, ...good.map((g) => h("span", { class: "chip static" }, icons.check(), g.title))) : null,
      h("h3", {}, `Your course: ${lessonDays.length} sounds, one a day`),
      courseList,
      h("div", { class: "row" }, start),
    ),
  );
}
