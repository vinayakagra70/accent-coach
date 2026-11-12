/**
 * Pre-rendered speech. Everything Nova says and every model word is rendered
 * with Kokoro ahead of time (tools/render_voice.py) and shipped as MP3 clips,
 * so phones don't need a voice engine. Speech is split into sentences, and each
 * sentence is one clip, so the same splitter must be used here and when rendering.
 */

/** Sentence splitter shared by the app and the renderer. */
export function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+["')]*\s*|[^.!?]+$/g) ?? [text]).map((s) => s.trim()).filter(Boolean);
}

/** Two speeds for words; the coach always speaks at normal speed. */
export type Speed = "normal" | "slow";
export const SPEEDS: Record<Speed, number> = { normal: 0.95, slow: 0.75 };

export function speedBucket(speed: number): Speed {
  return speed < 0.85 ? "slow" : "normal";
}

/** Stable short key for a clip (FNV-1a, 2 × 32 bit). */
export function clipKey(accent: string, kind: "word" | "line", speed: Speed, text: string): string {
  const s = `${accent}|${kind}|${speed}|${text.trim()}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(36) + h2.toString(36);
}

let manifest: Promise<Set<string>> | null = null;

/** The clip list shipped with the app (empty if the clips weren't rendered). */
function loadManifest(): Promise<Set<string>> {
  manifest ??= fetch("audio/manifest.json")
    .then((r) => (r.ok ? r.json() : { clips: [] }))
    .then((j: { clips: string[] }) => new Set(j.clips))
    .catch(() => new Set<string>());
  return manifest;
}

/** The MP3 for this line or word, or null when it wasn't pre-rendered. */
export async function clip(accent: string, kind: "word" | "line", speed: Speed, text: string): Promise<ArrayBuffer | null> {
  const key = clipKey(accent, kind, speed, text);
  if (!(await loadManifest()).has(key)) return null;
  try {
    const r = await fetch(`audio/${key}.mp3`);
    return r.ok ? await r.arrayBuffer() : null;
  } catch {
    return null;
  }
}
