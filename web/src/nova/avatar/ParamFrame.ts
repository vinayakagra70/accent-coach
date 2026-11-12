import type { PairedKey, ParamKey, ParamMap, Pose } from '../core/types';

const PAIRS: Record<PairedKey, readonly [ParamKey, ParamKey]> = {
  eyeOpen: ['eyeLOpen', 'eyeROpen'],
  eyeSmile: ['eyeLSmile', 'eyeRSmile'],
  browY: ['browLY', 'browRY'],
  browAngle: ['browLAngle', 'browRAngle'],
  browForm: ['browLForm', 'browRForm'],
};

/** The slice of Cubism's CubismModel that Nova uses. */
export interface CoreModelLike {
  setParameterValueById(id: string, value: number, weight?: number): void;
  addParameterValueById(id: string, value: number, weight?: number): void;
  getParameterValueById(id: string): number;
}

/**
 * Collects every behaviour's parameter writes for one frame, then applies them
 * in a fixed order: absolute sets, additive offsets, then forced overrides.
 * The Cubism framework restores saved parameters after each frame, so nothing
 * accumulates between frames.
 */
export class ParamFrame {
  private readonly sets = new Map<string, { value: number; weight: number }>();
  private readonly adds = new Map<string, number>();
  private readonly forced = new Map<string, { value: number; weight: number }>();
  private readonly cache = new Map<string, readonly string[]>();

  constructor(private readonly ids: ParamMap) {}

  /** Semantic key, pair shorthand or raw parameter id → model parameter ids. */
  resolve(key: string): readonly string[] {
    let ids = this.cache.get(key);
    if (!ids) {
      if (key in PAIRS) ids = PAIRS[key as PairedKey].map((k) => this.ids[k]);
      else if (key in this.ids) ids = [this.ids[key as ParamKey]];
      else ids = [key];
      this.cache.set(key, ids);
    }
    return ids;
  }

  add(key: string, value: number): void {
    if (!value) return;
    for (const id of this.resolve(key)) this.adds.set(id, (this.adds.get(id) ?? 0) + value);
  }

  set(key: string, value: number, weight = 1): void {
    for (const id of this.resolve(key)) this.sets.set(id, { value, weight });
  }

  /** Applied last, after all additive layers. Used for explicit host overrides. */
  force(key: string, value: number, weight = 1): void {
    for (const id of this.resolve(key)) this.forced.set(id, { value, weight });
  }

  addPose(pose: Pose, scale = 1): void {
    for (const key in pose) {
      const v = pose[key];
      if (v) this.add(key, v * scale);
    }
  }

  flush(core: CoreModelLike): void {
    for (const [id, s] of this.sets) core.setParameterValueById(id, s.value, s.weight);
    for (const [id, v] of this.adds) core.addParameterValueById(id, v);
    for (const [id, s] of this.forced) core.setParameterValueById(id, s.value, s.weight);
    this.sets.clear();
    this.adds.clear();
    this.forced.clear();
  }
}
