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

const state: EngineState = { cached: false, ready: false, loading: false, progress: 0, error: null };
const listeners = new Set<(s: EngineState) => void>();
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (p: string[]) => void; reject: (e: Error) => void }>();

/** Test overrides only work on this computer (dev server or `vite preview`), never on a real site. */
export function isLocalTest(): boolean {
  return import.meta.env.DEV || ["127.0.0.1", "localhost"].includes(location.hostname);
}

function emit() {
  for (const l of listeners) l({ ...state });
}

function w(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === "status") Object.assign(state, { cached: m.cached, ready: m.ready });
    else if (m.type === "progress") state.progress = m.loaded / m.total;
    else if (m.type === "ready") Object.assign(state, { ready: true, cached: true, loading: false, progress: 1, error: null });
    else if (m.type === "error") {
      if (m.id !== undefined) pending.get(m.id)?.reject(new Error(m.message));
      else Object.assign(state, { loading: false, error: m.message });
      if (m.id !== undefined) pending.delete(m.id);
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
    Object.assign(state, { loading: true, error: null });
    emit();
    send({ type: "load", url: isLocalTest() ? devUrl : undefined });
  },
  recognize(pcm16k: Float32Array): Promise<string[]> {
    const id = ++seq;
    const copy = pcm16k.slice();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      send({ type: "recognize", id, pcm: copy }, [copy.buffer]);
    });
  },
};
