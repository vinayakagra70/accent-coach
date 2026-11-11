import { FormantSmoother, analyzeFrame } from "./audio/formants";
import { Mic } from "./audio/mic";
import { poseFromFormants, toChart, vowelHint, vowelScore, type VoiceType } from "./audio/mirror";
import { hasVoice, speak, voiceName } from "./audio/speak";
import { LESSONS, LEXICON, type Lesson } from "./content/lessons";
import { MouthScene } from "./mouth/MouthScene";
import { PHONEME_POSES, SEQUENCES, wordTimeline } from "./mouth/phonemes";
import type { Pose } from "./mouth/pose";
import * as progress from "./progress";
import { VowelChart } from "./ui/vowelChart";

// ------------------------------------------------------------------ tiny DOM helper

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<Record<string, string>> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, val] of Object.entries(props)) {
    if (val === undefined) continue;
    if (k === "class") el.className = val;
    else el.setAttribute(k, val);
  }
  for (const c of children) if (c != null) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ------------------------------------------------------------------ state

const scene = new MouthScene($("viewport"));
const mic = new Mic();
const smoother = new FormantSmoother();

type Mode = { kind: "target"; i: number } | { kind: "habit" } | { kind: "mirror" };

let lesson: Lesson = LESSONS[0];
let mode: Mode = { kind: "target", i: 0 };
let voice: VoiceType = (localStorage.getItem("accentCoach.voice") as VoiceType) || "low";
let slow = 1;
let busy = false; // a word animation is playing
let loopTimer: number | null = null;
let chart: VowelChart | null = null;
let mirrorRaf = 0;
let mirrorScores: number[] = [];
let mirrorBest = 0;

const voiceSelect = $<HTMLSelectElement>("voiceType");
voiceSelect.value = voice;
voiceSelect.onchange = () => {
  voice = voiceSelect.value as VoiceType;
  try {
    localStorage.setItem("accentCoach.voice", voice);
  } catch {
    /* ignore */
  }
  if (chart) {
    chart.voice = voice;
    chart.clear();
  }
};
$("viewSide").onclick = () => scene.sideView();
$("view3d").onclick = () => scene.resetView();

// ------------------------------------------------------------------ poses for the current mode

function stopLoop() {
  if (loopTimer !== null) clearInterval(loopTimer);
  loopTimer = null;
}

/** Show one pose, or loop a two-part sound (diphthongs) so the movement is visible. */
function showPoseKey(key: string) {
  stopLoop();
  const seq = SEQUENCES[key];
  if (!seq) {
    const p = PHONEME_POSES[key];
    if (p) scene.setTarget(p);
    return;
  }
  let i = 0;
  const step = () => {
    scene.setTarget(PHONEME_POSES[seq[i % seq.length]]);
    i++;
  };
  step();
  loopTimer = window.setInterval(step, 900 * slow);
}

function firstPose(key: string): Pose | undefined {
  const seq = SEQUENCES[key];
  return PHONEME_POSES[seq ? seq[seq.length - 1] : key];
}

function applyMode() {
  stopMirror();
  if (mode.kind === "target") {
    const t = lesson.targets[mode.i];
    showPoseKey(t.pose);
    scene.setGhost(null);
    scene.setContact(t.contact ?? null);
    $("nowPlaying").textContent = t.pose.replace(" (habit)", "");
  } else if (mode.kind === "habit") {
    showPoseKey(lesson.habit.pose);
    scene.setGhost(firstPose(lesson.targets[0].pose) ?? null);
    scene.setContact(lesson.habit.contact ?? null);
    $("nowPlaying").textContent = lesson.habit.pose.replace(" (habit)", "");
  } else {
    stopLoop();
    scene.setGhost(firstPose(lesson.targets[0].pose) ?? null);
    scene.setContact(null);
    $("nowPlaying").textContent = "";
    void startMirror();
  }
  renderModes();
}

function renderModes() {
  const box = $("modes");
  box.replaceChildren();
  lesson.targets.forEach((t, i) => {
    const b = h("button", {
      class: "mode target",
      role: "tab",
      "aria-selected": String(mode.kind === "target" && mode.i === i),
      title: "Show the American target",
    }, h("span", { class: "sw", style: "background: var(--accent)" }), t.label);
    b.onclick = () => {
      mode = { kind: "target", i };
      applyMode();
    };
    box.append(b);
  });
  const hb = h("button", {
    class: "mode habit",
    role: "tab",
    "aria-selected": String(mode.kind === "habit"),
    title: "What Indian-English speakers often do. The teal outline is where it should be.",
  }, h("span", { class: "sw", style: "background: var(--habit)" }), lesson.habit.label);
  hb.onclick = () => {
    mode = { kind: "habit" };
    applyMode();
  };
  box.append(hb);
  if (lesson.vowel) {
    const mb = h("button", {
      class: "mode mirror",
      role: "tab",
      "aria-selected": String(mode.kind === "mirror"),
      title: "Say the vowel. The 3D tongue follows your voice.",
    }, h("span", { class: "sw", style: "background: var(--air)" }), "Mirror my voice 🎤");
    mb.onclick = () => {
      mode = { kind: "mirror" };
      applyMode();
    };
    box.append(mb);
  }
}

// ------------------------------------------------------------------ words

async function playWord(word: string) {
  if (busy) return;
  const phonemes = LEXICON[word];
  if (!phonemes) return;
  busy = true;
  stopLoop();
  stopMirror();
  scene.setGhost(null);
  scene.setContact(null);
  const steps = wordTimeline(phonemes);
  const now = $("nowPlaying");
  const anim = () =>
    scene.play(steps, slow, (i) => {
      now.textContent = steps[i].symbol;
    });
  scene.speed = slow > 1 ? 9 / slow : 11;
  if (slow === 1) {
    await Promise.all([speak(word, 0.85), anim()]);
  } else {
    await speak(word, 0.7);
    await anim();
    await speak(word, 0.7);
  }
  await new Promise((r) => setTimeout(r, 350));
  scene.speed = 9;
  busy = false;
  if (mode.kind === "mirror") mode = { kind: "target", i: 0 };
  applyMode();
}

// ------------------------------------------------------------------ mirror (vowels)

let mirrorUi: { meter: HTMLElement; hint: HTMLElement; status: HTMLElement; btn: HTMLButtonElement } | null = null;

async function startMirror() {
  if (!lesson.vowel || !chart || !mirrorUi) return;
  try {
    await mic.start();
  } catch {
    mirrorUi.status.textContent = "Microphone blocked. Allow it in the browser's address bar, then try again.";
    return;
  }
  mirrorUi.status.textContent = `Say a long "${lesson.vowel}" (from the word "${lesson.words[0]}"), hold it for 2 s.`;
  mirrorUi.btn.textContent = "Stop mirror";
  smoother.clear();
  mirrorScores = [];
  const target = lesson.vowel;
  const loop = () => {
    const frame = mic.frame();
    const r = frame ? analyzeFrame(frame, mic.sampleRate) : null;
    if (r) {
      const s = smoother.push(r);
      scene.drive(poseFromFormants(s.f1, s.f2, voice));
      chart!.push(toChart(s.f1, s.f2, voice));
      const score = vowelScore(s.f1, s.f2, target, voice);
      mirrorScores.push(score);
      if (mirrorScores.length > 20) mirrorScores.shift();
      const avg = mirrorScores.reduce((a, b) => a + b, 0) / mirrorScores.length;
      if (mirrorScores.length >= 12 && avg > mirrorBest) mirrorBest = Math.round(avg);
      mirrorUi!.meter.style.width = `${Math.round(avg)}%`;
      mirrorUi!.hint.textContent = vowelHint(s.f1, s.f2, target, voice);
    } else {
      chart!.push(null);
    }
    mirrorRaf = requestAnimationFrame(loop);
  };
  mirrorRaf = requestAnimationFrame(loop);
}

function stopMirror() {
  if (mirrorRaf) cancelAnimationFrame(mirrorRaf);
  mirrorRaf = 0;
  if (mic.active) mic.stop();
  if (mirrorBest > 0) {
    progress.recordVowel(lesson.id, mirrorBest);
    renderList();
  }
  mirrorBest = 0;
  if (mirrorUi) mirrorUi.btn.textContent = "Start mirror 🎤";
}

// ------------------------------------------------------------------ lesson list

function renderList() {
  const nav = $("lessonList");
  nav.replaceChildren();
  for (const kind of ["consonant", "vowel"] as const) {
    nav.append(h("h2", {}, kind === "consonant" ? "Consonants" : "Vowels"));
    for (const l of LESSONS.filter((x) => x.kind === kind)) {
      const m = progress.mastery(l.id);
      const b = h(
        "button",
        { class: "lesson-btn", "aria-current": String(l.id === lesson.id) },
        h("span", {}, l.title, h("small", {}, l.sound)),
        h("span", { class: `badge${m !== null && m >= 80 ? " good" : ""}` }, m === null ? "new" : `${m}%`),
      );
      b.onclick = () => openLesson(l);
      nav.append(b);
    }
  }
}

// ------------------------------------------------------------------ right panel

function card(title: string, cls = "", ...body: (Node | string | null)[]) {
  return h("div", { class: `card ${cls}` }, h("h3", {}, title), ...body);
}

function renderPanel() {
  const panel = $("panel");
  panel.replaceChildren();
  chart = null;
  mirrorUi = null;

  panel.append(h("h2", {}, lesson.title), h("p", { class: "sub" }, lesson.sound));
  panel.append(card("The usual mistake", "mistake", h("p", { style: "margin:0" }, lesson.mistake)));
  panel.append(card("How to make it", "", h("ol", {}, ...lesson.steps.map((s) => h("li", {}, s)))));

  // words
  const slowSel = h("select", { "aria-label": "Speed" },
    h("option", { value: "1" }, "Normal"),
    h("option", { value: "2.5" }, "Slow"),
    h("option", { value: "5" }, "Very slow"));
  (slowSel as HTMLSelectElement).value = String(slow);
  slowSel.onchange = () => {
    slow = Number((slowSel as HTMLSelectElement).value);
  };
  panel.append(card("Watch & listen", "",
    h("div", { class: "chips" }, ...lesson.words.map((w) => {
      const c = h("button", { class: "chip", title: "Hear it and watch the mouth" }, w,
        h("span", { class: "ipa" }, `/${(LEXICON[w] ?? []).join("")}/`));
      c.onclick = () => void playWord(w);
      return c;
    })),
    h("div", { class: "slow" }, "Mouth speed", slowSel),
    hasVoice() ? null : h("p", { class: "note" }, "This browser has no speech voice, so words animate silently."),
  ));

  // listening quiz
  if (lesson.pairs.length) panel.append(listenCard());

  // speaking
  if (lesson.vowel) panel.append(mirrorCard());
  panel.append(recordCard());
  panel.append(h("p", { class: "note" }, `Model voice: ${hasVoice() ? voiceName() : "none"}. Drag the 3D view to rotate, scroll to zoom.`));
}

function listenCard() {
  const q = h("p", { class: "quiz-q" }, "Press Play and pick the word you hear.");
  const score = h("span", { class: "score" });
  const answers = h("div", { class: "row" });
  let answer: string | null = null;
  let right = 0;
  let total = 0;
  const p0 = progress.get(lesson.id);
  score.textContent = p0.listenTotal ? `all-time ${p0.listenRight}/${p0.listenTotal}` : "";

  const play = h("button", { class: "btn primary" }, "▶ Play a word");
  play.onclick = async () => {
    const pair = lesson.pairs[Math.floor(Math.random() * lesson.pairs.length)];
    answer = pair[Math.random() < 0.5 ? 0 : 1];
    q.textContent = "Which word was it?";
    q.className = "quiz-q";
    answers.replaceChildren(...pair.map((w) => {
      const b = h("button", { class: "btn" }, w);
      b.onclick = () => {
        if (!answer) return;
        total++;
        const ok = w === answer;
        if (ok) right++;
        progress.recordListen(lesson.id, ok);
        q.textContent = ok ? `Right, it was "${answer}".` : `It was "${answer}". Listen to both again.`;
        q.className = `quiz-q ${ok ? "right" : "wrong"}`;
        const p = progress.get(lesson.id);
        score.textContent = `this round ${right}/${total} · all-time ${p.listenRight}/${p.listenTotal}`;
        answer = null;
        renderList();
      };
      return b;
    }));
    await speak(answer, 0.85);
  };
  const both = h("button", { class: "btn" }, "Hear both");
  both.onclick = async () => {
    const pair = lesson.pairs[Math.floor(Math.random() * lesson.pairs.length)];
    q.textContent = `"${pair[0]}" … then "${pair[1]}"`;
    q.className = "quiz-q";
    await speak(pair[0], 0.8);
    await new Promise((r) => setTimeout(r, 300));
    await speak(pair[1], 0.8);
  };
  return card("1 · Train your ear", "",
    h("p", { class: "note", style: "margin-top:0" }, "You can't say what you can't hear. Get 8 out of 10 before you move on."),
    h("div", { class: "row" }, play, both), q, answers, score);
}

function mirrorCard() {
  const canvas = h("canvas", { class: "chart", "aria-label": "Vowel map with your live voice" });
  const meter = h("i");
  const hint = h("p", { class: "hint" });
  const status = h("p", { class: "note" }, "The 3D tongue will follow your voice. The teal outline is the target.");
  const btn = h("button", { class: "btn primary" }, "Start mirror 🎤") as HTMLButtonElement;
  btn.onclick = () => {
    if (mode.kind === "mirror") {
      mode = { kind: "target", i: 0 };
    } else {
      mode = { kind: "mirror" };
    }
    applyMode();
  };
  const c = card("2 · Mirror your vowel", "", h("div", { class: "row" }, btn), status, canvas,
    h("div", { class: "meter", role: "meter", "aria-label": "Closeness to target" }, meter), hint,
    h("p", { class: "note" }, "Use headphones or a quiet room. Pick your voice type at the top right."));
  chart = new VowelChart(canvas);
  chart.voice = voice;
  chart.target = lesson.vowel ?? null;
  chart.habit = lesson.habitVowel ?? null;
  mirrorUi = { meter, hint, status, btn };
  requestAnimationFrame(() => chart?.draw());
  return c;
}

function recordCard() {
  const status = h("span", { class: "score" });
  const rec = h("button", { class: "btn rec" }, "● Record yourself") as HTMLButtonElement;
  const mine = h("button", { class: "btn", disabled: "" }, "▶ Mine") as HTMLButtonElement;
  const model = h("button", { class: "btn" }, "▶ American model");
  const word = lesson.words[0];
  let url: string | null = null;
  let stopper: { stop: () => Promise<string> } | null = null;
  rec.onclick = async () => {
    if (stopper) {
      url = await stopper.stop();
      stopper = null;
      rec.textContent = "● Record again";
      mine.disabled = false;
      status.textContent = "Compare: play yours, then the model.";
      return;
    }
    try {
      stopper = await mic.record();
      rec.textContent = "■ Stop";
      status.textContent = `Say "${word}"…`;
    } catch {
      status.textContent = "Microphone blocked.";
    }
  };
  mine.onclick = () => {
    if (url) void new Audio(url).play();
  };
  model.onclick = () => void speak(word, 0.85);
  return card(`${lesson.vowel ? "3" : "2"} · Say it: "${word}"`, "",
    h("div", { class: "row" }, rec, mine, model), status,
    h("p", { class: "note" }, "Automatic scoring for consonants comes next (local speech model)."));
}

// ------------------------------------------------------------------ open a lesson

function openLesson(l: Lesson) {
  stopMirror();
  lesson = l;
  mode = { kind: "target", i: 0 };
  scene.setLabels(l.labels.map((key) => (key === "tip" ? { key, text: "Tongue tip" } : { key })));
  renderList();
  renderPanel();
  applyMode();
  try {
    localStorage.setItem("accentCoach.lesson", l.id);
  } catch {
    /* ignore */
  }
}

let startId: string | null = null;
try {
  startId = new URLSearchParams(location.search).get("lesson") ?? localStorage.getItem("accentCoach.lesson");
} catch {
  /* ignore */
}
openLesson(LESSONS.find((l) => l.id === startId) ?? LESSONS[0]);
