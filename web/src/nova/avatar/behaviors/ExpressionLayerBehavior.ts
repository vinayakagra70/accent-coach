import type { Pose } from '../../core/types';
import { approach } from '../../util/math';
import type { Behavior, BehaviorContext } from './Behavior';

interface Layer {
  name: string;
  pose: Pose;
  weight: number;
  target: number;
}

/** Procedural expressions: parameter poses that crossfade into each other. */
export class ExpressionLayerBehavior implements Behavior {
  readonly name = 'expression-layer';
  private layers: Layer[] = [];

  constructor(private readonly rate = 7) {}

  show(name: string, pose: Pose, intensity = 1): void {
    for (const l of this.layers) l.target = 0;
    this.layers.push({ name, pose, weight: 0, target: intensity });
  }

  clear(): void {
    for (const l of this.layers) l.target = 0;
  }

  update({ dt, frame }: BehaviorContext): void {
    for (const l of this.layers) {
      l.weight = approach(l.weight, l.target, this.rate, dt);
      frame.addPose(l.pose, l.weight);
    }
    this.layers = this.layers.filter((l) => l.target > 0 || l.weight > 0.002);
  }
}
