import type { Profile } from "./course";

/** Talks to the local Accent Coach server (server/app.py) through Vite's /api proxy. */

export interface Health {
  reachable: boolean;
  ready: boolean;
  loading: boolean;
  error: string | null;
}

export async function health(): Promise<Health> {
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
export async function recognize(wav: Blob): Promise<string[]> {
  const r = await fetch("/api/recognize", { method: "POST", body: wav, headers: { "Content-Type": "audio/wav" } });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? `server error ${r.status}`);
  return (await r.json()).phonemes as string[];
}

export async function getProfile(): Promise<Profile | null> {
  try {
    const r = await fetch("/api/profile", { cache: "no-store" });
    if (!r.ok) return null;
    return ((await r.json()).profile as Profile) ?? null;
  } catch {
    return null;
  }
}

export async function putProfile(p: Profile): Promise<void> {
  try {
    await fetch("/api/profile", { method: "PUT", body: JSON.stringify(p), headers: { "Content-Type": "application/json" } });
  } catch {
    /* offline: the browser copy is kept */
  }
}
