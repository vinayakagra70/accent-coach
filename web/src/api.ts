import type { Take } from "./audio/recorder";
import type { Profile } from "./course";
import { engine } from "./listen/engine";

/**
 * Where listening and saving happen.
 *  - Laptop build: the local Python server (server/app.py) through Vite's /api proxy.
 *  - Phone build (`npm run build:phone`, VITE_STATIC=1): no server at all. The
 *    speech model runs in the browser (listen/), progress stays on the device.
 */
export const STATIC = import.meta.env.VITE_STATIC === "1";

export interface Health {
  reachable: boolean;
  ready: boolean;
  loading: boolean;
  error: string | null;
  /** Phone build: the model still has to be downloaded (with the user's OK). */
  needsDownload?: boolean;
  /** Phone build: 0..1 while downloading. */
  progress?: number;
}

export async function health(): Promise<Health> {
  if (STATIC) {
    const s = engine.state;
    return { reachable: true, ready: s.ready, loading: s.loading, error: s.error, needsDownload: !s.ready && !s.loading, progress: s.progress };
  }
  try {
    const r = await fetch("/api/health", { cache: "no-store" });
    if (!r.ok) return { reachable: false, ready: false, loading: false, error: null };
    const j = await r.json();
    return { reachable: true, ready: !!j.ready, loading: !!j.loading, error: j.error ?? null };
  } catch {
    return { reachable: false, ready: false, loading: false, error: null };
  }
}

/** Phonemes the model heard, as written by the model (not yet normalized). */
export async function recognize(take: Take): Promise<string[]> {
  if (STATIC) return engine.recognize(take.pcm);
  const r = await fetch("/api/recognize", { method: "POST", body: take.wav, headers: { "Content-Type": "audio/wav" } });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? `server error ${r.status}`);
  return (await r.json()).phonemes as string[];
}

export async function getProfile(): Promise<Profile | null> {
  if (STATIC) return null; // the browser copy (course.ts) is the only copy
  try {
    const r = await fetch("/api/profile", { cache: "no-store" });
    if (!r.ok) return null;
    return ((await r.json()).profile as Profile) ?? null;
  } catch {
    return null;
  }
}

export async function putProfile(p: Profile): Promise<void> {
  if (STATIC) return;
  try {
    await fetch("/api/profile", { method: "PUT", body: JSON.stringify(p), headers: { "Content-Type": "application/json" } });
  } catch {
    /* offline: the browser copy is kept */
  }
}
