/**
 * Records one phrase: starts listening, notices when you start talking, and
 * stops by itself after you pause. Returns 16 kHz mono WAV for the server.
 */
export interface Take {
  wav: Blob;
  seconds: number;
  /** False when nothing louder than the room was heard. */
  speech: boolean;
}

export interface RecordOptions {
  onLevel?: (level: number) => void;
  /** Called once speech is detected. */
  onSpeech?: () => void;
  maxSeconds?: number;
  silenceToStop?: number;
  signal?: AbortSignal;
}

const OUT_RATE = 16000;

export async function recordPhrase(opts: RecordOptions = {}): Promise<Take> {
  const maxSeconds = opts.maxSeconds ?? 7;
  const silenceToStop = opts.silenceToStop ?? 0.9;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is old but works everywhere and keeps this one small file.
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  const chunks: Float32Array[] = [];
  let elapsed = 0;
  let noiseFloor = 0.01;
  let spoke = false;
  let silentFor = 0;

  return new Promise<Take>((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      proc.disconnect();
      src.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      const rate = ctx.sampleRate;
      void ctx.close();
      const pcm = concat(chunks);
      resolve({ wav: encodeWav(resample(pcm, rate, OUT_RATE), OUT_RATE), seconds: pcm.length / rate, speech: spoke });
    };
    opts.signal?.addEventListener("abort", () => {
      if (done) return;
      done = true;
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close();
      reject(new DOMException("aborted", "AbortError"));
    });

    proc.onaudioprocess = (e) => {
      if (done) return;
      const data = new Float32Array(e.inputBuffer.getChannelData(0));
      chunks.push(data);
      const dt = data.length / ctx.sampleRate;
      elapsed += dt;
      let s = 0;
      for (let i = 0; i < data.length; i++) s += data[i] * data[i];
      const rms = Math.sqrt(s / data.length);
      opts.onLevel?.(Math.min(1, rms * 10));
      if (elapsed < 0.3) {
        noiseFloor = Math.max(noiseFloor, rms);
        return;
      }
      const loud = rms > Math.max(0.02, noiseFloor * 2.5);
      if (loud) {
        if (!spoke) opts.onSpeech?.();
        spoke = true;
        silentFor = 0;
      } else if (spoke) {
        silentFor += dt;
      }
      if ((spoke && silentFor >= silenceToStop) || elapsed >= maxSeconds || (!spoke && elapsed >= 5)) finish();
    };
    src.connect(proc);
    proc.connect(ctx.destination);
  });
}

function concat(chunks: Float32Array[]): Float32Array {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x;
  const ratio = from / to;
  const n = Math.floor(x.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // average over the source span: a cheap low-pass to avoid aliasing
    const a = Math.floor(i * ratio);
    const b = Math.min(x.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += x[j];
    out[i] = b > a ? s / (b - a) : x[a] ?? 0;
  }
  return out;
}

export function encodeWav(pcm: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}
