import type { NovaConfig } from '../config';
import type { SpeechSource } from '../core/types';
import { LevelMeter } from './LevelMeter';
import { PcmStream, type PlaybackResult, type SpeechHandle } from './PcmStream';

/**
 * One AudioContext for everything. Speech goes through `speechBus`, which is
 * both heard and analysed for lip-sync. External nodes and the microphone are
 * analysed but not played.
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  readonly speech: LevelMeter;
  readonly mic: LevelMeter;
  private readonly speechBus: GainNode;
  private readonly sink: GainNode;
  private readonly elementSources = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();
  private externalCount = 0;
  private micSource: MediaStreamAudioSourceNode | null = null;

  constructor(cfg: NovaConfig['lipSync']) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.speech = new LevelMeter(this.ctx, cfg);
    this.mic = new LevelMeter(this.ctx, { ...cfg, gain: cfg.gain * 1.6, shape: false });

    // Analysers need a path to the destination to be pulled reliably; route them into a muted sink.
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(this.ctx.destination);
    this.speech.analyser.connect(this.sink);
    this.mic.analyser.connect(this.sink);

    this.speechBus = this.ctx.createGain();
    this.speechBus.connect(this.ctx.destination);
    this.speechBus.connect(this.speech.analyser);
  }

  get unlocked(): boolean {
    return this.ctx.state === 'running';
  }

  /** Browsers start audio suspended until a user gesture. Call from a click/keypress. */
  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  /** True while an external node is connected for analysis. */
  get externalActive(): boolean {
    return this.externalCount > 0;
  }

  /** Called once per frame by Nova. */
  sample(dt: number): void {
    this.speech.sample(dt);
    if (this.micSource) this.mic.sample(dt);
  }

  async play(source: SpeechSource): Promise<SpeechHandle> {
    await this.resume().catch(() => undefined);
    if (source instanceof MediaStream) return this.playMediaStream(source);
    if (typeof source === 'string' || source instanceof Blob || source instanceof HTMLAudioElement) {
      return this.playElement(source);
    }
    const buffer = source instanceof AudioBuffer ? source : await this.ctx.decodeAudioData(source.slice(0));
    return this.playBuffer(buffer);
  }

  createPcmStream(sampleRate: number, onFirstAudio?: () => void): PcmStream {
    void this.resume().catch(() => undefined);
    return new PcmStream(this.ctx, this.speechBus, sampleRate, onFirstAudio);
  }

  /**
   * Analyse audio from your own Web Audio graph without routing playback through Nova.
   * The node must belong to `nova.audio.ctx`. Returns a disconnect function.
   */
  connectExternal(node: AudioNode): () => void {
    node.connect(this.speech.analyser);
    this.externalCount++;
    let connected = true;
    return () => {
      if (!connected) return;
      connected = false;
      this.externalCount--;
      node.disconnect(this.speech.analyser);
    };
  }

  /** Feed the user's microphone in so Nova can react while listening. */
  attachMic(stream: MediaStream): () => void {
    this.detachMic();
    this.micSource = this.ctx.createMediaStreamSource(stream);
    this.micSource.connect(this.mic.analyser);
    return () => this.detachMic();
  }

  detachMic(): void {
    this.micSource?.disconnect();
    this.micSource = null;
    this.mic.reset();
  }

  // ── Sources ─────────────────────────────────────────────────

  private async playElement(source: string | Blob | HTMLAudioElement): Promise<SpeechHandle> {
    let el: HTMLAudioElement;
    let objectUrl: string | null = null;
    if (source instanceof HTMLAudioElement) el = source;
    else {
      el = new Audio();
      el.crossOrigin = 'anonymous'; // required for analysing cross-origin audio
      if (typeof source === 'string') el.src = source;
      else el.src = objectUrl = URL.createObjectURL(source);
    }

    let node = this.elementSources.get(el);
    if (!node) {
      node = this.ctx.createMediaElementSource(el);
      this.elementSources.set(el, node);
    }
    node.connect(this.speechBus);

    let settle!: (r: PlaybackResult) => void;
    let settled = false;
    const done = new Promise<PlaybackResult>((r) => (settle = r));
    const finish = (interrupted: boolean) => {
      if (settled) return;
      settled = true;
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
      node!.disconnect();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      settle({ interrupted });
    };
    const onEnded = () => finish(false);
    const onError = () => finish(false);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);

    try {
      await el.play();
    } catch (err) {
      finish(true);
      throw err;
    }

    return {
      done,
      timed: true,
      progress: () => (Number.isFinite(el.duration) && el.duration > 0 ? el.currentTime / el.duration : NaN),
      stop: () => {
        el.pause();
        finish(true);
      },
    };
  }

  private playBuffer(buffer: AudioBuffer): SpeechHandle {
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.speechBus);
    const startAt = this.ctx.currentTime + 0.02;
    let stopped = false;
    const done = new Promise<PlaybackResult>((resolve) => {
      node.onended = () => {
        node.disconnect();
        resolve({ interrupted: stopped });
      };
    });
    node.start(startAt);
    return {
      done,
      timed: true,
      progress: () => Math.min(1, Math.max(0, (this.ctx.currentTime - startAt) / buffer.duration)),
      stop: () => {
        stopped = true;
        try {
          node.stop();
        } catch {
          /* already ended */
        }
      },
    };
  }

  /**
   * Live streams (e.g. WebRTC). Chrome only delivers remote WebRTC audio to Web Audio
   * if the stream is also attached to a (muted) media element; do that on your side.
   */
  private playMediaStream(stream: MediaStream): SpeechHandle {
    const node = this.ctx.createMediaStreamSource(stream);
    node.connect(this.speechBus);
    let settle!: (r: PlaybackResult) => void;
    let settled = false;
    const done = new Promise<PlaybackResult>((r) => (settle = r));
    const tracks = stream.getAudioTracks();
    const finish = (interrupted: boolean) => {
      if (settled) return;
      settled = true;
      node.disconnect();
      tracks.forEach((t) => t.removeEventListener('ended', onTrackEnded));
      settle({ interrupted });
    };
    const onTrackEnded = () => {
      if (tracks.every((t) => t.readyState === 'ended')) finish(false);
    };
    tracks.forEach((t) => t.addEventListener('ended', onTrackEnded));
    return { done, timed: false, progress: () => NaN, stop: () => finish(true) };
  }
}
