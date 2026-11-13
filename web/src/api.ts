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

/**
 * Phone build only: the online listener (space/, a Hugging Face Space) for phones
 * that don't have the memory to run the speech model themselves. Empty = not offered.
 */
export const ONLINE_URL = (import.meta.env.VITE_LISTEN_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export type ListenMode = "device" | "online";
const MODE_KEY = "accentCoach.listenMode";

/** Where this phone checks recordings. Saved per device. */
export function listenMode(): ListenMode {
  if (!STATIC || !ONLINE_URL) return "device";
  try {
    return localStorage.getItem(MODE_KEY) === "online" ? "online" : "device";
  } catch {
    return "device";
  }
}

const modeListeners = new Set<() => void>();

export function setListenMode(m: ListenMode) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* ignore */
  }
  modeListeners.forEach((f) => f());
}

export function onListenModeChange(f: () => void): () => void {
  modeListeners.add(f);
  return () => modeListeners.delete(f);
}

async function onlineHealth(): Promise<Health> {
  try {
    const r = await fetch(`${ONLINE_URL}/health`, { cache: "no-store" });
    if (!r.ok) return { reachable: r.status !== 404, ready: false, loading: true, error: null };
    const j = await r.json();
    return { reachable: true, ready: !!j.ready, loading: !!j.loading, error: j.error ?? null };
  } catch {
    return { reachable: false, ready: false, loading: false, error: null };
  }
}

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
  if (STATIC && listenMode() === "online") return onlineHealth();
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
  if (STATIC && listenMode() === "online") {
    const r = await fetch(`${ONLINE_URL}/recognize`, { method: "POST", body: take.wav, headers: { "Content-Type": "audio/wav" } });
    if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? `online checker error ${r.status}`);
    return (await r.json()).phonemes as string[];
  }
  if (STATIC) return engine.recognize(take.pcm);
  const r = await fetch("/api/recognize", { method: "POST", body: take.wav, headers: { "Content-Type": "audio/wav" } });
  if (!r.ok) throw new Error((await r.json().catch(() => null))?.detail ?? `server error ${r.status}`);
  return (await r.json()).phonemes as string[];
}

// ------------------------------------------------------------------ profile sync
//
// The server numbers every save (Profile.rev). A save says which number its
// copy came from; if another device has saved since, the server refuses it
// and sends back the current profile instead of letting it be overwritten.

/** The server revision this browser's copy is based on; null = go by the copy's own `rev`. */
let knownRev: number | null = null;
let pending: Profile | null = null;
let sending = false;
let handlers: { saved: (rev: number) => void; conflict: (server: Profile) => void } | null = null;

/** `saved`: the server stored our copy as this revision. `conflict`: it refused, here is the newer one. */
export function onProfileSync(h: NonNullable<typeof handlers>) {
  handlers = h;
}

/**
 * Call when the app takes a server copy as its own. Merely fetching one must
 * not move this: a save would then claim to be based on a copy it never saw.
 */
export function profileBasedOn(rev: number) {
  knownRev = rev;
}

/** True while a save is on its way (don't refetch in the middle of one). */
export function profileSyncBusy(): boolean {
  return sending || pending !== null;
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

/**
 * Queue a save. Only one request is in flight at a time and only the newest
 * waiting copy is sent, so quick taps can't race each other into a false conflict.
 */
export function putProfile(p: Profile): void {
  if (STATIC) return;
  pending = p;
  void flush();
}

async function flush() {
  if (sending) return;
  sending = true;
  try {
    while (pending) {
      const p = pending;
      pending = null;
      const r = await fetch("/api/profile", {
        method: "PUT",
        body: JSON.stringify({ ...p, rev: knownRev ?? p.rev ?? null }),
        headers: { "Content-Type": "application/json" },
      });
      if (r.status === 409) {
        const server = (await r.json()).profile as Profile;
        knownRev = server.rev ?? 0;
        pending = null; // anything queued was built on the stale copy too
        handlers?.conflict(server);
      } else if (r.ok) {
        const rev = (await r.json()).rev;
        if (typeof rev === "number") {
          knownRev = rev;
          handlers?.saved(rev);
        }
      }
    }
  } catch {
    /* offline: the browser copy is kept and goes up with the next save */
  } finally {
    sending = false;
  }
}
