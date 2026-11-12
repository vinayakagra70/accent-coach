/** Main-thread side of the on-device speech model (see worker.ts). */
import type { FromWorker, ToWorker } from "./worker";

export interface EngineState {
  cached: boolean;
  ready: boolean;
  loading: boolean;
  /** 0..1 while downloading */
  progress: number;
  error: string | null;
}

/**
 * Phones can silently stop a worker that uses too much memory. If recordings are
 * waiting and the worker says nothing for this long, treat it as stopped instead
 * of waiting forever. (One recording takes ~1 s on a laptop, a few seconds on a phone.)
 */
const SILENCE_LIMIT_MS = 60_000;

export const ENGINE_STOPPED = "The speech engine stopped. Your phone may be low on memory: close other apps and tabs, then try again.";

const state: EngineState = { cached: false, ready: false, loading: false, progress: 0, error: null };
const listeners = new Set<(s: EngineState) => void>();
let worker: Worker | null = null;
let seq = 0;
let lastHeard = 0;
let watchdog = 0;
let testModelUrl: string | undefined;
const pending = new Map<number, { resolve: (p: string[]) => void; reject: (e: Error) => void }>();

/** Test overrides only work on this computer (dev server or `vite preview`), never on a real site. */
export function isLocalTest(): boolean {
  return import.meta.env.DEV || ["127.0.0.1", "localhost"].includes(location.hostname);
}

function emit() {
  for (const l of listeners) l({ ...state });
}

/** The worker is gone (crashed, killed for memory, or silent too long): fail what's waiting, reset. */
function stopped(reason = ENGINE_STOPPED) {
  window.clearInterval(watchdog);
  watchdog = 0;
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error(reason));
  pending.clear();
  // The model is still saved on the device, so the next start is quick and needs no download.
  Object.assign(state, { ready: false, loading: false, progress: 0, error: reason });
  emit();
}

function watch() {
  if (watchdog) return;
  watchdog = window.setInterval(() => {
    if (pending.size && performance.now() - lastHeard > SILENCE_LIMIT_MS) stopped();
    if (!pending.size) {
      window.clearInterval(watchdog);
      watchdog = 0;
    }
  }, 2000);
}

function w(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onerror = () => stopped();
  worker.onmessageerror = () => stopped();
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    lastHeard = performance.now();
    const m = e.data;
    if (m.type === "status") Object.assign(state, { cached: m.cached, ready: m.ready });
    else if (m.type === "progress") state.progress = m.loaded / m.total;
    else if (m.type === "ready") Object.assign(state, { ready: true, cached: true, loading: false, progress: 1, error: null });
    else if (m.type === "started") return;
    else if (m.type === "error") {
      if (m.id !== undefined) {
        pending.get(m.id)?.reject(new Error(m.message));
        pending.delete(m.id);
      } else Object.assign(state, { loading: false, error: m.message });
    } else if (m.type === "result") {
      pending.get(m.id)?.resolve(m.phonemes);
      pending.delete(m.id);
    }
    emit();
  };
  return worker;
}

const send = (m: ToWorker, transfer: Transferable[] = []) => w().postMessage(m, transfer);

export const engine = {
  get state(): EngineState {
    return { ...state };
  },
  subscribe(fn: (s: EngineState) => void): () => void {
    listeners.add(fn);
    fn({ ...state });
    return () => listeners.delete(fn);
  },
  /** Ask whether the model is already on this device (no download). */
  checkCached() {
    send({ type: "status" });
  },
  /** Download (first time) and start the model. */
  load(devUrl?: string) {
    if (state.ready || state.loading) return;
    if (isLocalTest() && devUrl) testModelUrl = devUrl; // a restart reuses it
    Object.assign(state, { loading: true, error: null });
    emit();
    lastHeard = performance.now();
    send({ type: "load", url: isLocalTest() ? testModelUrl : undefined });
  },
  /**
   * Check one recording. Recordings are queued and checked one at a time.
   * If the engine had stopped, it restarts from the copy saved on the device.
   */
  recognize(pcm16k: Float32Array): Promise<string[]> {
    if (!worker && state.cached) engine.load();
    const id = ++seq;
    const copy = pcm16k.slice();
    lastHeard = performance.now();
    watch();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ type: "recognize", id, pcm: copy }, [copy.buffer]);
    });
  },
  /** Recordings still waiting to be checked. */
  get waiting(): number {
    return pending.size;
  },
  /** Tests only: simulate the phone killing the worker. */
  _simulateStop() {
    if (isLocalTest()) {
      worker?.terminate();
      lastHeard = -Infinity;
    }
  },
};
