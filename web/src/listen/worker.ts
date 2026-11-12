/**
 * The phone's "ears": wav2vec2 lv-60 espeak phoneme model (q4 ONNX, 242 MB)
 * running in this worker with onnxruntime-web. Downloaded once, kept in the
 * browser's Cache Storage, then works offline.
 */
import * as ort from "onnxruntime-web";
import vocab from "../listen-vocab.json";

export const MODEL_URL =
  "https://huggingface.co/onnx-community/wav2vec2-lv-60-espeak-cv-ft-ONNX/resolve/c69750f5043e5e1f8a71ab95dd3b98338c280c92/onnx/model_q4.onnx";
const CACHE = "accent-coach-model-v1";
const ORT_VERSION = "1.31.1";

export type ToWorker =
  | { type: "status" }
  | { type: "load"; url?: string }
  | { type: "recognize"; id: number; pcm: Float32Array };

export type FromWorker =
  | { type: "status"; cached: boolean; ready: boolean }
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready"; ms: number }
  | { type: "error"; message: string; id?: number }
  | { type: "result"; id: number; phonemes: string[]; ms: number };

const post = (m: FromWorker) => (self as unknown as { postMessage(m: FromWorker): void }).postMessage(m);

const idToToken: Record<number, string> = {};
const skip = new Set<number>();
for (const [tok, id] of Object.entries(vocab as Record<string, number>)) {
  idToToken[id] = tok;
  if (["<pad>", "<s>", "</s>", "<unk>", "|"].includes(tok)) skip.add(id);
}

let session: ort.InferenceSession | null = null;
let modelUrl = MODEL_URL;
let loading: Promise<void> | null = null;

ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;

async function cached(): Promise<boolean> {
  try {
    return !!(await (await caches.open(CACHE)).match(MODEL_URL));
  } catch {
    return false;
  }
}

async function download(): Promise<ArrayBuffer> {
  const cache = await caches.open(CACHE).catch(() => null);
  const hit = await cache?.match(modelUrl);
  if (hit) return hit.arrayBuffer();
  const r = await fetch(modelUrl);
  if (!r.ok || !r.body) throw new Error(`model download failed (${r.status})`);
  const total = Number(r.headers.get("content-length")) || 241_691_639;
  const reader = r.body.getReader();
  const buf = new Uint8Array(total);
  let loaded = 0;
  let lastPost = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (loaded + value.length > buf.length) throw new Error("model larger than expected");
    buf.set(value, loaded);
    loaded += value.length;
    if (loaded - lastPost > 2_000_000) {
      lastPost = loaded;
      post({ type: "progress", loaded, total });
    }
  }
  const data = buf.subarray(0, loaded);
  try {
    await cache?.put(modelUrl, new Response(data, { headers: { "Content-Type": "application/octet-stream" } }));
  } catch {
    /* storage full or blocked: it just downloads again next time */
  }
  return data.buffer.slice(0, loaded);
}

async function load(): Promise<void> {
  if (session) return;
  loading ??= (async () => {
    const t = performance.now();
    const bytes = await download();
    session = await ort.InferenceSession.create(new Uint8Array(bytes), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    post({ type: "ready", ms: Math.round(performance.now() - t) });
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** Same clean-up as the laptop server: trim silence at the ends, peak-normalize. */
export function prepare(a: Float32Array): Float32Array {
  const frame = 320; // 20 ms at 16 kHz
  const energies: number[] = [];
  for (let i = 0; i + frame <= a.length; i += frame) {
    let s = 0;
    for (let j = i; j < i + frame; j++) s += a[j] * a[j];
    energies.push(Math.sqrt(s / frame));
  }
  let out = a;
  const max = Math.max(0, ...energies);
  if (max > 0) {
    const first = energies.findIndex((e) => e > max * 0.05);
    let last = energies.length - 1;
    while (last > 0 && energies[last] <= max * 0.05) last--;
    out = a.subarray(Math.max(0, (first - 10) * frame), Math.min(a.length, (last + 11) * frame));
  }
  let peak = 0;
  for (const v of out) peak = Math.max(peak, Math.abs(v));
  // Wav2Vec2FeatureExtractor: zero mean, unit variance
  let mean = 0;
  for (const v of out) mean += v;
  mean /= out.length || 1;
  let varr = 0;
  for (const v of out) varr += (v - mean) ** 2;
  const std = Math.sqrt(varr / (out.length || 1) + 1e-7);
  const res = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) res[i] = (peak > 0 ? (out[i] - mean) / std : 0);
  return res;
}

async function recognize(id: number, pcm: Float32Array) {
  await load();
  const t = performance.now();
  const x = prepare(pcm.subarray(0, 16000 * 15));
  const feeds: Record<string, ort.Tensor> = { input_values: new ort.Tensor("float32", x, [1, x.length]) };
  if (session!.inputNames.includes("attention_mask")) {
    feeds.attention_mask = new ort.Tensor("int64", new BigInt64Array(x.length).fill(1n), [1, x.length]);
  }
  const out = await session!.run(feeds);
  const logits = out[session!.outputNames[0]];
  const [, frames, classes] = logits.dims as number[];
  const data = logits.data as Float32Array;
  const phonemes: string[] = [];
  let prev = -1;
  for (let f = 0; f < frames; f++) {
    let best = 0;
    let bestV = -Infinity;
    const base = f * classes;
    for (let c = 0; c < classes; c++) {
      const v = data[base + c];
      if (v > bestV) {
        bestV = v;
        best = c;
      }
    }
    if (best !== prev && !skip.has(best) && idToToken[best]) phonemes.push(idToToken[best]);
    prev = best;
  }
  post({ type: "result", id, phonemes, ms: Math.round(performance.now() - t) });
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === "status") void cached().then((c) => post({ type: "status", cached: c, ready: !!session }));
  else if (m.type === "load") {
    if (m.url) modelUrl = m.url; // dev/test override only (engine.load passes it in dev builds)
    load().catch((err) => post({ type: "error", message: String(err?.message ?? err) }));
  } else if (m.type === "recognize") recognize(m.id, m.pcm).catch((err) => post({ type: "error", id: m.id, message: String(err?.message ?? err) }));
};
