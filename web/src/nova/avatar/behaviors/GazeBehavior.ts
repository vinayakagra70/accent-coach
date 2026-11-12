import type { NovaConfig } from '../../config';
import { approach, lerp, rand } from '../../util/math';
import type { Behavior, BehaviorContext } from './Behavior';

type Vec = { x: number; y: number };

/**
 * Eyes and head follow a target. The target is the mouse when it's active,
 * otherwise whatever the current state asks for: wandering glances, the viewer,
 * or a fixed point (e.g. up-left while thinking). Eyes lead, the head follows.
 */
export class GazeBehavior implements Behavior {
  readonly name = 'gaze';
  private readonly eye: Vec = { x: 0, y: 0 };
  private readonly headPos: Vec = { x: 0, y: 0 };
  private wander: Vec = { x: 0, y: 0 };
  private jitter: Vec = { x: 0, y: 0 };
  private nextWander = 0;
  private nextJitter = 0;

  constructor(private readonly cfg: NovaConfig['gaze']) {}

  update({ dt, time, frame, inputs, avatar }: BehaviorContext): void {
    const spec = inputs.stateDef.gaze;

    let pointer: Vec | null = null;
    const p = inputs.pointer;
    if (p && performance.now() - p.lastMove < this.cfg.pointerTimeoutMs) {
      const h = avatar.head();
      const s = avatar.size();
      pointer = {
        x: Math.tanh(((p.x - h.x) / (s.width * 0.5)) * 1.4),
        y: Math.tanh(((h.y - p.y) / (s.height * 0.5)) * 1.4),
      };
    }

    if (time > this.nextWander) {
      this.wander = Math.random() < 0.3 ? { x: 0, y: 0 } : { x: rand(-0.5, 0.5), y: rand(-0.25, 0.35) };
      this.nextWander = time + rand(1.8, 4.5);
    }
    if (time > this.nextJitter) {
      this.jitter = { x: rand(-0.05, 0.05), y: rand(-0.04, 0.04) };
      this.nextJitter = time + rand(0.4, 1.6);
    }

    const base: Vec =
      spec.target === 'free' ? this.wander : spec.target === 'viewer' ? { x: 0, y: 0 } : { x: spec.target[0], y: spec.target[1] };
    const w = pointer ? (spec.target === 'free' ? 1 : spec.pointer) : 0;
    let tx = lerp(base.x, pointer?.x ?? 0, w);
    let ty = lerp(base.y, pointer?.y ?? 0, w);
    if (inputs.lookAt) {
      tx = inputs.lookAt.x;
      ty = inputs.lookAt.y;
    }

    this.eye.x = approach(this.eye.x, tx + this.jitter.x, this.cfg.eyeRate, dt);
    this.eye.y = approach(this.eye.y, ty + this.jitter.y, this.cfg.eyeRate, dt);
    this.headPos.x = approach(this.headPos.x, tx, this.cfg.headRate, dt);
    this.headPos.y = approach(this.headPos.y, ty, this.cfg.headRate, dt);

    const { x: hx, y: hy } = this.headPos;
    frame.add('eyeBallX', this.eye.x);
    frame.add('eyeBallY', this.eye.y);
    frame.add('angleX', hx * this.cfg.headRange);
    frame.add('angleY', hy * this.cfg.headRange * 0.8);
    frame.add('angleZ', -hx * hy * this.cfg.headRange * 0.35);
    frame.add('bodyX', hx * this.cfg.bodyRange);
  }
}
