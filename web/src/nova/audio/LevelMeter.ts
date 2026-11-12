import type { NovaConfig } from '../config';
import { approach, clamp } from '../util/math';

/**
 * Turns an audio signal into a smoothed 0..1 mouth level and a rough mouth
 * shape (-1 round … +1 wide) from the balance of low vs high formant energy.
 */
export class LevelMeter {
  readonly analyser: AnalyserNode;
  level = 0;
  shape = 0;
  private readonly time: Float32Array<ArrayBuffer>;
  private readonly freq: Float32Array<ArrayBuffer>;
  private readonly binHz: number;

  constructor(ctx: BaseAudioContext, private readonly cfg: NovaConfig['lipSync']) {
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.25;
    this.time = new Float32Array(this.analyser.fftSize);
    this.freq = new Float32Array(this.analyser.frequencyBinCount);
    this.binHz = ctx.sampleRate / this.analyser.fftSize;
  }

  sample(dt: number): void {
    this.analyser.getFloatTimeDomainData(this.time);
    let sum = 0;
    for (let i = 0; i < this.time.length; i++) sum += this.time[i] * this.time[i];
    const rms = Math.sqrt(sum / this.time.length);

    const target = Math.pow(clamp((rms - this.cfg.noiseFloor) * this.cfg.gain, 0, 1), 0.8);
    this.level = approach(this.level, target, target > this.level ? this.cfg.attack : this.cfg.release, dt);

    if (!this.cfg.shape) return;
    if (target < 0.02) {
      this.shape = approach(this.shape, 0, 6, dt);
      return;
    }
    this.analyser.getFloatFrequencyData(this.freq);
    const low = this.band(150, 900);
    const high = this.band(1200, 3500);
    const ratio = high / (low + high + 1e-9);
    this.shape = approach(this.shape, clamp((ratio - 0.3) * 3, -1, 1), 10, dt);
  }

  private band(fromHz: number, toHz: number): number {
    const a = Math.max(1, Math.floor(fromHz / this.binHz));
    const b = Math.min(this.freq.length - 1, Math.ceil(toHz / this.binHz));
    let e = 0;
    for (let i = a; i <= b; i++) e += Math.pow(10, this.freq[i] / 10);
    return e;
  }

  reset(): void {
    this.level = 0;
    this.shape = 0;
  }
}
