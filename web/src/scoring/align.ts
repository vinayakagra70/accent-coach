import type { SoundCheck } from "./checks";

/**
 * Compares what the speech model heard with what was expected.
 *
 * The model writes speech as IPA phonemes ("ð ɪ s"). We line the two lists up
 * with a weighted edit distance (similar sounds are cheap to swap), then look
 * at what landed on each sound we care about.
 */

const VOWELS = new Set("a æ ɐ ɑ ɒ ʌ ə ɚ ɜ ɛ e ɪ ᵻ i ɔ o ʊ u ɨ ɯ y ø œ eɪ oʊ aɪ aʊ ɔɪ əʊ".split(" "));

export function normalize(tok: string): string {
  // length, stress, aspiration and (from tonal languages) tone digits don't matter here
  return tok.replace(/[ːˑˈˌʰ0-9]/g, "").replace(/ɡ/g, "g").replace(/ɝ/g, "ɚ").replace(/ɫ/g, "l");
}

/**
 * Normalize a list of model tokens. The model sometimes writes an R-coloured
 * vowel as one token ("ɑːɹ" in "car"); split it so the R can be judged.
 */
export function normalizeAll(tokens: string[]): string[] {
  const out: string[] = [];
  for (const raw of tokens) {
    const t = normalize(raw);
    if (!t) continue;
    if (t.length > 1 && t.endsWith("ɹ")) out.push(t.slice(0, -1), "ɹ");
    else out.push(t);
  }
  return out;
}

export function isVowel(t: string) {
  return VOWELS.has(t);
}

/** Tokens the model writes as one unit, split from an IPA string written without spaces. */
const MULTI = ["eɪ", "oʊ", "aɪ", "aʊ", "ɔɪ", "əʊ", "dʒ", "tʃ", "t̪", "d̪"];

export function tokenize(s: string): string[] {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return normalizeAll(parts);
  const out: string[] = [];
  const str = parts[0] ?? "";
  let i = 0;
  while (i < str.length) {
    const m = MULTI.find((x) => str.startsWith(x, i));
    if (m) {
      out.push(m);
      i += m.length;
      continue;
    }
    let ch = str[i];
    i++;
    // keep combining marks / modifiers with their letter
    while (i < str.length && /[̀-ͯːʰˑ]/.test(str[i])) ch += str[i++];
    out.push(ch);
  }
  return normalizeAll(out);
}

function subCost(a: string, b: string): number {
  if (a === b) return 0;
  const va = isVowel(a);
  const vb = isVowel(b);
  if (va !== vb) return 1.2;
  // same first letter (t / t̪ / tʃ, e / eɪ): very similar
  if (a[0] === b[0]) return 0.3;
  return 0.6;
}

const GAP = 0.7;

export interface AlignedPair {
  /** Index into expected, or -1 for an extra sound the speaker added. */
  exp: number;
  /** Index into heard, or -1 when the expected sound was missing. */
  got: number;
}

export function align(expected: string[], heard: string[]): AlignedPair[] {
  const n = expected.length;
  const m = heard.length;
  const D: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) D[i][0] = i * GAP;
  for (let j = 1; j <= m; j++) D[0][j] = j * GAP;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      D[i][j] = Math.min(
        D[i - 1][j - 1] + subCost(expected[i - 1], heard[j - 1]),
        D[i - 1][j] + GAP,
        D[i][j - 1] + GAP,
      );
    }
  }
  const out: AlignedPair[] = [];
  let i = n;
  let j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && D[i][j] === D[i - 1][j - 1] + subCost(expected[i - 1], heard[j - 1])) {
      out.push({ exp: i - 1, got: j - 1 });
      i--;
      j--;
    } else if (i > 0 && D[i][j] === D[i - 1][j] + GAP) {
      out.push({ exp: i - 1, got: -1 });
      i--;
    } else {
      out.push({ exp: -1, got: j - 1 });
      j--;
    }
  }
  return out.reverse();
}

export type Verdict = "good" | "habit" | "off";

export interface CheckResult {
  verdict: Verdict;
  /** What the model heard in that spot ("∅" if nothing). */
  heard: string;
  /** Plain-language name of the habit, when verdict is "habit". */
  habit?: string;
}

/** Judge the sound at expected[index]. */
export function judge(_expected: string[], heard: string[], pairs: AlignedPair[], index: number, check: SoundCheck): CheckResult {
  const k = pairs.findIndex((p) => p.exp === index);
  const p = pairs[k];
  const got = p && p.got >= 0 ? heard[p.got] : "∅";
  // A sound split in two ("e" + "ɪ" for eɪ, "ə" + "ɹ" for ɚ) still counts.
  const next = pairs[k + 1];
  const joined = next && next.exp === -1 && next.got >= 0 ? got + heard[next.got] : null;
  const nextTok = next && next.exp === -1 && next.got >= 0 ? heard[next.got] : null;

  const accepted = (t: string) => check.accept.includes(t);
  if (accepted(got) || (joined && accepted(joined)) || (got !== "∅" && nextTok && accepted(nextTok) && isVowel(got) && !isVowel(nextTok) && check.accept.includes("ɹ"))) {
    return { verdict: "good", heard: joined && accepted(joined) ? joined : got };
  }
  const habit = check.habits[got];
  if (habit) return { verdict: "habit", heard: got, habit };
  return { verdict: "off", heard: got };
}

export function heardString(heard: string[]): string {
  return heard.join("");
}
