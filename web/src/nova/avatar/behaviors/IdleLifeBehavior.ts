import { approach } from '../../util/math';
import type { Behavior, BehaviorContext } from './Behavior';

/** Slow, layered head and body sway so the model never looks frozen. */
export class IdleLifeBehavior implements Behavior {
  readonly name = 'idle-life';
  private amp = 1;
  private readonly seed = Math.random() * 100;

  update({ dt, time, frame, inputs }: BehaviorContext): void {
    this.amp = approach(this.amp, inputs.stateDef.sway, 2, dt);
    const t = time + this.seed;
    const a = this.amp;
    frame.add('angleX', (Math.sin(t * 0.31) * 1.6 + Math.sin(t * 0.73 + 1.3) * 0.7) * a);
    frame.add('angleY', (Math.sin(t * 0.23 + 0.5) * 1.0 + Math.sin(t * 0.61) * 0.4) * a);
    frame.add('angleZ', Math.sin(t * 0.27 + 2.1) * 1.4 * a);
    frame.add('bodyX', Math.sin(t * 0.19 + 0.7) * 1.2 * a);
  }
}
