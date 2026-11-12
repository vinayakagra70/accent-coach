export interface PlaybackResult {
  interrupted: boolean;
}

/** A playing utterance, whatever its source. */
export interface SpeechHandle {
  readonly done: Promise<PlaybackResult>;
  /** False for live sources whose length isn't known up front. */
  readonly timed: boolean;
  /** 0..1, or NaN when unknown. */
  progress(): number;
  stop(): void;
}

export type PcmChunk = Float32Array | Int16Array | ArrayBuffer;

/**
 * Gapless playback of PCM chunks as they arrive from a streaming TTS.
 * ArrayBuffer chunks are read as 16-bit little-endian mono PCM.
 */
export class PcmStream implements SpeechHandle {
  readonly done: Promise<PlaybackResult>;
  readonly timed = false;
  private resolve!: (r: PlaybackResult) => void;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private nextAt = 0;
  private started = false;
  private ended = false;
  private settled = false;
  private carry: number | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly destination: AudioNode,
    readonly sampleRate: number,
    private readonly onFirstAudio?: () => void,
  ) {
    this.done = new Promise((r) => (this.resolve = r));
  }

  push(chunk: PcmChunk): void {
    if (this.settled || this.ended) return;
    const samples = this.toFloat32(chunk);
    if (!samples.length) return;

    const buffer = this.ctx.createBuffer(1, samples.length, this.sampleRate);
    buffer.getChannelData(0).set(samples);
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.destination);

    // Small jitter buffer on start and after underruns.
    const now = this.ctx.currentTime;
    if (this.nextAt < now + 0.02) this.nextAt = now + 0.08;
    node.start(this.nextAt);
    this.nextAt += buffer.duration;

    this.sources.add(node);
    node.onended = () => {
      this.sources.delete(node);
      node.disconnect();
      this.maybeFinish();
    };

    if (!this.started) {
      this.started = true;
      this.onFirstAudio?.();
    }
  }

  /** No more chunks are coming. Resolves when the queued audio has played. */
  end(): Promise<PlaybackResult> {
    this.ended = true;
    this.maybeFinish();
    return this.done;
  }

  stop(): void {
    for (const s of this.sources) {
      s.onended = null;
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
      s.disconnect();
    }
    this.sources.clear();
    this.finish(true);
  }

  progress(): number {
    return NaN;
  }

  private maybeFinish(): void {
    if (this.ended && this.sources.size === 0) this.finish(false);
  }

  private finish(interrupted: boolean): void {
    if (this.settled) return;
    this.settled = true;
    this.resolve({ interrupted });
  }

  private toFloat32(chunk: PcmChunk): Float32Array {
    if (chunk instanceof Float32Array) return chunk;
    let int16: Int16Array;
    if (chunk instanceof Int16Array) int16 = chunk;
    else {
      let bytes = new Uint8Array(chunk);
      if (this.carry !== null) {
        const joined = new Uint8Array(bytes.length + 1);
        joined[0] = this.carry;
        joined.set(bytes, 1);
        bytes = joined;
        this.carry = null;
      }
      if (bytes.length % 2) {
        this.carry = bytes[bytes.length - 1];
        bytes = bytes.subarray(0, bytes.length - 1);
      }
      int16 = new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length));
    }
    const out = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768;
    return out;
  }
}
