import * as api from "./api";
import { FormantSmoother, analyzeFrame } from "./audio/formants";
import { Mic } from "./audio/mic";
import { poseFromFormants, toChart, vowelHint, vowelScore, type VoiceType } from "./audio/mirror";
import { recordPhrase, type Take } from "./audio/recorder";
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
import { align, judge, normalizeAll, type CheckResult, type Verdict } from "./scoring/align";
import { LESSON_CHECKS } from "./scoring/checks";
import { judgeItem } from "./scoring/report";
import type { TestItem } from "./content/assessment";
import { sentenceItem, sentenceText } from "./content/sentences";
import { REVIEW_CLEAN, dueReviews, recordAttempt, type ReviewItem } from "./review";
import { $, h } from "./ui/dom";
import { icons, ipa } from "./ui/icons";
import { mountEngineGate } from "./ui/engineGate";
import { lines } from "./speech/lines";
import { coachSays, coachVoiceOn, mountCoach, react, setCoachVoice, stopTalking } from "./coach";
import { ACCENTS, accent, accentInfo, setAccent, type Accent } from "./content/accent";
import { closeOverlay, runTest, showReport, showWelcome } from "./ui/onboarding";
import { VowelChart } from "./ui/vowelChart";
import { friendlyTime } from "./reminder";
import { reminderTime, showReminder } from "./ui/reminder";

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
  profile = { ...p, rev: p.rev ?? profile?.rev, practice: progress.all(), updatedAt: new Date().toISOString() };
  saveLocal(profile);
  api.putProfile(profile);
}

/** Practice outside today's lesson changes no course state, but still has to reach the server. */
function savePractice() {
  if (profile) saveProfile(profile);
}

/** Take the server's copy as ours (it is newer: saved from another device or browser). */
function adoptServer(server: Profile) {
  profile = server;
  saveLocal(server);
  progress.merge(server.practice);
  api.profileBasedOn(server.rev ?? 0);
}

/** The same, while the app is already on screen: redraw everything that shows the profile. */
function switchToServer(server: Profile) {
  adoptServer(server);
  if ((server.accent ?? "us") !== accent()) applyAccent(server.accent ?? "us");
  openLesson(LESSONS.find((l) => l.id === lesson.id) ?? LESSONS[0]);
}

api.onProfileSync({
  saved: (rev) => {
    if (!profile) return;
    profile = { ...profile, rev };
    saveLocal(profile);
  },
  conflict: switchToServer,
});

/** Coming back to a tab that was left open: pick up what another device did meanwhile. */
async function refreshFromServer() {
  if (document.hidden || busy || api.profileSyncBusy()) return;
  const server = await api.getProfile();
  if (server && (server.rev ?? 0) > (profile?.rev ?? 0) && !busy && !api.profileSyncBusy()) switchToServer(server);
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
// ------------------------------------------------------------------ target accent

const accentPick = $<HTMLSelectElement>("accentPick");

function applyAccent(a: Accent) {
  setAccent(a);
  accentPick.value = a;
  $("tagline").textContent = `${ACCENTS[a].long} for Indian English speakers`;
  try {
    localStorage.setItem("accentCoach.accent", a);
  } catch {
    /* ignore */
  }
}

accentPick.onchange = () => {
  const next = accentPick.value as Accent;
  if (next === accent()) return;
  if (profile && profile.course.length && !confirm(`Switch to ${ACCENTS[next].long}? Your course will be rebuilt for it. Your streak is kept.`)) {
    accentPick.value = accent();
    return;
  }
  applyAccent(next);
  if (profile) {
    const fresh = newProfile(null, true, next);
    saveProfile({ ...fresh, streak: profile.streak, history: profile.history });
  }
  openLesson(LESSONS.find((l) => l.id === lesson.id) ?? LESSONS[0]);
  void coachSays(lines.switched(ACCENTS[next].long), "happy");
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
    const b = h("button", { class: "mode target", role: "tab", "aria-selected": String(mode.kind === "target" && mode.i === i), title: `Show the ${accentInfo().name} target` },
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
  try {
    stopLoop();
    stopMirror();
    scene.setGhost(null);
    scene.setContact(null);
    const steps = wordTimeline(phonemes);
    const now = $("nowPlaying");
    const anim = () => scene.play(steps, slow, (i) => (now.textContent = steps[i].symbol));
    scene.speed = slow > 1 ? 9 / slow : 11;
    // a failed voice shouldn't stop the mouth animating, or lock the word chips
    const say = (rate: number) => speak(word, rate).catch(() => undefined);
    if (slow === 1) {
      await Promise.all([say(0.85), anim()]);
    } else {
      await say(0.7);
      await anim();
      await say(0.7);
    }
    await new Promise((r) => setTimeout(r, 350));
  } finally {
    scene.speed = 9;
    busy = false;
  }
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
    savePractice();
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
    const dueN = reviewsDue().length;
    const go = h("button", { class: "btn primary small" }, !d ? "Review" : finishedToday(profile) ? "Start next day early" : "Go to today");
    go.onclick = () => goToday();
    const at = reminderTime();
    const remind = h("button", { class: "linklike small remind" }, icons.bell(), at ? `Reminder at ${friendlyTime(at)}` : "Remind me every day");
    remind.onclick = () => showReminder(renderList);
    nav.append(h("div", { class: "course-card" },
      h("div", { class: "row spread" }, h("b", {}, `Day ${Math.min(profile.day + 1, total)} of ${total}`), streak ? h("span", { class: "streak" }, `${streak}-day streak`) : null),
      h("div", { class: "course-bar" }, h("i", { style: `width:${(profile.day / Math.max(1, total)) * 100}%` })),
      h("p", { class: "muted small" }, finishedToday(profile) ? "Done for today. Next" : "Today"),
      h("p", { class: "today-name" }, name),
      profile.assessment ? h("p", { class: "muted small" }, `Voice score ${profile.assessment.overall} of 100`) : null,
      dueN ? h("p", { class: "muted small" }, `${dueN} word${dueN === 1 ? "" : "s"} to review today`) : null,
      go,
      remind));
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
    void coachSays(lines.dayDone(profile.day), "happy");
    renderList();
    renderPanel();
  };
  todaySlot.append(card(`Today · Day ${profile.day + 1}`, "today-card",
    h("ol", { class: "steps" },
      step(t.learnedTarget, `Watch the ${accentInfo().name} way`),
      step(t.learnedHabit, "See your Indian habit"),
      req.ear ? step(t.earAnswered >= req.ear, "Train your ear", `${Math.min(t.earAnswered, req.ear)}/${req.ear}`) : null,
      step(t.speakTries >= req.speak, "Say it, scored", `${Math.min(t.speakTries, req.speak)}/${req.speak} words`),
      req.sentence ? step((t.sentenceTries ?? 0) >= req.sentence, "Say it in a sentence") : null),
    h("div", { class: "row" }, finish)));
}

function renderPanel() {
  const panel = $("panelBody");
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

  resetEngineGate();
  reviewSlot = h("div");
  reviewUi = null;
  panel.append(reviewSlot);
  renderReviewCard();

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
  const sentence = sentenceItem(lesson.id);
  const byEar = sentence ? null : sentenceText(lesson.id);
  if (sentence) panel.append(sentenceCard(sentence));
  if (lesson.vowel) panel.append(mirrorCard());
  if (!LESSON_CHECKS[lesson.id]?.voiceTested) panel.append(recordCard());
  if (byEar) panel.append(sentenceByEarCard(byEar));
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
        savePractice();
        bumpToday((t) => {
          t.earAnswered++;
          if (ok) t.earRight++;
        });
        react(ok ? "happy" : "curious", 1800);
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

function judgeWord(word: string, heard: string[], lessonId = lesson.id): { sym: string; res: CheckResult }[] {
  const expected = normalizeAll(LEXICON[word] ?? []);
  const sounds = LESSON_CHECKS[lessonId]?.sounds ?? {};
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

// One engine gate per panel, shown in the first card that uses the microphone;
// the other cards only hear whether it's ready.
let stopGate: (() => void) | null = null;
let engineWatchers: ((ready: boolean) => void)[] = [];

function resetEngineGate() {
  stopGate?.();
  stopGate = null;
  engineWatchers = [];
}

function engineGate(onReady: (ready: boolean) => void): HTMLElement | null {
  engineWatchers.push(onReady);
  if (stopGate) {
    onReady(engineReady);
    return null;
  }
  const host = h("div");
  const watchers = engineWatchers;
  stopGate = mountEngineGate(host, (ready) => {
    engineReady = ready;
    host.hidden = ready;
    watchers.forEach((f) => f(ready));
  });
  return host;
}

let recording = false;

type RecordOpts = { maxSeconds: number; silenceToStop: number };

/** Record until the learner pauses. null (with the reason in `status`) when nothing was said or the mic is blocked. */
async function capture(btn: HTMLElement, status: HTMLElement, prompt: string, opts: RecordOpts): Promise<Take | null> {
  if (recording) return null;
  recording = true;
  stopTalking(); // never record the coach's own voice
  btn.classList.add("live");
  status.textContent = prompt;
  try {
    const take = await recordPhrase(opts);
    if (!take.speech) {
      status.textContent = "I didn't hear anything. Try again a little louder.";
      return null;
    }
    return take;
  } catch {
    status.textContent = "Microphone blocked. Allow it in the browser's address bar, then try again.";
    return null;
  } finally {
    recording = false;
    btn.classList.remove("live");
  }
}

/** Record, then ask the speech engine what it heard. Returns the sounds, or null (with the reason in `status`). */
async function hear(btn: HTMLElement, status: HTMLElement, prompt: string, opts: RecordOpts, keep?: (take: Take) => void): Promise<string[] | null> {
  if (!engineReady) {
    status.textContent = "The speech engine isn't ready yet.";
    return null;
  }
  const take = await capture(btn, status, prompt, opts);
  if (!take) return null;
  keep?.(take);
  status.textContent = "Checking…";
  try {
    return normalizeAll(await api.recognize(take));
  } catch (e) {
    status.textContent = `Couldn't check that: ${(e as Error).message}`;
    return null;
  }
}

/**
 * Shadowing: the model sentence, then the learner's own recording, back to back.
 * Hearing the two side by side trains rhythm and melody, which no score covers.
 */
function shadowing(text: string) {
  let mine: string | null = null;
  let playing = false;
  const both = h("button", { class: "btn", disabled: "", title: "The model, then your recording" }, icons.play(), "Hear both") as HTMLButtonElement;
  both.onclick = async () => {
    if (!mine || playing || recording) return;
    playing = true;
    try {
      await speak(text, 0.85).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 250));
      const url = mine;
      await new Promise<void>((res) => {
        const a = new Audio(url);
        a.onended = a.onerror = () => res();
        void a.play().catch(() => res());
      });
    } finally {
      playing = false;
    }
  };
  return {
    both,
    /** Keep the newest take (and free the one before it). */
    keep(take: Take) {
      if (mine) URL.revokeObjectURL(mine);
      mine = URL.createObjectURL(new Blob([take.wav], { type: "audio/wav" }));
      both.disabled = false;
    },
  };
}

/** One word's sounds judged against a lesson's checks, boiled down to a single verdict. */
function wordResult(lessonId: string, word: string, heard: string[]) {
  const judged = judgeWord(word, heard, lessonId);
  const habit = judged.find((j) => j.res.verdict === "habit");
  const off = judged.find((j) => j.res.verdict === "off");
  const verdict: Verdict = habit ? "habit" : off ? "off" : "good";
  return { judged, habit, off, verdict };
}

/** Every scored attempt feeds the review list: a habit brings the word back on a later day. */
function noteAttempt(lessonId: string, word: string, verdict: Verdict, habit?: string) {
  if (!profile) return;
  saveProfile({ ...profile, review: recordAttempt(profile.review, lessonId, word, verdict, habit) });
}

function speakFeedback(verdict: Verdict, goodSym: string, habit?: string) {
  // spoken feedback, kept short so it doesn't slow practice down
  if (verdict === "good") void coachSays(lines.good(goodSym), "happy");
  else if (verdict === "habit") void coachSays(lines.habit(habit ?? ""), "curious");
  else void coachSays(lines.unclear(), "curious");
}

function addResult(results: HTMLElement, verdict: Verdict, msg: string, heard: string[]) {
  results.prepend(h("div", { class: `result ${verdict === "good" ? "good" : verdict === "habit" ? "bad" : "mid"}` }, h("span", {}, msg), h("span", { class: "ipa-tag" }, `heard /${heard.join("")}/`)));
  while (results.children.length > 5) results.lastChild?.remove();
}

function scoredCard() {
  const status = h("p", { class: "note" });
  const results = h("div", { class: "results" });
  const words = lesson.words.filter((w) => judgeWord(w, []).length > 0);

  const gate = engineGate((ready) => {
    status.textContent = ready ? "Press a word, say it, then pause. It's checked sound by sound." : "";
  });

  const say = async (word: string, btn: HTMLButtonElement) => {
    const heard = await hear(btn, status, `Say "${word}"…`, { maxSeconds: 4, silenceToStop: 0.7 });
    if (!heard) return;
    const { judged, habit, off, verdict } = wordResult(lesson.id, word, heard);
    noteAttempt(lesson.id, word, verdict, habit?.res.habit);
    bumpToday((t) => {
      t.speakTries++;
      if (verdict === "good") t.speakGood++;
    });
    let msg: string;
    if (verdict === "good") msg = `"${word}": a clean ${accentInfo().name} ${judged.map((j) => `/${j.sym}/`).join(" and ")}`;
    else if (habit) msg = `"${word}": you said ${habit.res.habit}. The mouth shows what you did, and the green outline is the target. It comes back for review tomorrow.`;
    else msg = `"${word}": the /${off?.sym}/ didn't come out clearly. Try it again, slower.`;
    addResult(results, verdict, msg, heard);
    status.textContent = "Press a word to go again.";
    if (habit) showWhatYouSaid(habit.res.heard, habit.sym, habit.res.habit ?? "");
    speakFeedback(verdict, judged[0]?.sym ?? "", habit?.res.habit);
    renderReviewCard();
  };

  return card("Say it · scored", "",
    gate,
    status,
    h("div", { class: "chips" }, ...words.map((w) => {
      const b = h("button", { class: "chip say" }, icons.mic(), w) as HTMLButtonElement;
      b.onclick = () => void say(w, b);
      return b;
    })),
    results);
}

/** The day's sound in connected speech: one sentence, judged on its focus words. */
function sentenceCard(item: TestItem) {
  const status = h("p", { class: "note" });
  const results = h("div", { class: "results" });
  const marks = h("div", { class: "chips word-marks" });
  const focus = [...new Set(item.checks.map((c) => c.word))];

  const gate = engineGate((ready) => {
    status.textContent = ready ? "Say the whole sentence at your normal speed, then pause." : "";
  });

  const listen = h("button", { class: "btn" }, icons.listen(), "Hear it");
  listen.onclick = () => void speak(item.text, 0.85);
  const shadow = shadowing(item.text);
  const sayBtn = h("button", { class: "btn primary say" }, icons.mic(), "Say it") as HTMLButtonElement;
  sayBtn.onclick = async () => {
    const heard = await hear(sayBtn, status, "Listening… say the sentence, then pause.", { maxSeconds: 9, silenceToStop: 1.1 }, shadow.keep);
    if (!heard) return;
    const judged = judgeItem(item, heard);
    // one verdict per focus word: a habit outweighs an unclear sound, which outweighs a clean one
    const perWord = focus.map((word) => {
      const mine = judged.filter((j) => j.word === word);
      const habit = mine.find((j) => j.verdict === "habit");
      const verdict: Verdict = habit ? "habit" : mine.some((j) => j.verdict === "off") ? "off" : "good";
      return { word, verdict, habit };
    });
    const habits = perWord.filter((w) => w.verdict === "habit");
    const unclear = perWord.filter((w) => w.verdict === "off");
    const verdict: Verdict = habits.length ? "habit" : unclear.length ? "off" : "good";

    if (profile) {
      let review = profile.review;
      for (const w of perWord) review = recordAttempt(review, lesson.id, w.word, w.verdict, w.habit?.habit);
      saveProfile({ ...profile, review });
    }
    bumpToday((t) => (t.sentenceTries = (t.sentenceTries ?? 0) + 1));

    marks.replaceChildren(...perWord.map((w) =>
      h("span", { class: `chip static mark ${w.verdict === "good" ? "good" : w.verdict === "habit" ? "bad" : "mid"}` }, w.verdict === "good" ? icons.check() : null, w.word)));
    let msg: string;
    if (verdict === "good") msg = `All ${focus.length} words clean, in a full sentence.`;
    else if (habits.length) msg = `In "${habits[0].word}" you said ${habits[0].habit?.habit}.${habits.length > 1 ? ` Also in ${habits.slice(1).map((w) => `"${w.word}"`).join(", ")}.` : ""} ${habits.length > 1 ? "They come" : "It comes"} back for review tomorrow.`;
    else msg = `${unclear.map((w) => `"${w.word}"`).join(", ")} didn't come out clearly. Try once more, a little slower.`;
    addResult(results, verdict, msg, heard);
    status.textContent = "Press Hear both to compare your rhythm with the model, or Say it to go again.";
    const first = habits[0]?.habit;
    if (first) showWhatYouSaid(first.heard, first.sym, first.habit ?? "");
    speakFeedback(verdict, item.checks[0]?.sym ?? "", first?.habit);
    renderReviewCard();
  };

  return card("Now in a sentence", "",
    gate,
    h("p", { class: "sentence" }, item.text),
    h("div", { class: "row" }, listen, sayBtn, shadow.both),
    status, marks, results);
}

/** The sentence for sounds the speech model can't judge: record, then compare with the model by ear. */
function sentenceByEarCard(text: string) {
  const status = h("p", { class: "note" }, "Listen first. Then say the sentence, pause, and compare the two by ear.");
  const listen = h("button", { class: "btn" }, icons.listen(), "Hear it");
  listen.onclick = () => void speak(text, 0.85);
  const shadow = shadowing(text);
  const sayBtn = h("button", { class: "btn primary say" }, icons.mic(), "Say it") as HTMLButtonElement;
  sayBtn.onclick = async () => {
    const take = await capture(sayBtn, status, "Listening… say the sentence, then pause.", { maxSeconds: 9, silenceToStop: 1.1 });
    if (!take) return;
    shadow.keep(take);
    bumpToday((t) => (t.sentenceTries = (t.sentenceTries ?? 0) + 1));
    status.textContent = "Here is the model, then you.";
    shadow.both.click();
  };
  return card("Now in a sentence", "",
    h("p", { class: "sentence" }, text),
    h("div", { class: "row" }, listen, sayBtn, shadow.both),
    status,
    h("p", { class: "note" }, "This sound can't be scored automatically yet, so compare by ear."));
}

// ------------------------------------------------------------------ review

let reviewSlot: HTMLElement | null = null;
let reviewUi: { chips: HTMLElement; status: HTMLElement; results: HTMLElement } | null = null;

/** Today's review words that can still be scored in the current accent. */
function reviewsDue(): ReviewItem[] {
  return dueReviews(profile?.review).filter((r) => LEXICON[r.word] && judgeWord(r.word, [], r.lesson).length > 0);
}

/** Words said with a habit on an earlier day, back until they're clean three days running. */
function renderReviewCard() {
  if (!reviewSlot) return;
  const due = reviewsDue();
  if (!reviewUi) {
    if (!due.length) return;
    const status = h("p", { class: "note" });
    const chips = h("div", { class: "chips" });
    const results = h("div", { class: "results" });
    const gate = engineGate((ready) => {
      if (ready && !status.textContent) status.textContent = "You slipped on these before. Say each one cleanly.";
    });
    reviewUi = { chips, status, results };
    reviewSlot.append(card("Review", "review-card", gate, status, chips, results));
  }
  const ui = reviewUi;
  ui.chips.replaceChildren(...due.map((r) => {
    const title = LESSONS.find((l) => l.id === r.lesson)?.title ?? "";
    const b = h("button", { class: "chip say", title: `${title}${r.habit ? `: last time, ${r.habit}` : ""}` }, icons.mic(), r.word) as HTMLButtonElement;
    b.onclick = async () => {
      const heard = await hear(b, ui.status, `Say "${r.word}"…`, { maxSeconds: 4, silenceToStop: 0.7 });
      if (!heard) return;
      const { habit, off, verdict } = wordResult(r.lesson, r.word, heard);
      noteAttempt(r.lesson, r.word, verdict, habit?.res.habit);
      const left = REVIEW_CLEAN - r.clean - 1;
      let msg: string;
      if (verdict === "good") msg = left > 0 ? `"${r.word}": clean. ${left} more clean day${left === 1 ? "" : "s"} and it's yours.` : `"${r.word}": clean three days running. Done with this one.`;
      else if (habit) msg = `"${r.word}": ${habit.res.habit} again. It comes back tomorrow.`;
      else msg = `"${r.word}": the /${off?.sym}/ didn't come out clearly. Try it again, slower.`;
      addResult(ui.results, verdict, msg, heard);
      ui.status.textContent = verdict === "off" ? "Press the word to try again." : "Press the next word.";
      if (habit && r.lesson === lesson.id) showWhatYouSaid(habit.res.heard, habit.sym, habit.res.habit ?? "");
      speakFeedback(verdict, habit?.sym ?? "", habit?.res.habit);
      renderReviewCard();
      renderList();
    };
    return b;
  }));
  ui.status.textContent = due.length ? ui.status.textContent : "All reviewed for today.";
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
  const model = h("button", { class: "btn" }, icons.listen(), `${accentInfo().name} model`);
  const word = lesson.words[0];
  let url: string | null = null;
  let stopper: { stop: () => Promise<string> } | null = null;
  rec.onclick = async () => {
    if (stopper) {
      if (url) URL.revokeObjectURL(url); // free the previous take
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
    accent: accent(),
    onAccent: (a) => {
      applyAccent(a);
      openLesson(LESSONS.find((l) => l.id === lesson.id) ?? LESSONS[0]);
    },
    onCancel: closeOverlay,
    onSkip: () => {
      closeOverlay();
      if (!profile) saveProfile(newProfile(null, true, accent()));
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
          const p = profile && profile.course.length ? replan(profile, a) : newProfile(a, false, accent());
          saveProfile(p);
          const first = p.course[p.day];
          const firstName = first?.kind === "lesson" ? LESSONS.find((l) => l.id === first.lesson)?.title : null;
          void coachSays(
            lines.report(a.overall, previous, firstName ?? undefined),
            a.overall >= 75 ? "happy" : "curious",
          );
          showReport({
            assessment: a,
            course: p.course.slice(p.day),
            previous,
            history: p.history,
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

function setupCoach() {
  const buttons = $("coachButtons");
  const explain = h("button", { class: "btn small" }, "Explain this sound");
  explain.onclick = () => void coachSays(lines.explain(lesson), "curious");
  const voiceBtn = h("button", { class: "btn small icon-only" }) as HTMLButtonElement;
  const paint = () => {
    const on = coachVoiceOn();
    voiceBtn.replaceChildren(on ? icons.listen() : icons.muted());
    voiceBtn.title = on ? "Coach voice on (words always play)" : "Coach voice off (captions only)";
    voiceBtn.setAttribute("aria-label", voiceBtn.title);
  };
  voiceBtn.onclick = () => {
    setCoachVoice(!coachVoiceOn());
    paint();
  };
  paint();
  buttons.append(explain, voiceBtn);
  void mountCoach($("coachStage"), $("coachCaption")).then((ok) => {
    if (!ok) $("coachStage").classList.add("missing");
  });
}

async function boot() {
  setupCoach();
  // The server's copy wins unless ours is the same revision with changes it never got
  // (made while the server was off). Revisions, not clocks, say which is newer.
  const server = await api.getProfile();
  if (server) {
    const unsent = profile && (profile.rev ?? 0) === (server.rev ?? 0) && profile.updatedAt > server.updatedAt;
    if (unsent && profile) {
      progress.merge(server.practice);
      api.profileBasedOn(server.rev ?? 0);
      saveProfile(profile);
    } else {
      adoptServer(server);
    }
  }
  window.addEventListener("focus", () => void refreshFromServer());
  document.addEventListener("visibilitychange", () => void refreshFromServer());
  let stored: Accent | null = null;
  try {
    stored = localStorage.getItem("accentCoach.accent") as Accent | null;
  } catch {
    /* ignore */
  }
  applyAccent(profile?.accent ?? stored ?? "us");
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

// phone build: work offline after the first visit, and let phones install it
if (api.STATIC && "serviceWorker" in navigator && !import.meta.env.DEV) {
  void navigator.serviceWorker.register("./sw.js").catch(() => undefined);
}

// test hook (this computer only): lets the browser tests drive the on-device speech model
void import("./listen/engine").then(({ engine, isLocalTest }) => {
  if (isLocalTest()) (window as unknown as { __engine: unknown }).__engine = engine;
});
