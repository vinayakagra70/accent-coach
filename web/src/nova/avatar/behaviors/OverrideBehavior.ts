import { approach } from '../../util/math';
import type { Behavior, BehaviorContext } from './Behavior';

interface Override {
  value: number;
  weight: number;
  target: number;
  until: number;
}

/** Explicit parameter values set by the host (nova.setParam). Applied after every other layer. */
export class OverrideBehavior implements Behavior {
  readonly name = 'overrides';
  private readonly entries = new Map<string, Override>();

  set(key: string, value: number, opts: { weight?: number; duration?: number } = {}): void {
    const prev = this.entries.get(key);
    this.entries.set(key, {
      value,
      weight: prev?.weight ?? 0,
      target: opts.weight ?? 1,
      until: opts.duration ? performance.now() + opts.duration : Infinity,
    });
  }

  release(key?: string): void {
    if (key === undefined) for (const e of this.entries.values()) e.target = 0;
    else {
      const e = this.entries.get(key);
      if (e) e.target = 0;
    }
  }

  update({ dt, frame }: BehaviorContext): void {
    const now = performance.now();
    for (const [key, e] of this.entries) {
      if (now > e.until) e.target = 0;
      e.weight = approach(e.weight, e.target, 10, dt);
      if (e.target === 0 && e.weight < 0.002) {
        this.entries.delete(key);
        continue;
      }
      frame.force(key, e.value, e.weight);
    }
  }
}
