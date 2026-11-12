import { approach } from '../../util/math';
import type { Behavior, BehaviorContext } from './Behavior';

/** Blends the current state's pose in and the previous one out, plus state-driven motion. */
export class StatePoseBehavior implements Behavior {
  readonly name = 'state-pose';
  private readonly current: Record<string, number> = {};
  private nod = 0;
  private ponder = 0;

  constructor(private readonly rate = 5) {}

  update({ dt, time, frame, inputs }: BehaviorContext): void {
    const def = inputs.stateDef;
    const target = def.pose;

    for (const key in target) if (!(key in this.current)) this.current[key] = 0;
    for (const key in this.current) {
      const v = approach(this.current[key], target[key] ?? 0, this.rate, dt);
      if (Math.abs(v) < 1e-4 && !(key in target)) {
        delete this.current[key];
        continue;
      }
      this.current[key] = v;
      frame.add(key, v);
    }

    // Attentive nod that follows the speaker's voice.
    this.nod = approach(this.nod, inputs.mic.level * (def.micNod ?? 0), 9, dt);
    frame.add('angleY', -this.nod);

    // Slow contemplative wobble.
    this.ponder = approach(this.ponder, def.ponder ?? 0, 2, dt);
    if (this.ponder > 0.01) {
      frame.add('angleZ', Math.sin(time * 1.1) * this.ponder);
      frame.add('angleX', Math.sin(time * 0.7 + 1) * this.ponder * 0.8);
    }
  }
}
