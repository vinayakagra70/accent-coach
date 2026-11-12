import * as api from "./api";
import { FormantSmoother, analyzeFrame } from "./audio/formants";
import { Mic } from "./audio/mic";
import { poseFromFormants, toChart, vowelHint, vowelScore, type VoiceType } from "./audio/mirror";
import { recordPhrase } from "./audio/recorder";
import { hasVoice, speak, voiceName } from "./audio/speak";
import { LESSONS, LEXICON, type Lesson } from "./content/lessons";
import {
  completeDay,
  currentStreak,
  dayReady,
  dayRequirements,
  finishedToday,
  loadLocal,
  newProfile,
  replan,
  saveLocal,
  type Assessment,
  type Profile,
} from "./course";
import { MouthScene } from "./mouth/MouthScene";
import { PHONEME_POSES, SEQUENCES, wordTimeline } from "./mouth/phonemes";
import type { Pose } from "./mouth/pose";
import * as progress from "./progress";
import { align, judge, normalizeAll, type CheckResult } from "./scoring/align";
import { LESSON_CHECKS } from "./scoring/checks";
import { $, h } from "./ui/dom";
import { icons, ipa } from "./ui/icons";
import { closeOverlay, runTest, showReport, showWelcome } from "./ui/onboarding";
import { VowelChart } from "./ui/vowelChart";

// ------------------------------------------------------------------ state

const scene = new MouthScene($("viewport"));
const mic = new Mic();
const smoother = new FormantSmoother();

type Mode = { kind: "target"; i: number } | { kind: "habit" } | { kind: "mirror" } | { kind: "yours"; label: string };

let lesson: Lesson = LESSONS[0];
let mode: Mode = { kind: "target", i: 0 };
let voice: VoiceType = (localStorage.getItem("accentCoach.voice") as VoiceType) || "low";
let slow = 1;
let busy = false;
let loopTimer: number | null = null;
let chart: VowelChart | null = null;
let mirrorRaf = 0;
let mirrorScores: number[] = [];
let mirrorBest = 0;
let profile: Profile | null = loadLocal();
let engineReady = false;

function saveProfile(p: Profile) {
  profile = { ...p, updatedAt: new Date().toISOString() };
  saveLocal(profile);
  void api.putProfile(profile);
}

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
$("retakeTest").prepend(icons.mic());
$("retakeTest").onclick = () => startTest(true);

/** Replace a button's content with an icon and a label. */
function label(btn: HTMLElement, icon: (() => SVGElement) | null, text: string) {
  btn.replaceChildren(...(icon ? [icon()] : []), text);
}

/** IPA symbols a lesson teaches, from its target poses ("v", "w"; "eɪ"). */
function lessonSymbols(l: Lesson): string[] {
  return [...new Set(l.targets.map((t) => t.pose.replace(" (habit)", "")))];
}

// ------------------------------------------------------------------ course helpers

function todaysLessonId(): string | null {
  const d = profile?.course[profile.day];
  return d && d.kind === "lesson" ? d.lesson ?? null : null;
}

function isToday(l: Lesson) {
  return todaysLessonId() === l.id;
}

function bumpToday(change: (t: Profile["today"]) => void) {
  if (!profile || !isToday(lesson)) return;
  const today = { ...profile.today };
  change(today);
  saveProfile({ ...profile, today });
  renderTodayCard();
  renderList();
}

// ------------------------------------------------------------------ poses for the current mode

function stopLoop() {
  if (loopTimer !== null) clearInterval(loopTimer);
  loopTimer = null;
}

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

function ghostPose(key: string): Pose | undefined {
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
    if (profile && isToday(lesson) && !profile.today.learnedTarget) bumpToday((t) => (t.learnedTarget = true));
  } else if (mode.kind === "habit") {
    showPoseKey(lesson.habit.pose);
    scene.setGhost(ghostPose(lesson.targets[0].pose) ?? null);
    scene.setContact(lesson.habit.contact ?? null);
    $("nowPlaying").textContent = lesson.habit.pose.replace(" (habit)", "");
    if (profile && isToday(lesson) && !profile.today.learnedHabit) bumpToday((t) => (t.learnedHabit = true));
  } else if (mode.kind === "mirror") {
    stopLoop();
    scene.setGhost(ghostPose(lesson.targets[0].pose) ?? null);
    scene.setContact(null);
    $("nowPlaying").textContent = "";
    void startMirror();
  }
  // "yours" is set up by showWhatYouSaid()
  renderModes();
}

function renderModes() {
  const box = $("modes");
  box.replaceChildren();
  lesson.targets.forEach((t, i) => {
    const b = h("button", { class: "mode target", role: "tab", "aria-selected": String(mode.kind === "target" && mode.i === i), title: "Show the American target" },
      h("span", { class: "sw", style: "background: var(--accent)" }), t.label);
    b.onclick = () => {
      mode = { kind: "target", i };
      applyMode();
    };
    box.append(b);
  });
  const hb = h("button", { class: "mode habit", role: "tab", "aria-selected": String(mode.kind === "habit"), title: "What Indian-English speakers often do. The green outline is where it should be." },
    h("span", { class: "sw", style: "background: var(--habit)" }), lesson.habit.label);
  hb.onclick = () => {
    mode = { kind: "habit" };
    applyMode();
  };
  box.append(hb);
  if (lesson.vowel) {
    const mb = h("button", { class: "mode mirror", role: "tab", "aria-selected": String(mode.kind === "mirror"), title: "Say the vowel. The 3D tongue follows your voice." },
      icons.mic(), "Mirror my voice");
    mb.onclick = () => {
      mode = { kind: "mirror" };
      applyMode();
    };
    box.append(mb);
  }
  if (mode.kind === "yours") {
    box.append(h("button", { class: "mode habit", role: "tab", "aria-selected": "true" },
      h("span", { class: "sw", style: "background: var(--habit)" }), mode.label));
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
  const anim = () => scene.play(steps, slow, (i) => (now.textContent = steps[i].symbol));
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
  if (mode.kind === "mirror" || mode.kind === "yours") mode = { kind: "target", i: 0 };
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
  label(mirrorUi.btn, icons.stop, "Stop mirror");
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
  if (mirrorUi) label(mirrorUi.btn, icons.mic, "Start mirror");
}

// ------------------------------------------------------------------ sidebar

function renderList() {
  const nav = $("lessonList");
  nav.replaceChildren();

  if (profile) {
    const total = profile.course.length;
    const d = profile.course[profile.day];
    const streak = currentStreak(profile);
    const name = !d ? "Course complete" : d.kind === "checkup" ? "Check-up voice test" : LESSONS.find((l) => l.id === d.lesson)?.title ?? "";
    const go = h("button", { class: "btn primary small" }, !d ? "Review" : finishedToday(profile) ? "Start next day early" : "Go to today");
    go.onclick = () => goToday();
    nav.append(h("div", { class: "course-card" },
      h("div", { class: "row spread" }, h("b", {}, `Day ${Math.min(profile.day + 1, total)} of ${total}`), streak ? h("span", { class: "streak" }, `${streak}-day streak`) : null),
      h("div", { class: "course-bar" }, h("i", { style: `width:${(profile.day / Math.max(1, total)) * 100}%` })),
      h("p", { class: "muted small" }, finishedToday(profile) ? "Done for today. Next" : "Today"),
      h("p", { class: "today-name" }, name),
      profile.assessment ? h("p", { class: "muted small" }, `Voice score ${profile.assessment.overall} of 100`) : null,
      go));
  } else {
    const start = h("button", { class: "btn primary small" }, "Take the voice test");
    start.onclick = () => startTest(false);
    nav.append(h("div", { class: "course-card" }, h("b", {}, "No course yet"), h("p", { class: "muted small" }, "A 3-minute voice test builds your personal course."), start));
  }

  const todayId = todaysLessonId();
  const courseIds = new Set(profile?.course.filter((d) => d.kind === "lesson").map((d) => d.lesson));
  for (const kind of ["consonant", "vowel"] as const) {
    nav.append(h("h2", {}, kind === "consonant" ? "Consonants" : "Vowels"));
    for (const l of LESSONS.filter((x) => x.kind === kind)) {
      const testScore = profile?.assessment?.lessons[l.id]?.score;
      const m = progress.mastery(l.id);
      const shown = testScore ?? m;
      const known = shown !== null && shown !== undefined;
      const b = h("button", { class: `lesson-btn${l.id === todayId ? " today" : ""}${profile && !courseIds.has(l.id) ? " passed" : ""}`, "aria-current": String(l.id === lesson.id), title: l.sound },
        h("span", {}, h("span", { class: "name" }, l.title), h("span", { class: "tags" }, ...lessonSymbols(l).map(ipa))),
        h("span", { class: `badge${known && shown! >= 85 ? " good" : known && shown! < 60 ? " low" : ""}` }, known ? `${shown}%` : "–"));
      b.onclick = () => openLesson(l);
      nav.append(b);
    }
  }
}

// ------------------------------------------------------------------ right panel

function card(title: string, cls = "", ...body: (Node | string | null)[]) {
  return h("div", { class: `card ${cls}` }, h("h3", {}, title), ...body);
}

let todaySlot: HTMLElement | null = null;

function renderTodayCard() {
  if (!todaySlot) return;
  todaySlot.replaceChildren();
  if (!profile || !isToday(lesson)) return;
  const t = profile.today;
  const req = dayRequirements(lesson.id);
  const step = (done: boolean, text: string, detail?: string) =>
    h("li", { class: done ? "done" : "" }, h("span", { class: "tick" }, done ? icons.check(12) : null), h("span", {}, text, detail ? h("small", {}, detail) : null));
  const finish = h("button", { class: "btn primary" }, `Finish day ${profile.day + 1}`) as HTMLButtonElement;
  if (!dayReady(profile)) finish.disabled = true;
  finish.onclick = () => {
    if (!profile) return;
    saveProfile(completeDay(profile));
    renderList();
    renderPanel();
  };
  todaySlot.append(card(`Today · Day ${profile.day + 1}`, "today-card",
    h("ol", { class: "steps" },
      step(t.learnedTarget, "Watch the American way"),
      step(t.learnedHabit, "See your Indian habit"),
      req.ear ? step(t.earAnswered >= req.ear, "Train your ear", `${Math.min(t.earAnswered, req.ear)}/${req.ear}`) : null,
      step(t.speakTries >= req.speak, "Say it, scored", `${Math.min(t.speakTries, req.speak)}/${req.speak} words`)),
    h("div", { class: "row" }, finish)));
}

function renderPanel() {
  const panel = $("panel");
  panel.replaceChildren();
  chart = null;
  mirrorUi = null;

  panel.append(h("h2", {}, lesson.title), h("p", { class: "sub" }, ...lessonSymbols(lesson).map(ipa), `as in ${lesson.words.slice(0, 3).join(", ")}`));

  // finished today → friendly "come back tomorrow"
  if (profile && finishedToday(profile) && profile.course[profile.day - 1]?.lesson === lesson.id) {
    const next = profile.course[profile.day];
    const early = h("button", { class: "btn" }, "Start it now anyway");
    early.onclick = () => goToday();
    panel.append(card("Day done", "today-card",
      h("p", {}, next ? `Nice work. Tomorrow: ${next.kind === "checkup" ? "a check-up voice test" : LESSONS.find((l) => l.id === next.lesson)?.title}.` : "That was the last day. Take the voice test to see your progress."),
      next ? h("div", { class: "row" }, early) : null));
  }

  todaySlot = h("div");
  panel.append(todaySlot);
  renderTodayCard();

  const finding = profile?.assessment?.lessons[lesson.id]?.findings[0];
  if (finding) {
    panel.append(card("From your voice test", "mistake",
      h("p", {}, `In "${finding.word}" you said ${finding.habit}.`),
      finding.target ? h("p", { class: "ipa-tag", style: "margin-top:4px" }, `/${finding.heard}/ instead of /${finding.target}/`) : null));
  }
  panel.append(card("The usual mistake", "mistake", h("p", { style: "margin:0" }, lesson.mistake)));
  panel.append(card("How to make it", "", h("ol", {}, ...lesson.steps.map((s) => h("li", {}, s)))));

  const slowSel = h("select", { "aria-label": "Speed" }, h("option", { value: "1" }, "Normal"), h("option", { value: "2.5" }, "Slow"), h("option", { value: "5" }, "Very slow"));
  slowSel.value = String(slow);
  slowSel.onchange = () => (slow = Number(slowSel.value));
  panel.append(card("Watch & listen", "",
    h("div", { class: "chips" }, ...lesson.words.map((w) => {
      const c = h("button", { class: "chip", title: "Hear it and watch the mouth" }, w, h("span", { class: "ipa" }, `/${(LEXICON[w] ?? []).join("")}/`));
      c.onclick = () => void playWord(w);
      return c;
    })),
    h("div", { class: "slow" }, "Mouth speed", slowSel),
    hasVoice() ? null : h("p", { class: "note" }, "This browser has no speech voice, so words animate silently.")));

  if (lesson.pairs.length) panel.append(listenCard());
  if (LESSON_CHECKS[lesson.id]?.voiceTested) panel.append(scoredCard());
  if (lesson.vowel) panel.append(mirrorCard());
  if (!LESSON_CHECKS[lesson.id]?.voiceTested) panel.append(recordCard());
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

  const play = h("button", { class: "btn primary" }, icons.play(), "Play a word");
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
        bumpToday((t) => {
          t.earAnswered++;
          if (ok) t.earRight++;
        });
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
  const both = h("button", { class: "btn" }, icons.listen(), "Hear both");
  both.onclick = async () => {
    const pair = lesson.pairs[Math.floor(Math.random() * lesson.pairs.length)];
    q.textContent = `"${pair[0]}" … then "${pair[1]}"`;
    q.className = "quiz-q";
    await speak(pair[0], 0.8);
    await new Promise((r) => setTimeout(r, 300));
    await speak(pair[1], 0.8);
  };
  return card("Train your ear", "",
    h("p", { class: "note", style: "margin-top:0" }, "You can't say what you can't hear. Get 8 out of 10 before you move on."),
    h("div", { class: "row" }, play, both), q, answers, score);
}

// ------------------------------------------------------------------ scored speaking

/** Habit sounds we can draw: what the model heard → a pose key. */
const HEARD_POSE: Record<string, string> = {
  ʈ: "ʈ (habit)", ɖ: "ɖ (habit)", "t̪": "t̪ (habit)", "d̪": "d̪ (habit)", ʋ: "ʋ (habit)", β: "ʋ (habit)",
  r: "ɾ (habit)", dʒ: "dʒ (habit)", p: "pʰ (habit)", ɸ: "pʰ (habit)", e: "e", o: "o", ə: "ə", ɐ: "ə", a: "ɑ",
};

function poseForHeard(tok: string, target: string): string | null {
  if (lesson.id === "flap-t" && tok === "ɾ") return "ɾ";
  if (lesson.id !== "flap-t" && tok === "ɾ" && target === "ɹ") return "ɾ (habit)";
  return HEARD_POSE[tok] ?? (PHONEME_POSES[tok] ? tok : null);
}

function judgeWord(word: string, heard: string[]): { sym: string; res: CheckResult }[] {
  const expected = normalizeAll(LEXICON[word] ?? []);
  const sounds = LESSON_CHECKS[lesson.id]?.sounds ?? {};
  const pairs = align(expected, heard);
  const out: { sym: string; res: CheckResult }[] = [];
  expected.forEach((sym, i) => {
    const check = sounds[sym];
    if (check) out.push({ sym, res: judge(expected, heard, pairs, i, check) });
  });
  return out;
}

function showWhatYouSaid(heardTok: string, targetSym: string, label: string) {
  const key = poseForHeard(heardTok, targetSym);
  if (!key) return;
  stopLoop();
  stopMirror();
  scene.setTarget(PHONEME_POSES[key]);
  scene.setGhost(ghostPose(lesson.targets[0].pose) ?? null);
  scene.setContact(null);
  $("nowPlaying").textContent = heardTok;
  mode = { kind: "yours", label: `What you did: ${label}` };
  renderModes();
}

function scoredCard() {
  const status = h("p", { class: "note" });
  const results = h("div", { class: "results" });
  const words = lesson.words.filter((w) => judgeWord(w, []).length > 0);
  let recording = false;

  const setEngine = async () => {
    const s = await api.health();
    engineReady = s.ready;
    status.textContent = s.ready ? "Press a word, say it, then pause. It's checked sound by sound."
      : s.reachable ? "Speech engine is loading… (about 30 s the first time)" : "Speech engine isn't running. Start the app with start.bat to get scored.";
    if (!s.ready && s.reachable) setTimeout(setEngine, 2500);
  };
  void setEngine();

  const say = async (word: string, btn: HTMLButtonElement) => {
    if (recording || !engineReady) return;
    recording = true;
    btn.classList.add("live");
    status.textContent = `Say "${word}"…`;
    try {
      const take = await recordPhrase({ maxSeconds: 4, silenceToStop: 0.7 });
      btn.classList.remove("live");
      if (!take.speech) {
        status.textContent = "I didn't hear anything. Try again a little louder.";
        return;
      }
      status.textContent = "Checking…";
      const heard = normalizeAll(await api.recognize(take.wav));
      const judged = judgeWord(word, heard);
      const allGood = judged.every((j) => j.res.verdict === "good");
      const habit = judged.find((j) => j.res.verdict === "habit");
      const off = judged.find((j) => j.res.verdict === "off");
      bumpToday((t) => {
        t.speakTries++;
        if (allGood) t.speakGood++;
      });
      let msg: string;
      if (allGood) msg = `"${word}": a clean American ${judged.map((j) => `/${j.sym}/`).join(" and ")}`;
      else if (habit) msg = `"${word}": you said ${habit.res.habit}. The mouth shows what you did, and the green outline is the target.`;
      else msg = `"${word}": the /${off?.sym}/ didn't come out clearly. Try it again, slower.`;
      const row = h("div", { class: `result ${allGood ? "good" : habit ? "bad" : "mid"}` }, h("span", {}, msg), h("span", { class: "ipa-tag" }, `heard /${heard.join("")}/`));
      results.prepend(row);
      while (results.children.length > 5) results.lastChild?.remove();
      status.textContent = "Press a word to go again.";
      if (habit) showWhatYouSaid(habit.res.heard, habit.sym, habit.res.habit ?? "");
    } catch (e) {
      status.textContent = `Couldn't check that: ${(e as Error).message}`;
    } finally {
      recording = false;
      btn.classList.remove("live");
    }
  };

  return card("Say it · scored", "",
    status,
    h("div", { class: "chips" }, ...words.map((w) => {
      const b = h("button", { class: "chip say" }, icons.mic(), w) as HTMLButtonElement;
      b.onclick = () => void say(w, b);
      return b;
    })),
    results);
}

function mirrorCard() {
  const canvas = h("canvas", { class: "chart", "aria-label": "Vowel map with your live voice" });
  const meter = h("i");
  const hint = h("p", { class: "hint" });
  const status = h("p", { class: "note" }, "The 3D tongue follows your voice. The green outline is the target.");
  const btn = h("button", { class: "btn primary" }, icons.mic(), "Start mirror") as HTMLButtonElement;
  btn.onclick = () => {
    mode = mode.kind === "mirror" ? { kind: "target", i: 0 } : { kind: "mirror" };
    applyMode();
  };
  const c = card("Mirror your vowel", "", h("div", { class: "row" }, btn), status, canvas,
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

/** For sounds the speech model can't judge (dark L, aspiration): record and compare by ear. */
function recordCard() {
  const status = h("span", { class: "score" });
  const rec = h("button", { class: "btn rec" }, icons.mic(), "Record yourself") as HTMLButtonElement;
  const mine = h("button", { class: "btn", disabled: "" }, icons.play(), "Mine") as HTMLButtonElement;
  const model = h("button", { class: "btn" }, icons.listen(), "American model");
  const word = lesson.words[0];
  let url: string | null = null;
  let stopper: { stop: () => Promise<string> } | null = null;
  rec.onclick = async () => {
    if (stopper) {
      url = await stopper.stop();
      stopper = null;
      label(rec, icons.again, "Record again");
      mine.disabled = false;
      status.textContent = "Compare: play yours, then the model.";
      bumpToday((t) => t.speakTries++);
      return;
    }
    try {
      stopper = await mic.record();
      label(rec, icons.stop, "Stop");
      status.textContent = `Say "${word}"…`;
    } catch {
      status.textContent = "Microphone blocked.";
    }
  };
  mine.onclick = () => {
    if (url) void new Audio(url).play();
  };
  model.onclick = () => void speak(word, 0.85);
  return card(`Say it: "${word}"`, "",
    h("div", { class: "row" }, rec, mine, model), status,
    h("p", { class: "note" }, "This sound can't be scored automatically yet, so compare by ear."));
}

// ------------------------------------------------------------------ flow

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

function goToday() {
  if (!profile) return startTest(false);
  const d = profile.course[profile.day];
  if (!d) return openLesson(lesson);
  if (d.kind === "checkup") {
    openLesson(lesson);
    return startTest(true);
  }
  openLesson(LESSONS.find((l) => l.id === d.lesson) ?? LESSONS[0]);
}

function startTest(retake: boolean) {
  showWelcome({
    retake,
    onCancel: closeOverlay,
    onSkip: () => {
      closeOverlay();
      if (!profile) saveProfile(newProfile(null, true));
      goToday();
    },
    onStart: () =>
      runTest({
        onCancel: () => {
          closeOverlay();
          if (!profile) startTest(false);
        },
        onDone: (a: Assessment) => {
          const previous = profile?.assessment?.overall;
          const p = profile && profile.course.length ? replan(profile, a) : newProfile(a, false);
          saveProfile(p);
          showReport({
            assessment: a,
            course: p.course.slice(p.day),
            previous,
            onStart: (lessonId) => {
              closeOverlay();
              if (lessonId) openLesson(LESSONS.find((l) => l.id === lessonId)!);
              else goToday();
            },
          });
        },
      }),
  });
}

async function boot() {
  // Prefer the server's copy if it's newer (e.g. progress made in another browser).
  const server = await api.getProfile();
  if (server && (!profile || server.updatedAt > profile.updatedAt)) {
    profile = server;
    saveLocal(server);
  }
  let startId: string | null = null;
  try {
    startId = new URLSearchParams(location.search).get("lesson");
  } catch {
    /* ignore */
  }
  if (startId) return openLesson(LESSONS.find((l) => l.id === startId) ?? LESSONS[0]);
  if (!profile) {
    openLesson(LESSONS[0]);
    return startTest(false);
  }
  goToday();
}

void boot();
