/**
 * Speaking pace for a recorded sentence: how long the speech lasted, how much
 * of that was pauses, and words per minute. Fast speech with few pauses costs
 * more clarity than any single sound, so this is shown next to the word marks.
 *
 * Everything is measured from frame energy, with a threshold set from the
 * recording itself (its own quiet level and its own loud level), so it works
 * on a noisy laptop mic and on a clean model clip alike.
 */
import { h } from "../ui/dom";
import "./pace.css";

export interface Pause {
  /** Seconds from the start of the recording. */
  start: number;
  seconds: number;
}

export interface PaceResult {
  /** False when nothing clearly louder than the room was found. */
  speech: boolean;
  wordCount: number;
  /** Where speech starts and ends in the recording, in seconds. */
  start: number;
  end: number;
  /** First sound to last sound, pauses included. */
  speechSeconds: number;
  /** Speech time without the internal pauses. */
  articulationSeconds: number;
  pauses: Pause[];
  pauseCount: number;
  pauseSeconds: number;
  /** Words per minute over the whole utterance, pauses included. 0 when there was no speech. */
  wpm: number;
  /** Words per minute while actually talking (pauses taken out). */
  articulationWpm: number;
}

export type PaceBand = "slow" | "comfortable" | "fast" | "short";

export interface PaceVerdict {
  band: PaceBand;
  /** One word for the gauge and the readout: slow, comfortable, fast, or "too short to tell". */
  label: string;
  /** One short plain sentence. */
  text: string;
  /** Against the model clip, when one was given and both were long enough: "about as fast as the model". */
  vsModel?: string;
}

/** Conversational speech sits in this band (words per minute, pauses included). */
export const COMFORTABLE_MIN = 130;
export const COMFORTABLE_MAX = 170;
/** Below either of these a words-per-minute figure is noise. */
export const MIN_WORDS = 4;
export const MIN_SECONDS = 1.2;

const FRAME_SECONDS = 0.01;
/** A silence this long inside the utterance is a pause; shorter ones are stop closures and belong to the speech. */
const MIN_PAUSE_SECONDS = 0.2;
/** Louder stretches shorter than this are clicks and bumps, not speech. */
const MIN_BURST_SECONDS = 0.05;

/** Words in a sentence, the way a listener would count them ("don't" is one, "well-known" is one). */
export function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) ?? []).length;
}

function emptyResult(wordCount: number): PaceResult {
  return {
    speech: false, wordCount, start: 0, end: 0, speechSeconds: 0, articulationSeconds: 0,
    pauses: [], pauseCount: 0, pauseSeconds: 0, wpm: 0, articulationWpm: 0,
  };
}

function percentile(sorted: Float32Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

export function measurePace(samples: Float32Array, sampleRate: number, wordCount: number): PaceResult {
  const frameLen = Math.max(1, Math.round(sampleRate * FRAME_SECONDS));
  const n = Math.floor(samples.length / frameLen);
  const dt = frameLen / sampleRate;
  if (n < 10) return emptyResult(wordCount);

  // energy per 10 ms frame, in dB
  const db = new Float32Array(n);
  for (let f = 0; f < n; f++) {
    let s = 0;
    const o = f * frameLen;
    for (let i = 0; i < frameLen; i++) s += samples[o + i] * samples[o + i];
    db[f] = 10 * Math.log10(s / frameLen + 1e-10);
  }

  // adaptive threshold: a little above the room, but never more than 30 dB under
  // the loud parts (so digital silence doesn't make every breath count as speech)
  const sorted = Float32Array.from(db).sort();
  // a low percentile, so a tightly trimmed model clip (very little silence) still shows its quiet level
  const floor = percentile(sorted, 0.03);
  const peak = percentile(sorted, 0.97);
  if (peak < -55 || peak - floor < 10) return emptyResult(wordCount);
  // the cap covers a clip with no silence in it, where the "room" level is really quiet speech
  const threshold = Math.min(Math.max(floor + 8, peak - 30), peak - 15);

  const loud = new Uint8Array(n);
  for (let f = 0; f < n; f++) loud[f] = db[f] > threshold ? 1 : 0;

  // drop clicks: loud runs too short to be a sound
  const minBurst = Math.round(MIN_BURST_SECONDS / dt);
  for (let f = 0; f < n; ) {
    if (!loud[f]) {
      f++;
      continue;
    }
    let e = f;
    while (e < n && loud[e]) e++;
    if (e - f < minBurst) loud.fill(0, f, e);
    f = e;
  }

  let first = 0;
  while (first < n && !loud[first]) first++;
  if (first === n) return emptyResult(wordCount);
  let last = n - 1;
  while (!loud[last]) last--;

  // internal silences: long ones are pauses, short ones stay part of the speech
  const minPause = Math.round(MIN_PAUSE_SECONDS / dt);
  const pauses: Pause[] = [];
  for (let f = first; f <= last; ) {
    if (loud[f]) {
      f++;
      continue;
    }
    let e = f;
    while (!loud[e]) e++; // stops at `last` at the latest, which is loud
    if (e - f >= minPause) pauses.push({ start: f * dt, seconds: (e - f) * dt });
    f = e;
  }

  const speechSeconds = (last - first + 1) * dt;
  const pauseSeconds = pauses.reduce((a, p) => a + p.seconds, 0);
  const articulationSeconds = speechSeconds - pauseSeconds;
  return {
    speech: true,
    wordCount,
    start: first * dt,
    end: (last + 1) * dt,
    speechSeconds,
    articulationSeconds,
    pauses,
    pauseCount: pauses.length,
    pauseSeconds,
    wpm: speechSeconds > 0 ? (wordCount / speechSeconds) * 60 : 0,
    articulationWpm: articulationSeconds > 0 ? (wordCount / articulationSeconds) * 60 : 0,
  };
}

/** True when the utterance is long enough for words per minute to mean something. */
export function paceMeasurable(r: PaceResult): boolean {
  return r.speech && r.wordCount >= MIN_WORDS && r.speechSeconds >= MIN_SECONDS;
}

/** "a third faster than the model", from the two rates. */
export function compareToModel(wpm: number, modelWpm: number): string {
  const ratio = wpm / modelWpm;
  const d = Math.abs(ratio - 1);
  if (d < 0.12) return "about as fast as the model";
  if (ratio > 1) {
    if (d < 0.2) return "a little faster than the model";
    if (d < 0.29) return "a quarter faster than the model";
    if (d < 0.42) return "a third faster than the model";
    if (d < 0.75) return "half again as fast as the model";
    return "about twice as fast as the model";
  }
  if (d < 0.2) return "a little slower than the model";
  if (d < 0.29) return "a quarter slower than the model";
  if (d < 0.42) return "a third slower than the model";
  return "about half as fast as the model";
}

/**
 * Slow, comfortable or fast, with one plain sentence. Pass the model clip's
 * measurement (same sentence, so the same word count) to also get `vsModel`.
 * A bare words-per-minute number works too when that is all there is.
 */
export function paceVerdict(result: PaceResult | number, model?: PaceResult): PaceVerdict {
  const r = typeof result === "number" ? null : result;
  if (r && !paceMeasurable(r)) {
    return {
      band: "short",
      label: "too short to tell",
      text: r.speech ? "Too short to tell your pace. Try a full sentence." : "No speech found in that recording.",
    };
  }
  const wpm = r ? r.wpm : (result as number);
  const vsModel = r && model && paceMeasurable(model) ? compareToModel(r.wpm, model.wpm) : undefined;
  if (wpm < COMFORTABLE_MIN) {
    return { band: "slow", label: "slow", text: "Slower than everyday talk. Good for practice; speed up once the sounds are clean.", vsModel };
  }
  if (wpm <= COMFORTABLE_MAX) {
    return { band: "comfortable", label: "comfortable", text: "An easy pace to follow.", vsModel };
  }
  const noPauses = r !== null && r.pauseCount === 0 && r.wordCount >= 8;
  return {
    band: "fast",
    label: "fast",
    text: noPauses ? "Fast, with no pauses. Slow down and add a short pause between ideas." : "Fast. Slow down a little so each word lands.",
    vsModel,
  };
}

// the gauge runs from 80 to 220 words a minute; the comfortable band sits in the middle
const GAUGE_MIN = 80;
const GAUGE_MAX = 220;
const gaugePct = (wpm: number) => Math.max(0, Math.min(100, ((wpm - GAUGE_MIN) / (GAUGE_MAX - GAUGE_MIN)) * 100));

/** One line of text and a small slow / comfortable / fast gauge. Replaces whatever was in `container`. */
export function renderPace(container: HTMLElement, result: PaceResult, modelResult?: PaceResult): void {
  const v = paceVerdict(result, modelResult);
  container.classList.add("pace");
  container.dataset.band = v.band;
  if (v.band === "short") {
    container.replaceChildren(h("p", { class: "pace-line" }, h("span", { class: "pace-key" }, "Pace"), " ", v.text));
    return;
  }
  const wpm = Math.round(result.wpm);
  const pauses = result.pauseCount === 0 ? "no pauses" : result.pauseCount === 1 ? "1 pause" : `${result.pauseCount} pauses`;
  const line = h("p", { class: "pace-line" },
    h("span", { class: "pace-key" }, "Pace"), " ",
    h("strong", { class: "pace-num" }, `${wpm} words a minute`),
    `, ${pauses}${v.vsModel ? `, ${v.vsModel}` : ""}. `,
    h("span", { class: "pace-tip" }, v.text));

  const from = gaugePct(COMFORTABLE_MIN);
  const to = gaugePct(COMFORTABLE_MAX);
  const track = h("div", { class: "pace-track", style: `--from:${from}%;--to:${to}%;--at:${gaugePct(result.wpm)}%` },
    h("span", { class: "pace-zone" }),
    h("span", { class: "pace-marker" }));
  const label = (band: PaceBand, text: string) => h("span", v.band === band ? { class: "on" } : {}, text);
  const gauge = h("div", { class: "pace-gauge", role: "img", "aria-label": `Pace gauge: ${wpm} words a minute, ${v.label}. Comfortable is ${COMFORTABLE_MIN} to ${COMFORTABLE_MAX}.` },
    track,
    h("div", { class: "pace-labels", "aria-hidden": "true" }, label("slow", "slow"), label("comfortable", "comfortable"), label("fast", "fast")));
  container.replaceChildren(line, gauge);
}
