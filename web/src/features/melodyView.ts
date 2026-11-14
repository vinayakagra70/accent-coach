/**
 * Draws the melody of a sentence: the model's voice and the learner's, as two
 * lines on one small chart, each measured from that speaker's own middle pitch
 * and stretched to the same width. It is a picture to look at and copy.
 * There is no score here on purpose: judging melody by machine was tried and
 * was not reliable.
 */
import "./melody.css";
import { STATIC } from "../api";
import { accent, accentInfo } from "../content/accent";
import { clip, SPEEDS, speedBucket } from "../speech/clips";
import { h } from "../ui/dom";
import { contour } from "./pitch";

/** Everything is brought to the recorder's rate, so one sampleRate fits both voices. */
export const MELODY_RATE = 16000;
const POINTS = 160;
const CAPTION = "Where the voice rises and falls";

type Line = (number | null)[] | null;

// ------------------------------------------------------------------ audio in

let decoder: BaseAudioContext | null = null;

function decodeContext(): BaseAudioContext {
  if (decoder) return decoder;
  try {
    // an offline context decodes straight to the rate we want, and needs no tap to start
    decoder = new OfflineAudioContext(1, 1, MELODY_RATE);
  } catch {
    decoder = new AudioContext();
  }
  return decoder;
}

function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const ratio = from / to;
  const n = Math.floor(x.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.max(a + 1, Math.min(x.length, Math.floor((i + 1) * ratio)));
    let s = 0;
    for (let j = a; j < b; j++) s += x[j] ?? 0;
    out[i] = s / (b - a);
  }
  return out;
}

/**
 * Any audio the browser can play (an MP3 clip, the server's WAV, a recording)
 * as mono samples at `rate`. Takes a URL, a Blob or the bytes. Null when it
 * can't be fetched or decoded.
 */
export async function decodeToMono(source: string | Blob | ArrayBuffer, rate = MELODY_RATE): Promise<Float32Array | null> {
  try {
    let bytes: ArrayBuffer;
    if (typeof source === "string") {
      const r = await fetch(source);
      if (!r.ok) return null;
      bytes = await r.arrayBuffer();
    } else if (source instanceof Blob) {
      bytes = await source.arrayBuffer();
    } else {
      bytes = source.slice(0); // decodeAudioData empties the buffer it is given
    }
    const buf = await decodeContext().decodeAudioData(bytes);
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < mono.length; i++) mono[i] += ch[i] / buf.numberOfChannels;
    }
    return resample(mono, buf.sampleRate, rate);
  } catch {
    return null;
  }
}

const modelCache = new Map<string, Promise<Float32Array | null>>();

/**
 * The model voice saying `text`, as samples: the same audio speak() plays
 * (the shipped clip, else the local Kokoro server). Null when neither is
 * there, which is when the app falls back to the browser's own voice.
 * `rate` has speak()'s meaning (0.7 slow … 0.9 natural).
 */
export function modelSamples(text: string, rate = 0.85): Promise<Float32Array | null> {
  const bucket = speedBucket(Math.max(0.7, Math.min(1.1, rate / 0.9)));
  const key = `${accent()}|${bucket}|${text.trim()}`;
  let hit = modelCache.get(key);
  if (!hit) {
    hit = (async () => {
      let bytes = await clip(accent(), "word", bucket, text);
      if (!bytes && !STATIC) {
        try {
          const r = await fetch("/api/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, voice: accentInfo().voice, lang: accentInfo().lang, speed: SPEEDS[bucket] }),
          });
          if (r.ok) bytes = await r.arrayBuffer();
        } catch {
          /* no server: no model line */
        }
      }
      return bytes ? decodeToMono(bytes) : null;
    })();
    modelCache.set(key, hit);
    // a miss may be the server still loading: let the next try ask again
    void hit.then((v) => {
      if (!v) modelCache.delete(key);
    });
    if (modelCache.size > 24) modelCache.delete(modelCache.keys().next().value as string);
  }
  return hit;
}

// ------------------------------------------------------------------ drawing

/** Top and bottom of the chart in semitones: both lines fit, never tighter than ±4, never wider than ±12. */
export function melodyRange(lines: Line[]): { lo: number; hi: number } {
  let lo = -4;
  let hi = 4;
  for (const line of lines) {
    for (const v of line ?? []) {
      if (v === null) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  return { lo: Math.max(-12, lo - 1), hi: Math.min(12, hi + 1) };
}

function draw(canvas: HTMLCanvasElement, model: Line, learner: Line) {
  const css = getComputedStyle(canvas);
  const w = canvas.clientWidth || 320;
  const ht = canvas.clientHeight || 128;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(ht * dpr);
  const g = canvas.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, ht);

  const colour = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const pad = { x: 6, top: 14, bottom: 14 };
  const { lo, hi } = melodyRange([model, learner]);
  const x = (i: number) => pad.x + (i / (POINTS - 1)) * (w - 2 * pad.x);
  const y = (st: number) => pad.top + (1 - (Math.max(lo, Math.min(hi, st)) - lo) / (hi - lo)) * (ht - pad.top - pad.bottom);

  // the speaker's own middle pitch
  g.strokeStyle = colour("--line-strong", "rgba(237,237,237,0.14)");
  g.lineWidth = 1;
  g.setLineDash([3, 4]);
  g.beginPath();
  g.moveTo(pad.x, Math.round(y(0)) + 0.5);
  g.lineTo(w - pad.x, Math.round(y(0)) + 0.5);
  g.stroke();
  g.setLineDash([]);

  g.fillStyle = colour("--muted", "#85858b");
  g.font = `11px ${css.fontFamily || "system-ui, sans-serif"}`;
  g.textBaseline = "top";
  g.fillText("higher", pad.x, 0);
  g.textBaseline = "bottom";
  g.fillText("lower", pad.x, ht);

  const stroke = (line: Line, col: string, width: number) => {
    if (!line) return;
    g.strokeStyle = col;
    g.fillStyle = col;
    g.lineWidth = width;
    g.lineJoin = "round";
    g.lineCap = "round";
    for (let i = 0; i < line.length; ) {
      if (line[i] === null) {
        i++;
        continue;
      }
      let j = i;
      g.beginPath();
      g.moveTo(x(i), y(line[i]!));
      while (j + 1 < line.length && line[j + 1] !== null) {
        j++;
        g.lineTo(x(j), y(line[j]!));
      }
      if (j === i) g.arc(x(i), y(line[i]!), width / 2, 0, 2 * Math.PI), g.fill();
      else g.stroke();
      i = j + 1;
    }
  };
  // the model underneath and a little heavier, the learner's line on top
  stroke(model, colour("--melody-model", "") || colour("--accent", "#8db87a"), 3);
  stroke(learner, colour("--melody-you", "") || colour("--air", "#7dd3fc"), 2);
}

const observers = new WeakMap<HTMLElement, ResizeObserver>();

/**
 * Fill `container` with the melody chart. Either voice may be missing (null,
 * or nothing voiced in it): the other is still drawn and a line says why.
 * Both must be at `sampleRate` (decodeToMono and the recorder both give 16 kHz).
 * Safe to call again on the same container.
 */
export function renderMelody(container: HTMLElement, model: Float32Array | null, learner: Float32Array | null, sampleRate: number = MELODY_RATE): void {
  observers.get(container)?.disconnect();
  observers.delete(container);

  const m = model ? contour(model, sampleRate, POINTS) : null;
  const l = learner ? contour(learner, sampleRate, POINTS) : null;
  if (!m && !l) {
    container.replaceChildren();
    container.hidden = true;
    return;
  }
  container.hidden = false;

  const note = !m
    ? "The model's line isn't available for this one, so only yours is shown."
    : !l
      ? learner
        ? "Your voice was too quiet to draw. Try once more, a little louder."
        : "Say it to see your line next to the model's."
      : "Each line is measured from that voice's own middle, so a low and a high voice can be compared. Gaps are pauses and voiceless sounds.";
  const label = m && l ? "Pitch of the model's voice and of yours across the sentence." : m ? "Pitch of the model's voice across the sentence." : "Pitch of your voice across the sentence.";

  const canvas = h("canvas", { class: "melody-canvas", role: "img", "aria-label": label });
  container.classList.add("melody");
  container.replaceChildren(
    h("div", { class: "melody-head" },
      h("p", { class: "melody-caption" }, CAPTION),
      h("ul", { class: "melody-legend" },
        h("li", { class: m ? "model" : "model off" }, "Model"),
        h("li", { class: l ? "you" : "you off" }, "You"))),
    canvas,
    h("p", { class: "melody-note" }, note),
  );

  draw(canvas, m, l);
  if (typeof ResizeObserver !== "undefined") {
    let lastW = canvas.clientWidth;
    const ro = new ResizeObserver(() => {
      if (!canvas.isConnected || canvas.clientWidth === lastW) return;
      lastW = canvas.clientWidth;
      draw(canvas, m, l);
    });
    ro.observe(canvas);
    observers.set(container, ro);
  }
}

/**
 * The one call the shadowing step needs: fetch the model's audio for `text`,
 * and draw it with the learner's take (16 kHz samples from the recorder).
 * Draws the learner's line straight away, then adds the model's when it arrives.
 */
export async function showMelody(container: HTMLElement, text: string, learner: Float32Array | null, rate = 0.85): Promise<void> {
  const stamp = String(Date.now() + Math.random());
  container.dataset.melody = stamp;
  if (learner) renderMelody(container, null, learner);
  const model = await modelSamples(text, rate);
  if (container.dataset.melody !== stamp) return; // a newer take or a reset came in meanwhile
  renderMelody(container, model, learner);
}

/** Empty and hide the chart (the sentence changed). */
export function clearMelody(container: HTMLElement): void {
  container.dataset.melody = "";
  observers.get(container)?.disconnect();
  observers.delete(container);
  container.replaceChildren();
  container.hidden = true;
}
