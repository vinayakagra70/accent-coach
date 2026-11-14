import { accent, accentInfo } from "./content/accent";
import { STATIC } from "./api";
import { clip, SPEEDS, speedBucket, splitSentences, type Speed } from "./speech/clips";
import type { Nova } from "./nova/core/Nova";

/**
 * The coach: NOVA's Live2D character with a Kokoro voice from the local server.
 * Everything spoken in the app goes through say(), so model words lip-sync too.
 * If the character or the voice can't load, the app still works: words fall
 * back to the browser's own voice.
 *
 * The character engine is loaded on demand (import() in mountCoach), never at
 * the top of the file: its Live2D library throws while loading when the Cubism
 * runtime (live2dcubismcore.min.js, not in git) is absent, and as a normal
 * import that took the whole app down with it. That is how the hosted site,
 * which Vercel builds from git, came to show an empty page.
 */

/** Your recoloured Hiyori if it's installed, else Live2D's original (what setup.ps1 downloads for others). */
const MODELS = ["models/hiyori-recolour/Hiyori.model3.json", "models/hiyori/Hiyori.model3.json"];

async function firstModel(): Promise<string> {
  for (const url of MODELS) {
    try {
      const r = await fetch(url, { method: "HEAD" });
      // the dev server answers a missing file with index.html, so check the type too
      if (r.ok && !(r.headers.get("content-type") ?? "").includes("text/html")) return url;
    } catch {
      /* try the next one */
    }
  }
  return MODELS[0];
}

let nova: Nova | null = null;
let captionEl: HTMLElement | null = null;
let captionTimer = 0;
let kokoroOk: boolean | null = null; // null = not tried yet
let seq = 0;

export type Mood = "happy" | "sad" | "curious" | "surprised" | null;

export function coachVoiceOn(): boolean {
  try {
    return localStorage.getItem("accentCoach.coachVoice") !== "off";
  } catch {
    return true;
  }
}

export function setCoachVoice(on: boolean) {
  try {
    localStorage.setItem("accentCoach.coachVoice", on ? "on" : "off");
  } catch {
    /* ignore */
  }
  if (!on) nova?.stopSpeaking("idle");
}

export async function mountCoach(host: HTMLElement, caption: HTMLElement): Promise<boolean> {
  captionEl = caption;
  try {
    const [{ Nova }, { idleGlances }, { tapReactions }] = await Promise.all([
      import("./nova/core/Nova"),
      import("./nova/plugins/idleGlances"),
      import("./nova/plugins/tapReactions"),
    ]);
    nova = await Nova.create({
      host,
      config: {
        model: { url: await firstModel(), zoom: 2.3, anchorY: 0.98 },
        input: { talkMode: "toggle", autoStates: false },
      },
    });
    nova.use(tapReactions()).use(idleGlances());
    nova.events.on("error", ({ error, context }) => console.warn(`[coach] ${context}`, error));
    return true;
  } catch (error) {
    console.warn("[coach] character not loaded", error);
    nova = null;
    return false;
  }
}

function showCaption(text: string | null, ms = 0) {
  if (!captionEl) return;
  window.clearTimeout(captionTimer);
  captionEl.textContent = text ?? "";
  if (text && ms) captionTimer = window.setTimeout(() => captionEl && (captionEl.textContent = ""), ms);
}

/** Pre-rendered clip first; then the laptop's live Kokoro (not in the phone build). */
async function voiceFor(text: string, kind: "word" | "line", speed: number): Promise<ArrayBuffer | null> {
  const bucket: Speed = kind === "line" ? "normal" : speedBucket(speed);
  const pre = await clip(accent(), kind, bucket, text);
  if (pre) return pre;
  if (STATIC) return null;
  return kokoro(text, kind === "line" ? 1.0 : SPEEDS[bucket]);
}

async function kokoro(text: string, speed: number): Promise<ArrayBuffer | null> {
  if (kokoroOk === false) return null;
  try {
    const r = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: accentInfo().voice, lang: accentInfo().lang, speed }),
    });
    if (!r.ok) {
      // 503 = still loading: try again next time; anything else: give up for this session
      if (r.status !== 503) kokoroOk = false;
      return null;
    }
    kokoroOk = true;
    return await r.arrayBuffer();
  } catch {
    kokoroOk = false;
    return null;
  }
}

function browserSay(text: string, rate: number): Promise<void> {
  return new Promise((resolve) => {
    if (!("speechSynthesis" in window)) return resolve();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const lang = accentInfo().lang === "en-gb" ? "en-GB" : "en-US";
    const v = speechSynthesis.getVoices().find((x) => x.lang.replace("_", "-") === lang);
    if (v) u.voice = v;
    u.lang = lang;
    u.rate = rate;
    u.onend = u.onerror = () => resolve();
    speechSynthesis.speak(u);
  });
}

async function playBuffer(buf: ArrayBuffer): Promise<void> {
  if (nova) {
    await nova.audio.resume().catch(() => undefined);
    await nova.speak(buf, { after: "idle" });
    return;
  }
  const url = URL.createObjectURL(new Blob([buf]));
  const a = new Audio(url);
  await new Promise<void>((res) => {
    a.onended = a.onerror = () => res();
    void a.play().catch(() => res());
  });
  URL.revokeObjectURL(url);
}

/**
 * Speak a model word or phrase (always on: it's the lesson content).
 * `speed` 1 = natural; the lesson's "slow" setting passes ~0.75.
 */
export async function sayWord(text: string, speed = 0.95): Promise<void> {
  const my = ++seq;
  const buf = await voiceFor(text, "word", speed);
  if (my !== seq) return;
  if (buf) return playBuffer(buf);
  return browserSay(text, speed * 0.9);
}

/** Play a sound file shipped with the app (the "Indian habit" example words). False when it's missing or was interrupted. */
export async function playFile(url: string): Promise<boolean> {
  const my = ++seq;
  try {
    const r = await fetch(url);
    if (!r.ok || my !== seq) return false;
    const buf = await r.arrayBuffer();
    if (my !== seq) return false;
    await playBuffer(buf);
    return my === seq;
  } catch {
    return false;
  }
}

/** The coach talking to the learner: a caption always, the voice if it's switched on. */
export async function coachSays(text: string, mood: Mood = null): Promise<void> {
  const my = ++seq;
  if (mood && nova) void nova.expression(mood, { duration: Math.min(6000, 1500 + text.length * 45) });
  showCaption(text, coachVoiceOn() ? 0 : 6000);
  if (!coachVoiceOn()) return;
  // Sentence by sentence: the first one starts in under a second, and the next
  // is synthesized while the current one plays.
  const parts = splitSentences(text);
  let next = voiceFor(parts[0], "line", 1.0);
  for (let i = 0; i < parts.length; i++) {
    const buf = await next;
    if (my !== seq) return;
    if (i + 1 < parts.length) next = voiceFor(parts[i + 1], "line", 1.0);
    if (buf) await playBuffer(buf);
    else if (!STATIC) {
      await browserSay(parts.slice(i).join(" "), 1.0);
      break;
    }
    // phone build: a sentence that wasn't pre-rendered is shown as a caption only
    if (my !== seq) return;
  }
  if (my === seq) showCaption(text, 2500);
}

export function react(mood: Exclude<Mood, null>, ms = 2500) {
  if (nova) void nova.expression(mood, { duration: ms });
}

export function stopTalking() {
  seq++;
  nova?.stopSpeaking("idle");
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
